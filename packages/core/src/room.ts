export * as Room from "./room.js"

import { Context, Effect, Layer, Option, Schema } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Room } from "@opencode/schema/room"
import { SessionID } from "@opencode/schema/session-id"
import { KV } from "./kv.js"

export const ID = Room.ID
export type ID = Room.ID

export const Info = Room.Info
export type Info = Room.Info

export const Message = Room.Message
export type Message = Room.Message

export const CreateInput = Schema.Struct({
  sessionID: SessionID,
  name: Schema.String.pipe(Schema.optional),
  ai: Room.AiMessaging.pipe(Schema.optional),
  guestApprovals: Schema.Boolean.pipe(Schema.optional),
}).annotate({ identifier: "Room.CreateInput" })
export type CreateInput = typeof CreateInput.Type

export const UpdateInput = Schema.Struct({
  name: Schema.String.pipe(Schema.optional),
  ai: Room.AiMessaging.pipe(Schema.optional),
  guestApprovals: Schema.Boolean.pipe(Schema.optional),
}).annotate({ identifier: "Room.UpdateInput" })
export type UpdateInput = typeof UpdateInput.Type

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Room.NotFoundError", {
  roomID: Schema.String,
}) {}

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<Info>>
  readonly get: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly create: (input: CreateInput) => Effect.Effect<Info>
  readonly update: (id: ID, input: UpdateInput) => Effect.Effect<Info, NotFoundError>
  readonly remove: (id: ID) => Effect.Effect<void, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Room") {}

// Rooms are a handful of small records owned by this host, so they live in the
// shared KV table under one prefix instead of needing their own migration.
const PREFIX = "room/"
const decode = Schema.decodeUnknownOption(Info)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service

    const get = Effect.fn("Room.get")(function* (id: ID) {
      const room = decode(yield* kv.get(PREFIX + id))
      if (Option.isNone(room)) return yield* new NotFoundError({ roomID: id })
      return room.value
    })

    const save = (room: Info) => kv.set(PREFIX + room.id, Schema.encodeSync(Info)(room)).pipe(Effect.as(room))

    return Service.of({
      list: Effect.fn("Room.list")(function* () {
        const result = yield* kv.scan({ prefix: PREFIX, limit: 1000 })
        return result.entries
          .flatMap((entry) => Option.toArray(decode(entry.value)))
          .toSorted((a, b) => a.created - b.created)
      }),
      get,
      create: Effect.fn("Room.create")(function* (input: CreateInput) {
        return yield* save({
          id: ID.create(),
          sessionID: input.sessionID,
          name: input.name?.trim() || "Room",
          ai: input.ai ?? "linked",
          guestApprovals: input.guestApprovals ?? false,
          created: Date.now(),
        })
      }),
      update: Effect.fn("Room.update")(function* (id: ID, input: UpdateInput) {
        const room = yield* get(id)
        return yield* save({
          ...room,
          name: input.name?.trim() || room.name,
          ai: input.ai ?? room.ai,
          guestApprovals: input.guestApprovals ?? room.guestApprovals,
        })
      }),
      remove: Effect.fn("Room.remove")(function* (id: ID) {
        yield* get(id)
        yield* kv.remove(PREFIX + id)
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node] })
