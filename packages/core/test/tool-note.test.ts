import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Location } from "@opencode/core/location"
import { NoteStore } from "@opencode/core/note"
import { NoteTool } from "@opencode/core/tool/plugin/note"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const sessionID = Session.ID.make("ses_note_tool_test")

const noteToolNode = makeLocationNode({
  name: "test/note-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(NoteTool.Plugin)),
  deps: [Tool.node, NoteStore.node, Permission.node],
})

/** Records what the tool asked permission for, and fails the test if it never asked. */
const askingPermission = (seen: string[]) =>
  permissionLayer({
    assert: (input) => {
      seen.push(`${input.action}:${input.resources.join(",")}`)
      return Effect.void
    },
  })

function harness(directory: string, seen: string[] = []) {
  return AppNodeBuilder.build(LayerNode.group([Tool.node, noteToolNode, NoteStore.node]), [
    Location.node.replace(
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
    ),
    Permission.node.replace(askingPermission(seen)),
  ])
}

const call = (id: string, input: Record<string, unknown>) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: NoteTool.name, input },
})

const run = (tools: Tool.Interface, id: string, input: Record<string, unknown>) =>
  executeTool(tools, call(id, input)).pipe(Effect.map((result) => result))

const onDisk = (directory: string, name: string) => path.join(directory, ".opencode", "notes", `${name}.md`)
const read = (target: string) => Effect.promise(() => fs.readFile(target, "utf8"))
/** Moves mtime a whole second, so a guard sees the difference even on a coarse clock. */
const retime = (target: string, mtime: number) =>
  Effect.promise(() => fs.utimes(target, new Date(mtime), new Date(mtime)))

