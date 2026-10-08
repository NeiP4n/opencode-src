import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { NoteStore } from "@opencode/core/note"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionID } from "@opencode/schema/session-id"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { permissionLayer } from "./lib/permission"

function provide(directory: string) {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  return Effect.provide(
    AppNodeBuilder.build(LayerNode.group([NoteStore.node]), [
      Location.node.replace(activeLocation),
      Permission.node.replace(permissionLayer()),
    ]),
  )
}

const file = (directory: string, name: string) => path.join(directory, ".opencode", "notes", `${name}.md`)
const text = (target: string) => Effect.promise(() => fs.readFile(target, "utf8"))
const write = (target: string, content: string) => Effect.promise(() => fs.writeFile(target, content))
/** Forces an mtime a whole number of milliseconds away, so a guard can see the change. */
const retime = (target: string, mtime: number) =>
  Effect.promise(() => fs.utimes(target, new Date(mtime), new Date(mtime)))

describe("NoteStore", () => {
  it.live("writes a created note to disk with an inbox status and service timestamps", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const notes = yield* NoteStore.Service
        const created = yield* notes.create({
          title: "  План по комнатам  ",
          name: "room-plan",
          body: "Тело заметки.",
          tags: ["net"],
          session: SessionID.make("ses_01"),
        })

        expect(created.name).toBe("room-plan")
        expect(created.body).toBe("Тело заметки.")
        expect(created.mtime).toBeGreaterThan(0)
        expect(created.frontmatter.title).toBe("План по комнатам")
        expect(created.frontmatter.status).toBe("inbox")
        expect(created.frontmatter.tags).toEqual(["net"])
        expect(created.frontmatter.session).toBe(SessionID.make("ses_01"))
        expect(created.frontmatter.created).toBe(created.frontmatter.updated)
        expect(created.frontmatter.created).toBeGreaterThan(0)
        expect(yield* text(file(directory, "room-plan"))).toBe(
          [
            "---",
            "title: План по комнатам",
            "status: inbox",
            "tags: [net]",
            "session: ses_01",
            `created: ${created.frontmatter.created}`,
            `updated: ${created.frontmatter.updated}`,
            "---",
            "",
            "Тело заметки.",
          ].join("\n"),
        )
        expect(yield* notes.get("room-plan")).toEqual(created)
      }).pipe(provide(directory)),
    ),
  )

  it.live("lists notes by updated descending and reads a file without frontmatter", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const notes = yield* NoteStore.Service
        const alpha = yield* notes.create({ title: "Alpha", name: "alpha-note", body: "первый" })
        yield* notes.create({ title: "Beta", name: "beta-note", body: "второй" })
        // A human edits the file outside the service, so alpha is now the older note.
        yield* write(
          file(directory, "alpha-note"),
          (yield* text(file(directory, "alpha-note"))).replace(`updated: ${alpha.frontmatter.updated}`, "updated: 1"),
        )
        yield* write(file(directory, "broken"), "просто текст без frontmatter\n")

        const listed = yield* notes.list()

        expect(listed.map((note) => note.name)).toEqual(["beta-note", "alpha-note", "broken"])
        expect(listed[0].frontmatter.title).toBe("Beta")
        expect(listed[2].frontmatter.title).toBe("")
        expect(listed[2].frontmatter.status).toBe("inbox")
        expect(listed[2].frontmatter.updated).toBe(0)
        expect(listed[2].body).toBe("просто текст без frontmatter\n")
      }).pipe(provide(directory)),
    ),
  )

  it.live("refuses an edit of a file that changed on disk and leaves the file untouched", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const notes = yield* NoteStore.Service
        const note = yield* notes.create({ title: "План", name: "room-plan", body: "черновик" })
        const human = "правка человека\n"
        yield* write(file(directory, "room-plan"), human)
        yield* retime(file(directory, "room-plan"), note.mtime + 5000)

        const error = yield* Effect.flip(
          notes.edit({ name: "room-plan", expectedMtime: note.mtime, body: "правка агента" }),
        )

        expect(error._tag).toBe("NoteStore.ConflictError")
        expect(error.message).toContain("read it again before writing")
        expect(yield* text(file(directory, "room-plan"))).toBe(human)
        expect((yield* notes.get("room-plan")).body).toBe(human)
      }).pipe(provide(directory)),
    ),
  )

  it.live("writes an edit of a body that still holds what the caller read", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const notes = yield* NoteStore.Service
        const note = yield* notes.create({ title: "План", name: "room-plan", body: "строка" })

        const replaced = yield* notes.edit({
          name: "room-plan",
          expectedMtime: note.mtime,
          body: "первая\nвторая",
        })
        const appended = yield* notes.edit({
          name: "room-plan",
          expectedMtime: replaced.mtime,
          body: "третья",
          mode: "append",
        })

        expect(replaced.body).toBe("первая\nвторая")
        expect(replaced.frontmatter.created).toBe(note.frontmatter.created)
        expect(replaced.frontmatter.updated).toBeGreaterThanOrEqual(note.frontmatter.updated)
        expect(appended.body).toBe("первая\nвторая\nтретья")
        expect(yield* text(file(directory, "room-plan"))).toBe(
          [
            "---",
            "title: План",
            "status: inbox",
            "tags: []",
            `created: ${note.frontmatter.created}`,
            `updated: ${appended.frontmatter.updated}`,
            "---",
            "",
            "первая",
            "вторая",
            "третья",
          ].join("\n"),
        )
        expect(yield* notes.get("room-plan")).toEqual(appended)
      }).pipe(provide(directory)),
    ),
  )

  it.live("updates frontmatter fields of a read note and keeps its body and created time", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const notes = yield* NoteStore.Service
        const note = yield* notes.create({ title: "План", name: "room-plan", body: "тело" })

        const updated = yield* notes.update({
          name: "room-plan",
          expectedMtime: note.mtime,
          title: "План v2",
          status: "active",
          tags: ["net", "lan"],
        })

        expect(updated.frontmatter.title).toBe("План v2")
        expect(updated.frontmatter.status).toBe("active")
        expect(updated.frontmatter.tags).toEqual(["net", "lan"])
        expect(updated.frontmatter.created).toBe(note.frontmatter.created)
        expect(updated.body).toBe("тело")
        expect(yield* text(file(directory, "room-plan"))).toBe(
          [
            "---",
            "title: План v2",
            "status: active",
            "tags: [net, lan]",
            `created: ${note.frontmatter.created}`,
            `updated: ${updated.frontmatter.updated}`,
            "---",
            "",
            "тело",
          ].join("\n"),
        )
      }).pipe(provide(directory)),
    ),
  )

  it.live("links a session into the frontmatter of a note", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const notes = yield* NoteStore.Service
        const note = yield* notes.create({ title: "План", name: "room-plan", body: "тело" })
        expect(note.frontmatter.session).toBeUndefined()

        const linked = yield* notes.link({
          name: "room-plan",
          expectedMtime: note.mtime,
          session: SessionID.make("ses_42"),
        })

        expect(linked.frontmatter.session).toBe(SessionID.make("ses_42"))
        expect(linked.body).toBe("тело")
        expect(yield* text(file(directory, "room-plan"))).toContain("session: ses_42")
        expect((yield* notes.get("room-plan")).frontmatter.session).toBe(SessionID.make("ses_42"))
      }).pipe(provide(directory)),
    ),
  )

  it.live("gives a second note of the same name a free name and keeps the first one", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const notes = yield* NoteStore.Service
        const first = yield* notes.create({ title: "План", name: "room-plan", body: "первое" })

        const second = yield* notes.create({ title: "План", name: "room-plan", body: "второе" })
        const third = yield* notes.create({ title: "План", name: "room-plan", body: "третье" })

        expect([first.name, second.name, third.name]).toEqual(["room-plan", "room-plan-2", "room-plan-3"])
        expect(yield* text(file(directory, "room-plan"))).toContain("первое")
        expect(yield* text(file(directory, "room-plan-2"))).toContain("второе")
        expect(yield* text(file(directory, "room-plan-3"))).toContain("третье")
        expect((yield* notes.list()).map((note) => note.name).toSorted()).toEqual([
          "room-plan",
          "room-plan-2",
          "room-plan-3",
        ])
      }).pipe(provide(directory)),
    ),
  )

  it.live("refuses a name that is not a slug and writes no file at all", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const notes = yield* NoteStore.Service

        for (const name of ["../escaped", "План", "a b"]) {
          const error = yield* Effect.flip(notes.create({ title: "План", name }))
          expect(error._tag).toBe("NoteStore.InvalidNameError")
          expect(error.message).toContain("lowercase latin")
        }

        const missing = yield* Effect.flip(notes.get("absent-note"))
        expect(missing._tag).toBe("NoteStore.NotFoundError")
        expect(yield* Effect.promise(() => fs.readdir(directory))).toEqual([])
      }).pipe(provide(directory)),
    ),
  )
})