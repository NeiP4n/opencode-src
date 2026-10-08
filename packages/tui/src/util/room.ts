import { Option, Schema } from "effect"
import { createSignal } from "solid-js"

// The host server stamps guest prompts with the author from the room token, so
// this metadata is the only record of who wrote a message in a hosted session.
const RoomMetadata = Schema.Struct({
  room: Schema.Struct({
    id: Schema.String,
    guest: Schema.Struct({ id: Schema.String, name: Schema.String }),
  }),
})
const decodeRoomMetadata = Schema.decodeUnknownOption(RoomMetadata)

export function roomAuthor(metadata: unknown) {
  return decodeRoomMetadata(metadata).pipe(
    Option.map((value) => value.room),
    Option.getOrUndefined,
  )
}

// Distinct guest names that posted into one room. There is no presence
// tracking, so this counts who took part, not who is connected now.
export function roomGuests(messages: readonly { type: string; metadata?: unknown }[], roomID: string) {
  return new Set(
    messages.flatMap((message) => {
      if (message.type !== "user") return []
      const author = roomAuthor(message.metadata)
      return author?.id === roomID ? [author.guest.name] : []
    }),
  ).size
}

// Rooms change only through host actions in this client, so readers of the
// room list refetch on this revision instead of polling the server.
const [revision, setRevision] = createSignal(0)
export const roomListRevision = revision
export function roomListChanged() {
  setRevision((value) => value + 1)
}
