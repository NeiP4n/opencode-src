/**
 * The canvas: while a note is bound to a chat, requests in that chat are edits to
 * the note. This source observes the binding (and the note's length setting) for
 * one Session, so the model learns chronologically when the binding changes.
 */
export * as NoteInstructions from "./note-instructions.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Note } from "@opencode/schema/note"
import { SessionID } from "@opencode/schema/session-id"
import { Context, Effect, Layer, Schema } from "effect"
import { Instructions } from "./instructions/index.js"
import { NoteStore } from "./note.js"
import { Room } from "./room.js"

const Canvas = Schema.Struct({
  name: Note.Slug,
  title: Schema.String,
  length: Note.Length,
  /** Whether the chat is shared in a room, so guests prompt it too. */
  shared: Schema.Boolean,
})
type Canvas = typeof Canvas.Type

export interface Interface {
  readonly load: (sessionID: SessionID) => Effect.Effect<Instructions.List>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/NoteInstructions") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const notes = yield* NoteStore.Service
    const rooms = yield* Room.Service

    const observe = Effect.fn("NoteInstructions.observe")(function* (sessionID: SessionID) {
      const note = yield* notes.bound(sessionID)
      if (!note) return Instructions.removed
      const shared = (yield* rooms.list()).some((room) => room.sessionID === sessionID)
      return {
        name: note.name,
        title: note.frontmatter.title || note.name,
        length: note.frontmatter.length ?? Note.FallbackLength,
        shared,
      } satisfies Canvas
    })

    return Service.of({
      load: (sessionID) =>
        Effect.succeed(
          Instructions.make({
            key: Instructions.Key.make("core/canvas"),
            codec: Schema.toCodecJson(Canvas),
            // An unreadable notes folder must not block the chat from starting, so it
            // reads as "no note bound" rather than as an unavailable source.
            read: observe(sessionID).pipe(Effect.orElseSucceed(() => Instructions.removed)),
            render: {
              initial: render,
              changed: (previous, current) =>
                [
                  previous.name === current.name
                    ? "The canvas settings changed; this replaces the previous canvas instructions:"
                    : "This chat is now bound to a different note; this replaces the previous canvas instructions:",
                  render(current),
                ].join("\n"),
              removed: (previous) =>
                `The note "${previous.title}" is no longer bound to this chat. Stop treating requests as edits to it and answer in chat as usual.`,
            },
          }),
        ),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [NoteStore.node, Room.node] })

function render(canvas: Canvas) {
  return [
    "<canvas>",
    `  The user is working on the note "${canvas.title}" (.opencode/notes/${canvas.name}.md) alongside this chat.`,
    "  Treat requests in this chat as edits to that note unless the user clearly asks for something else: read it with the note tool, then write the result into it with note edit, passing expectedMtime from that read.",
    "  Reply in chat with a one or two sentence summary of what changed instead of repeating the note.",
    `  Length: ${Policy[canvas.length]}.`,
    ...(canvas.shared
      ? ["  This chat is shared in a room: several people may be prompting it, and all of them are editing the same note."]
      : []),
    "</canvas>",
  ].join("\n")
}

const Policy: Record<Note.Length, string> = {
  brief: "brief and useful, only what matters and no filler",
  balanced: "balanced, complete but compact",
  detailed: "detailed and useful, thorough with examples and structure, but no padding",
}
