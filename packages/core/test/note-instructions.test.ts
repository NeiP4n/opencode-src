import { describe, expect } from "bun:test"
import { Effect, Layer, Option, Schema } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Instructions } from "@opencode/core/instructions/index"
import { Location } from "@opencode/core/location"
import { NoteInstructions } from "@opencode/core/note-instructions"
import { NoteStore } from "@opencode/core/note"
import { Permission } from "@opencode/core/permission"
import { Room } from "@opencode/core/room"
import { AbsolutePath } from "@opencode/core/schema"
import { Note } from "@opencode/schema/note"
import type { Session } from "@opencode/schema/session"
import { SessionID } from "@opencode/schema/session-id"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { permissionLayer } from "./lib/permission"

const session = SessionID.make("ses_canvas")

// The source reads only the id and the metadata of the chat it observes.
const chat = (note?: string) =>
  ({ id: session, metadata: note ? Note.chatMetadata(Note.Slug.make(note)) : undefined }) as unknown as Session.Info

function provide(directory: string) {
  return Effect.provide(
    AppNodeBuilder.build(LayerNode.group([NoteInstructions.node, NoteStore.node, Room.node]), [
      Location.node.replace(
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
      ),
      Permission.node.replace(permissionLayer()),
    ]),
  )
}

/** Reads the source once, the way a step boundary observes it. */
const observe = Effect.fn(function* (note?: string) {
  const source = yield* NoteInstructions.Service
  const list = yield* source.load(chat(note))
  const [entry] = yield* Instructions.read(list)
  return { list, value: entry.value }
})

const json = (value: unknown) => value as Schema.Json

describe("NoteInstructions", () => {
  it.live("renders nothing for an ordinary chat, even one a note names", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const notes = yield* NoteStore.Service
        yield* notes.create({ title: "Linked", name: "linked-note", session })

        const observed = yield* observe()

        expect(observed.value).toBe(Instructions.removed)
      }).pipe(provide(directory)),
    ),
  )

  it.live("renders the canvas in the dedicated chat of a note with its length policy", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const notes = yield* NoteStore.Service
        yield* notes.create({ title: "Room plan", name: "room-plan", session, length: "brief" })

        const observed = yield* observe("room-plan")
        const text = Instructions.renderInitial(observed.list, { "core/canvas": json(observed.value) })

        expect(text).toContain("<canvas>")
        expect(text).toContain('the note "Room plan" (.opencode/notes/room-plan.md)')
        expect(text).toContain("note edit")
        expect(text).toContain("Length: brief and useful, only what matters and no filler.")
        expect(text).not.toContain("shared in a room")
      }).pipe(provide(directory)),
    ),
  )

  it.live("leaves no escape hatch: the note is the only thing this chat may change", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const notes = yield* NoteStore.Service
        yield* notes.create({ title: "Room plan", name: "room-plan", session })

        const observed = yield* observe("room-plan")
        const text = Instructions.renderInitial(observed.list, { "core/canvas": json(observed.value) })

        // The old wording let the model leave the note; it must be gone from the source.
        expect(text).not.toContain("unless the user clearly asks")
        expect(text).toContain("This is the only thing you can change in this chat")
        expect(text).toContain("works only on this note and nothing else will be changed")
        // Naming hidden tools by name would only invite the model to ask for them.
        expect(text).not.toContain("shell")
        expect(text).not.toContain("write tool")
        expect(text).not.toContain("read tool")
      }).pipe(provide(directory)),
    ),
  )

  it.live("falls back to the balanced length and mentions the room when the chat is shared", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const notes = yield* NoteStore.Service
        const rooms = yield* Room.Service
        yield* notes.create({ title: "Room plan", name: "room-plan", session })
        const room = yield* rooms.create({ sessionID: session })

        const observed = yield* observe("room-plan")
        const text = Instructions.renderInitial(observed.list, { "core/canvas": json(observed.value) })
        yield* rooms.remove(room.id)

        expect(text).toContain("Length: balanced, complete but compact.")
        expect(text).toContain("shared in a room")
      }).pipe(provide(directory)),
    ),
  )

  it.live("announces a length change, another note and a deleted note chronologically", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const notes = yield* NoteStore.Service
        const note = yield* notes.create({ title: "Room plan", name: "room-plan", session })
        const before = yield* observe("room-plan")

        yield* notes.update({ name: "room-plan", expectedMtime: note.mtime, length: "detailed" })
        const lengthChanged = yield* observe("room-plan")
        const lengthText = Instructions.renderUpdate(
          lengthChanged.list,
          { "core/canvas": json(before.value) },
          { "core/canvas": Option.some(json(lengthChanged.value)) },
        )

        const spec = yield* notes.create({ title: "Spec", name: "spec-note", session })
        const moved = yield* observe("spec-note")
        const movedText = Instructions.renderUpdate(
          moved.list,
          { "core/canvas": json(lengthChanged.value) },
          { "core/canvas": Option.some(json(moved.value)) },
        )

        yield* notes.remove({ name: "spec-note", expectedMtime: spec.mtime })
        const gone = yield* observe("spec-note")
        const goneText = Instructions.renderUpdate(
          gone.list,
          { "core/canvas": json(moved.value) },
          { "core/canvas": Option.none() },
        )

        expect(lengthText).toContain("The canvas settings changed")
        expect(lengthText).toContain("Length: detailed and useful")
        expect(movedText).toContain("now bound to a different note")
        expect(movedText).toContain('the note "Spec" (.opencode/notes/spec-note.md)')
        expect(gone.value).toBe(Instructions.removed)
        expect(goneText).toBe(
          'The note "Spec" is no longer bound to this chat. Stop treating requests as edits to it and answer in chat as usual.',
        )
      }).pipe(provide(directory)),
    ),
  )
})
