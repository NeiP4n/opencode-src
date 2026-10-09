/**
 * The canvas: while a note is bound to a chat, requests in that chat are edits to
 * the note. This source observes the binding (and the note's length setting) for
 * one Session, so the model learns chronologically when the binding changes.
 */
export * as NoteInstructions from "./note-instructions.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Note } from "@opencode/schema/note"
import type { Session } from "@opencode/schema/session"
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
  readonly load: (session: Session.Info) => Effect.Effect<Instructions.List>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/NoteInstructions") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const notes = yield* NoteStore.Service
    const rooms = yield* Room.Service

    // Only a note's dedicated chat writes into it: the chat names its note in its
    // metadata, so an ordinary chat never becomes a canvas.
    const observe = Effect.fn("NoteInstructions.observe")(function* (session: Session.Info) {
      const name = Note.chatOf(session.metadata)
      if (!name) return Instructions.removed
      const note = yield* notes
        .get(name)
        .pipe(Effect.catchTag("NoteStore.NotFoundError", () => Effect.succeed(undefined)))
      if (!note) return Instructions.removed
      const shared = (yield* rooms.list()).some((room) => room.sessionID === session.id)
      return {
        name: note.name,
        title: note.frontmatter.title || note.name,
        length: note.frontmatter.length ?? Note.FallbackLength,
        shared,
      } satisfies Canvas
    })

    return Service.of({
      load: (session) =>
        Effect.succeed(
          Instructions.make({
            key: Instructions.Key.make("core/canvas"),
            codec: Schema.toCodecJson(Canvas),
            // An unreadable notes folder must not block the chat from starting, so it
            // reads as "no note bound" rather than as an unavailable source.
            read: observe(session).pipe(Effect.orElseSucceed(() => Instructions.removed)),
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
    "  This is the only thing you can change in this chat: read the note with the note tool, then write the result into it with note edit, passing expectedMtime from that read.",
    "  If the user asks for anything outside the note, do not do it and do not look for another tool: say in one sentence that this chat works only on this note and nothing else will be changed.",
    "  Reply in chat with a one or two sentence summary of what changed instead of repeating the note.",
    `  Length: ${Policy[canvas.length]}.`,
    ...(canvas.shared
      ? [
          "  This chat is shared in a room: several people may be prompting it, and all of them are editing the same note.",
        ]
      : []),
    "</canvas>",
  ].join("\n")
}

const Policy: Record<Note.Length, string> = {
  brief: "brief and useful, only what matters and no filler",
  balanced: "balanced, complete but compact",
  detailed: "detailed and useful, thorough with examples and structure, but no padding",
}
