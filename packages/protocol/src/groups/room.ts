import { Room } from "@opencode/schema/room"
import { Session } from "@opencode/schema/session"
import { SessionEvent } from "@opencode/schema/session-event"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { EventLog } from "@opencode/schema/event-log"
import { Event } from "@opencode/schema/event"
import { Note } from "@opencode/schema/note"
import { Permission } from "@opencode/schema/permission"
import { optional } from "@opencode/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import {
  ForbiddenError,
  InvalidRequestError,
  PermissionNotFoundError,
  RoomNotFoundError,
  SessionNotFoundError,
  UnauthorizedError,
} from "../errors.js"
import { BooleanFromString } from "./session.js"

const GUEST_PATH = /^\/api\/room\/(join|public|[^/]+\/guest(\/.*)?)$/

// Guest routes carry a room token instead of the server credential, so the
// Authorization middleware lets them through and the room handler verifies the
// token against the one room it names.
export function isRoomGuestURL(url: URL) {
  return GUEST_PATH.test(url.pathname)
}

export const RoomGroup = HttpApiGroup.make("server.room")
  .add(
    HttpApiEndpoint.get("room.list", "/api/room", {
      success: Schema.Struct({ data: Schema.Array(Room.Info) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.list",
        summary: "List rooms",
        description: "List the rooms this host shares with other devices.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.create", "/api/room", {
      payload: Schema.Struct({
        sessionID: Session.ID,
        name: Schema.String.pipe(Schema.optional),
        ai: Room.AiMessaging.pipe(Schema.optional),
        guestApprovals: Schema.Boolean.pipe(Schema.optional),
      }),
      success: Schema.Struct({ data: Room.Info }),
      error: SessionNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.create",
        summary: "Create room",
        description: "Share a session as a room that other devices can join with a code.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("room.update", "/api/room/:roomID", {
      params: { roomID: Room.ID },
      payload: Schema.Struct({
        name: Schema.String.pipe(Schema.optional),
        ai: Room.AiMessaging.pipe(Schema.optional),
        guestApprovals: Schema.Boolean.pipe(Schema.optional),
      }),
      success: Schema.Struct({ data: Room.Info }),
      error: RoomNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.update",
        summary: "Update room",
        description: "Rename a room or change what guests and the host model may do in it.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("room.remove", "/api/room/:roomID", {
      params: { roomID: Room.ID },
      success: HttpApiSchema.NoContent,
      error: RoomNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.remove",
        summary: "Close room",
        description: "Stop sharing a room. Its session stays; every guest token for it stops working.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.code", "/api/room/:roomID/code", {
      params: { roomID: Room.ID },
      success: Room.JoinCode,
      error: RoomNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.code",
        summary: "Create join code",
        description: "Create a short-lived code that lets devices join this room until it expires.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.public", "/api/room/public", {
      success: Schema.Struct({
        host: Schema.String,
        rooms: Schema.Array(Schema.Struct({ id: Room.ID, name: Schema.String })),
      }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.public",
        summary: "List joinable rooms",
        description:
          "Names of the rooms this host shares, for devices looking for rooms on the network. Joining still needs a code.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.join", "/api/room/join", {
      payload: Schema.Struct({ code: Schema.String, name: Schema.String }),
      success: Room.Joined,
      error: [UnauthorizedError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.join",
        summary: "Join room",
        description: "Redeem a join code for a guest token scoped to one room.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.guest.get", "/api/room/:roomID/guest", {
      params: { roomID: Room.ID },
      success: Schema.Struct({ room: Room.Info, guest: Room.Guest, session: Session.Info }),
      error: [UnauthorizedError, RoomNotFoundError, SessionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.get",
        summary: "Get joined room",
        description: "Return the room, the calling guest and the shared session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.guest.log", "/api/room/:roomID/guest/log", {
      params: { roomID: Room.ID },
      query: {
        after: Schema.NumberFromString.pipe(Schema.decodeTo(Event.Seq), Schema.optional),
        follow: BooleanFromString.pipe(Schema.optional),
      },
      success: HttpApiSchema.StreamSse({
        data: Schema.Union([SessionEvent.Durable, EventLog.Synced]).annotate({ identifier: "RoomLogItem" }),
      }),
      error: [UnauthorizedError, RoomNotFoundError, SessionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.log",
        summary: "Read the room log",
        description: "The shared session's durable event log, continuing with live events when follow=true.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.guest.messages", "/api/room/:roomID/guest/message", {
      params: { roomID: Room.ID },
      success: Schema.Struct({
        data: Schema.Array(Room.Message),
        running: Schema.Boolean,
        // Set while the shared session is bound to a note, so guests know prompts write into it.
        note: optional(Schema.Struct({ name: Note.Slug, title: Schema.String })),
      }),
      error: [UnauthorizedError, RoomNotFoundError, SessionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.messages",
        summary: "Read the room chat",
        description:
          "The latest messages of the shared session as plain chat, whether the host model is working, and the note the session writes into, if any.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.guest.note", "/api/room/:roomID/guest/note", {
      params: { roomID: Room.ID },
      success: Schema.Struct({ data: Schema.NullOr(Note.Info) }),
      error: [UnauthorizedError, RoomNotFoundError, SessionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.note",
        summary: "Read the room note",
        description:
          "The note bound to the shared session, which prompts in this room write into, or null when none is bound.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.guest.prompt", "/api/room/:roomID/guest/prompt", {
      params: { roomID: Room.ID },
      payload: Schema.Struct({ text: Schema.String }),
      success: Schema.Struct({ data: SessionInbox.User }),
      error: [UnauthorizedError, RoomNotFoundError, SessionNotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.prompt",
        summary: "Send a message to the room",
        description: "Post a message into the shared session as the calling guest; the host model answers.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.guest.permission.list", "/api/room/:roomID/guest/permission", {
      params: { roomID: Room.ID },
      success: Schema.Struct({ data: Schema.Array(Permission.Request) }),
      error: [UnauthorizedError, RoomNotFoundError, SessionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.permission.list",
        summary: "List room permission requests",
        description: "Pending permission requests of the shared session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.guest.permission.reply", "/api/room/:roomID/guest/permission/:requestID/reply", {
      params: { roomID: Room.ID, requestID: Permission.ID },
      payload: Schema.Struct({ decision: Permission.Reply, message: Schema.String.pipe(Schema.optional) }),
      success: HttpApiSchema.NoContent,
      error: [UnauthorizedError, ForbiddenError, RoomNotFoundError, SessionNotFoundError, PermissionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.permission.reply",
        summary: "Answer a room permission request",
        description: "Answer the host model's permission request; allowed only when the host lets guests approve.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "room", description: "Rooms shared with other devices." }))
