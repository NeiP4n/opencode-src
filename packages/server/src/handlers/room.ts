import { Instance } from "@opencode/core/instance/service"
import { NoteStore } from "@opencode/core/note"
import { Permission } from "@opencode/core/permission"
import { Room } from "@opencode/core/room"
import { Session } from "@opencode/core/session"
import {
  ForbiddenError,
  InvalidRequestError,
  PermissionNotFoundError,
  RoomNotFoundError,
  UnauthorizedError,
} from "@opencode/protocol/errors"
import { hostname } from "node:os"
import { randomBytes } from "node:crypto"
import { DateTime, Effect, Option, Predicate, Stream } from "effect"
import type { SessionMessage } from "@opencode/core/session/message"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ServerAuth } from "../auth"
import { locationErrors, sessionInfo } from "../location"
import { ServerRooms } from "../rooms"
import { missingSession } from "./session-error"
import { messagePage } from "./message"

function missingRequest(id: Permission.ID) {
  return new PermissionNotFoundError({ requestID: id, message: `Permission request not found: ${id}` })
}

const CHAT_LIMIT = 100

function chatMessage(message: SessionMessage.Info): Room.Message[] {
  const created = DateTime.toEpochMillis(message.time.created)
  if (message.type === "user") {
    const room = message.metadata?.room
    const author = Predicate.isObject(room) && Predicate.isObject(room.guest) ? room.guest.name : undefined
    return [
      {
        id: message.id,
        role: "user" as const,
        author: typeof author === "string" ? author : "host",
        text: message.text,
        created,
      },
    ]
  }
  if (message.type !== "assistant") return []
  const text = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
  return text ? [{ id: message.id, role: "assistant" as const, text, created }] : []
}

const RANK: Record<Room.Role, number> = { viewer: 0, member: 1, helper: 2 }

// Loopback is left out: tunnels such as Porthole deliver every guest from it, so a ban on it would ban them all.
function remoteAddress(request: HttpServerRequest.HttpServerRequest) {
  const address = Option.getOrUndefined(request.remoteAddress)?.replace(/^::ffff:/, "")
  if (!address || address === "::1" || address.startsWith("127.")) return
  return address
}

function missingRoom(error: Room.NotFoundError) {
  return Effect.fail(new RoomNotFoundError({ roomID: error.roomID, message: `Room not found: ${error.roomID}` }))
}

