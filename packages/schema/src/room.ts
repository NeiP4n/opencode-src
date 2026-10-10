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

// What a guest may do in a room. Viewers read, members also post prompts and start
// sessions, helpers also answer the host model's permission requests, and cohosts also
// pick the model and agent and run commands.
export const Role = Schema.Literals(["viewer", "member", "helper", "cohost"])
export type Role = typeof Role.Type

export const Info = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  name: Schema.String,
  ai: AiMessaging,
  // Rooms saved before roles existed: whether guests could answer permission requests.
  // Read only to choose defaultRole for such rooms.
  guestApprovals: Schema.Boolean,
  // The role a guest gets on joining; absent on rooms saved before roles existed.
  defaultRole: Role.pipe(Schema.optional),
  // Set when the room shares a whole project: every session under this directory, and
  // new ones guests start there. Without it the room shares sessionID alone.
  directory: Schema.String.pipe(Schema.optional),
  // Whether guests may join without a code; absent on rooms saved before the option existed.
  open: Schema.Boolean.pipe(Schema.optional),
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

// A guest the host admitted. Removing the member revokes its token; the device key
// and address are what a ban matches when the same person tries to join again.
export const Member = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Role,
  // A random key the guest's client keeps across joins.
  device: Schema.String.pipe(Schema.optional),
  // The network address it joined from; absent for loopback, which tunnels such as Porthole share.
  address: Schema.String.pipe(Schema.optional),
  joined: Schema.Number,
}).annotate({ identifier: "Room.Member" })
export interface Member extends Schema.Schema.Type<typeof Member> {}

// A member as the host sees it, with when the server last heard from them.
export const MemberView = Schema.Struct({
  ...Member.fields,
  seen: Schema.Number.pipe(Schema.optional),
  online: Schema.Boolean,
}).annotate({ identifier: "Room.MemberView" })
export interface MemberView extends Schema.Schema.Type<typeof MemberView> {}

// Keeps a banned guest out of one room by device key or by address.
export const Ban = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  device: Schema.String.pipe(Schema.optional),
  address: Schema.String.pipe(Schema.optional),
  created: Schema.Number,
}).annotate({ identifier: "Room.Ban" })
export interface Ban extends Schema.Schema.Type<typeof Ban> {}

// What a guest receives for a valid join code: the token to send as a Bearer
// credential on guest routes, scoped to this one room.
export const Joined = Schema.Struct({
  token: Schema.String,
  guest: Guest,
  role: Role,
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
