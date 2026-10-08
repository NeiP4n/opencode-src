import { Instance } from "@opencode/core/instance/service"
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
import { Effect, Stream } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ServerAuth } from "../auth"
import { locationErrors, sessionInfo } from "../location"
import { ServerRooms } from "../rooms"
import { missingSession } from "./session-error"

function missingRequest(id: Permission.ID) {
  return new PermissionNotFoundError({ requestID: id, message: `Permission request not found: ${id}` })
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
    // and it only opens the room it was issued for.
    const guestOf = Effect.fnUntraced(function* (roomID: Room.ID) {
      const request = yield* HttpServerRequest.HttpServerRequest
      const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? "")?.[1]
      const token = bearer ? ServerRooms.verifyToken(auth, bearer) : undefined
      if (!token || token.roomID !== roomID)
        return yield* new UnauthorizedError({ message: "Room token is missing, expired or for another room" })
      const room = yield* rooms.get(roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
      return { room, guest: token.guest }
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
      .handle(
        "room.join",
        Effect.fn(function* (ctx) {
          const name = ctx.payload.name.trim()
          if (name === "" || name.length > 64)
            return yield* new InvalidRequestError({ message: "Name must be 1 to 64 characters", field: "name" })
          const roomID = yield* codes.redeemCode(ctx.payload.code)
          // A code can outlive its room; both cases read the same to the guest.
          const room = roomID ? yield* rooms.get(roomID).pipe(Effect.orElseSucceed(() => undefined)) : undefined
          if (!room) return yield* new UnauthorizedError({ message: "Join code is wrong or expired" })
          return { ...ServerRooms.issueToken(auth, room.id, name), room }
        }),
      )
      .handle(
        "room.guest.get",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          return {
            ...joined,
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
        "room.guest.prompt",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
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
          const joined = yield* guestOf(ctx.params.roomID)
          if (!joined.room.guestApprovals)
            return yield* new ForbiddenError({ message: "The host answers permission requests in this room" })
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
