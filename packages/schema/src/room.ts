export * as Room from "./room.js"

import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { PositiveInt, statics } from "./schema.js"
import { SessionID } from "./session-id.js"

// A Room shares one host Session with other devices on the network. Guests
// read it and post prompts into it; only the host's model answers.
export const ID = Schema.String.check(Schema.isStartsWith("room")).pipe(
  Schema.brand("RoomID"),
  statics((schema) => ({ create: () => schema.make("room_" + ascending()) })),
)
export type ID = typeof ID.Type

// Where the host's model may send messages on its own: only rooms the host
// linked to this one, or any room it discovered, each send asking permission.
export const AiMessaging = Schema.Literals(["linked", "discovered"])
export type AiMessaging = typeof AiMessaging.Type

export const Info = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  name: Schema.String,
  ai: AiMessaging,
  // Whether guests may answer the model's permission requests; otherwise only the host can.
  guestApprovals: Schema.Boolean,
  created: Schema.Number,
}).annotate({ identifier: "Room.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const JoinCode = Schema.Struct({
  code: Schema.String,
  expires_in: PositiveInt,
}).annotate({ identifier: "Room.JoinCode" })
export interface JoinCode extends Schema.Schema.Type<typeof JoinCode> {}

export const Guest = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
}).annotate({ identifier: "Room.Guest" })
export interface Guest extends Schema.Schema.Type<typeof Guest> {}

// What a guest receives for a valid join code: the token to send as a Bearer
// credential on guest routes, scoped to this one room.
export const Joined = Schema.Struct({
  token: Schema.String,
  guest: Guest,
  room: Info,
}).annotate({ identifier: "Room.Joined" })
export interface Joined extends Schema.Schema.Type<typeof Joined> {}

// What a guest sees of the shared session: who said what. Tool calls, reasoning
// and file paths stay on the host.
export const Message = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant"]),
  // The guest's name, "host" for the host's own prompts, absent for the model.
  author: Schema.String.pipe(Schema.optional),
  text: Schema.String,
  created: Schema.Number,
}).annotate({ identifier: "Room.Message" })
export interface Message extends Schema.Schema.Type<typeof Message> {}