describe("NoteTool", () => {
  it.live("reports an empty notes folder without asking for write permission", () =>
    withTempDir(({ path: directory }) => {
      const asked: string[] = []
      return Effect.gen(function* () {
        const tools = yield* Tool.Service

        const result = yield* run(tools, "call-list-empty", { action: "list" })

        expect(result).toMatchObject({ status: "completed" })
        expect(JSON.stringify(result.output)).toContain("No notes yet in .opencode/notes.")
        expect(asked).toEqual([])
      }).pipe(Effect.provide(harness(directory, asked)))
    }),
  )

  it.live("creates a note on disk after asking permission for the notes folder", () =>
    withTempDir(({ path: directory }) => {
      const asked: string[] = []
      return Effect.gen(function* () {
        const tools = yield* Tool.Service

        const result = yield* run(tools, "call-create", {
          action: "create",
          name: "room-plan",
          title: "План по комнатам",
          body: "Первый шаг.",
          tags: ["net"],
        })

        expect(result).toMatchObject({ status: "completed" })
        expect(asked).toEqual(["note:.opencode/notes"])
        expect(yield* read(onDisk(directory, "room-plan"))).toContain("Первый шаг.")
        expect(JSON.stringify(result.output)).toContain("План по комнатам")
      }).pipe(Effect.provide(harness(directory, asked)))
    }),
  )

  it.live("reads a note back with its body and the update time an edit needs", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        yield* run(tools, "call-create", { action: "create", name: "plan", title: "План", body: "тело" })

        const result = yield* run(tools, "call-read", { action: "read", name: "plan" })

        expect(result).toMatchObject({ status: "completed" })
        const output = result.output as { output: string; name?: string; updated?: number }
        expect(output.name).toBe("plan")
        expect(output.updated).toBeGreaterThan(0)
        expect(output.output).toContain("тело")
      }).pipe(Effect.provide(harness(directory))),
    ),
  )

  it.live("refuses an edit without expectedMtime and leaves the note as it was", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        yield* run(tools, "call-create", { action: "create", name: "plan", title: "План", body: "черновик" })

        const result = yield* run(tools, "call-edit-no-mtime", {
          action: "edit",
          name: "plan",
          body: "правка агента",
        })

        expect(result).toMatchObject({ status: "error" })
        expect(JSON.stringify(result)).toContain("expectedMtime")
        expect(yield* read(onDisk(directory, "plan"))).toContain("черновик")
      }).pipe(Effect.provide(harness(directory))),
    ),
  )

  it.live("refuses an edit of a note the user changed and leaves the human text alone", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        const created = yield* run(tools, "call-create", {
          action: "create",
          name: "plan",
          title: "План",
          body: "черновик",
        })
        const stamp = (created.output as { updated: number }).updated
        const human = "правка человека\n"
        yield* read(onDisk(directory, "plan")).pipe(() => writeFile(onDisk(directory, "plan"), human))
        yield* retime(onDisk(directory, "plan"), Date.now() + 5000)

        const result = yield* run(tools, "call-edit-stale", {
          action: "edit",
          name: "plan",
          body: "правка агента",
          expectedMtime: stamp,
        })

        expect(result).toMatchObject({ status: "error" })
        expect(JSON.stringify(result)).toContain("read it again before writing")
        expect(yield* read(onDisk(directory, "plan"))).toBe(human)
      }).pipe(Effect.provide(harness(directory))),
    ),
  )

  it.live("appends a body and raises the status of the same note", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        const created = yield* run(tools, "call-create", {
          action: "create",
          name: "plan",
          title: "План",
          body: "строка",
        })
        const stamp = (created.output as { updated: number }).updated

        const appended = yield* run(tools, "call-append", {
          action: "edit",
          name: "plan",
          body: "вторая",
          mode: "append",
          expectedMtime: stamp,
        })
        const active = yield* run(tools, "call-update", {
          action: "update",
          name: "plan",
          status: "active",
          expectedMtime: (appended.output as { updated: number }).updated,
        })

        const text = yield* read(onDisk(directory, "plan"))
        expect(text).toContain("строка\nвторая")
        expect(text).toContain("status: active")
        expect(JSON.stringify(active.output)).toContain("active")
      }).pipe(Effect.provide(harness(directory))),
    ),
  )

  it.live("binds a note to the calling chat", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        const created = yield* run(tools, "call-create", {
          action: "create",
          name: "plan",
          title: "План",
          body: "тело",
        })

        yield* run(tools, "call-link", {
          action: "link",
          name: "plan",
          expectedMtime: (created.output as { updated: number }).updated,
        })

        expect(yield* read(onDisk(directory, "plan"))).toContain(`session: ${sessionID}`)
      }).pipe(Effect.provide(harness(directory))),
    ),
  )

  it.live("derives a name from the title, sets the length and unbinds the note again", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        const created = yield* run(tools, "call-create", { action: "create", title: "План сети", length: "brief" })
        const linked = yield* run(tools, "call-link", {
          action: "link",
          name: "plan-seti",
          expectedMtime: (created.output as { updated: number }).updated,
        })
        const updated = yield* run(tools, "call-update", {
          action: "update",
          name: "plan-seti",
          length: "detailed",
          expectedMtime: (linked.output as { updated: number }).updated,
        })

        yield* run(tools, "call-unlink", {
          action: "unlink",
          name: "plan-seti",
          expectedMtime: (updated.output as { updated: number }).updated,
        })

        expect((created.output as { name: string }).name).toBe("plan-seti")
        expect(JSON.stringify(updated.output)).toContain("length detailed")
        const text = yield* read(onDisk(directory, "plan-seti"))
        expect(text).toContain("length: detailed")
        expect(text).not.toContain("session:")
      }).pipe(Effect.provide(harness(directory))),
    ),
  )

  it.live("lists an untitled note with an English placeholder", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        yield* run(tools, "call-create", { action: "create", name: "blank-note", title: "" })

        const listed = yield* run(tools, "call-list", { action: "list" })

        expect(JSON.stringify(listed.output)).toContain("blank-note [inbox] (untitled)")
      }).pipe(Effect.provide(harness(directory))),
    ),
  )

  it.live("refuses a name that is not a slug and writes nothing", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const tools = yield* Tool.Service

        const result = yield* run(tools, "call-bad-name", {
          action: "create",
          name: "../escaped",
          title: "Побег",
          body: "не должно записаться",
        })

        expect(result).toMatchObject({ status: "error" })
        expect(JSON.stringify(result)).toContain("lowercase latin")
        expect(yield* Effect.promise(() => fs.readdir(directory))).toEqual([])
      }).pipe(Effect.provide(harness(directory))),
    ),
  )
})

const writeFile = (target: string, content: string) => Effect.promise(() => fs.writeFile(target, content))