export const RoomHandler = HttpApiBuilder.group(Api, "server.room", (handlers) =>
  Effect.gen(function* () {
    const rooms = yield* Room.Service
    const codes = yield* ServerRooms.Service
    const sessions = yield* Session.Service
    const instances = yield* Instance.Service
    const auth = yield* ServerAuth.Config

    // Guest routes skip the server credential; the room token is the only proof,
    // and it only opens the room it was issued for, while the host keeps its guest a member.
    const guestOf = Effect.fnUntraced(function* (roomID: Room.ID) {
      const request = yield* HttpServerRequest.HttpServerRequest
      const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? "")?.[1]
      const token = bearer ? ServerRooms.verifyToken(auth, bearer) : undefined
      if (!token || token.roomID !== roomID)
        return yield* new UnauthorizedError({ message: "Room token is missing, expired or for another room" })
      const room = yield* rooms.get(roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
      const member = yield* rooms.member(roomID, token.guest.id)
      if (!member) return yield* new UnauthorizedError({ message: "The host removed you from this room" })
      codes.touch(member.id)
      return { room, guest: token.guest, member }
    })

    // Viewers read; posting needs member and answering permission requests needs helper.
    const guestWho = Effect.fnUntraced(function* (roomID: Room.ID, needs: Exclude<Room.Role, "viewer">) {
      const joined = yield* guestOf(roomID)
      if (RANK[joined.member.role] < RANK[needs])
        return yield* new ForbiddenError({
          message:
            needs === "helper" ? "The host answers permission requests in this room" : "You may only watch this room",
        })
      return joined
    })

    const memberOf = Effect.fnUntraced(function* (roomID: Room.ID, guestID: string) {
      yield* rooms.get(roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
      const member = yield* rooms.member(roomID, guestID)
      if (!member) return yield* new InvalidRequestError({ message: "This guest is not in the room", field: "guestID" })
      return member
    })

    // Notes live in the session's location, which a guest never names, so the session decides where to look.
    const boundNote = Effect.fnUntraced(function* (sessionID: Session.ID) {
      const session = yield* sessionInfo(sessions, sessionID)
      return yield* NoteStore.Service.use((notes) => notes.bound(sessionID)).pipe(
        instances.provide(session),
        locationErrors,
        Effect.orDie,
      )
    })

    return handlers
      .handle("room.list", () => rooms.list().pipe(Effect.map((data) => ({ data }))))
      .handle(
        "room.create",
        Effect.fn(function* (ctx) {
          yield* sessions.get(ctx.payload.sessionID).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
          return { data: yield* rooms.create(ctx.payload) }
        }),
      )
      .handle(
        "room.update",
        Effect.fn(function* (ctx) {
          return {
            data: yield* rooms
              .update(ctx.params.roomID, ctx.payload)
              .pipe(Effect.catchTag("Room.NotFoundError", missingRoom)),
          }
        }),
      )
      .handle(
        "room.remove",
        Effect.fn(function* (ctx) {
          yield* rooms.remove(ctx.params.roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "room.code",
        Effect.fn(function* (ctx) {
          yield* rooms.get(ctx.params.roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
          return yield* codes.issueCode(ctx.params.roomID)
        }),
      )
      .handle("room.public", () =>
        rooms.list().pipe(
          Effect.map((list) => ({
            host: hostname(),
            rooms: list.map((room) => ({ id: room.id, name: room.name, open: room.open === true })),
          })),
        ),
      )
      .handle(
        "room.join",
        Effect.fn(function* (ctx) {
          const name = ctx.payload.name.trim()
          if (name === "" || name.length > 64)
            return yield* new InvalidRequestError({ message: "Name must be 1 to 64 characters", field: "name" })
          const code = ctx.payload.code?.trim()
          const roomID = code ? yield* codes.redeemCode(code) : ctx.payload.roomID
          // A code can outlive its room; both cases read the same to the guest.
          const room = roomID ? yield* rooms.get(roomID).pipe(Effect.orElseSucceed(() => undefined)) : undefined
          if (!room || (!code && !room.open))
            return yield* new UnauthorizedError({
              message: code ? "Join code is wrong or expired" : "This room needs the join code its host shows",
            })
          const device = ctx.payload.device?.trim() || undefined
          const address = remoteAddress(yield* HttpServerRequest.HttpServerRequest)
          if (Room.banned(yield* rooms.bans(room.id), { device, address }))
            return yield* new UnauthorizedError({ message: "The host banned you from this room" })
          const issued = ServerRooms.issueToken(auth, room.id, name)
          const member = yield* rooms.saveMember(room.id, {
            id: issued.guest.id,
            name,
            role: Room.joinRole(room),
            device,
            address,
            joined: Date.now(),
          })
          return { ...issued, role: member.role, room }
        }),
      )
      .handle(
        "room.member.list",
        Effect.fn(function* (ctx) {
          yield* rooms.get(ctx.params.roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
          const now = Date.now()
          return {
            data: (yield* rooms.members(ctx.params.roomID)).map((member) => {
              const seen = codes.seen(member.id)
              return { ...member, seen, online: seen !== undefined && now - seen < ServerRooms.ONLINE_MS }
            }),
          }
        }),
      )
      .handle(
        "room.member.update",
        Effect.fn(function* (ctx) {
          const member = yield* memberOf(ctx.params.roomID, ctx.params.guestID)
          return { data: yield* rooms.saveMember(ctx.params.roomID, { ...member, role: ctx.payload.role }) }
        }),
      )
      .handle(
        "room.member.remove",
        Effect.fn(function* (ctx) {
          yield* memberOf(ctx.params.roomID, ctx.params.guestID)
          yield* rooms.removeMember(ctx.params.roomID, ctx.params.guestID)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "room.member.ban",
        Effect.fn(function* (ctx) {
          const member = yield* memberOf(ctx.params.roomID, ctx.params.guestID)
          const ban = yield* rooms.ban(ctx.params.roomID, {
            id: randomBytes(9).toString("base64url"),
            name: member.name,
            device: member.device,
            address: member.address,
            created: Date.now(),
          })
          yield* rooms.removeMember(ctx.params.roomID, member.id)
          return { data: ban }
        }),
      )
      .handle(
        "room.ban.list",
        Effect.fn(function* (ctx) {
          yield* rooms.get(ctx.params.roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
          return { data: yield* rooms.bans(ctx.params.roomID) }
        }),
      )
      .handle(
        "room.ban.remove",
        Effect.fn(function* (ctx) {
          yield* rooms.get(ctx.params.roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
          yield* rooms.unban(ctx.params.roomID, ctx.params.banID)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "room.guest.session.messages",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          return yield* messagePage(sessions, joined.room.sessionID, ctx.query)
        }),
      )
      .handle(
        "room.guest.get",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          return {
            room: joined.room,
            guest: joined.guest,
            role: joined.member.role,
            session: yield* sessions
              .get(joined.room.sessionID)
              .pipe(Effect.catchTag("Session.NotFoundError", missingSession)),
          }
        }),
      )
      .handle(
        "room.guest.log",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          yield* sessions.get(joined.room.sessionID).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
          return sessions
            .log({ sessionID: joined.room.sessionID, after: ctx.query.after, follow: ctx.query.follow })
            .pipe(Stream.orDie)
        }),
      )
      .handle(
        "room.guest.messages",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          const messages = yield* sessions
            .messages({ sessionID: joined.room.sessionID, limit: CHAT_LIMIT, order: "desc" })
            .pipe(Effect.catchTag("Session.NotFoundError", missingSession), Effect.orDie)
          const note = yield* boundNote(joined.room.sessionID)
          return {
            data: messages.toReversed().flatMap(chatMessage),
            running: (yield* sessions.active).has(joined.room.sessionID),
            note: note && { name: note.name, title: note.frontmatter.title || note.name },
          }
        }),
      )
      .handle(
        "room.guest.note",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          return { data: (yield* boundNote(joined.room.sessionID)) ?? null }
        }),
      )
      .handle(
        "room.guest.prompt",
        Effect.fn(function* (ctx) {
          const joined = yield* guestWho(ctx.params.roomID, "member")
          if (ctx.payload.text.trim() === "")
            return yield* new InvalidRequestError({ message: "Message is empty", field: "text" })
          return {
            data: yield* sessions
              .prompt({
                sessionID: joined.room.sessionID,
                text: ctx.payload.text,
                // The server stamps the author from the token, so a guest cannot speak as someone else.
                metadata: { room: { id: joined.room.id, guest: joined.guest } },
              })
              .pipe(Effect.catchTag("Session.NotFoundError", missingSession), Effect.orDie),
          }
        }),
      )
      .handle(
        "room.guest.permission.list",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          const session = yield* sessionInfo(sessions, joined.room.sessionID)
          const requests = yield* Permission.Service.use((permission) =>
            permission.forSession(joined.room.sessionID),
          ).pipe(instances.provide(session), locationErrors, Effect.orDie)
          return { data: requests }
        }),
      )
      .handle(
        "room.guest.permission.reply",
        Effect.fn(function* (ctx) {
          const joined = yield* guestWho(ctx.params.roomID, "helper")
          const session = yield* sessionInfo(sessions, joined.room.sessionID)
          yield* Effect.gen(function* () {
            const permission = yield* Permission.Service
            const request = yield* permission.get(ctx.params.requestID)
            if (!request || request.sessionID !== joined.room.sessionID)
              return yield* missingRequest(ctx.params.requestID)
            yield* permission
              .reply({ requestID: ctx.params.requestID, reply: ctx.payload.decision, message: ctx.payload.message })
              .pipe(Effect.catchTag("Permission.NotFoundError", () => missingRequest(ctx.params.requestID)))
          }).pipe(instances.provide(session), locationErrors, Effect.catchTag("LocationNotFoundError", Effect.die))
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
