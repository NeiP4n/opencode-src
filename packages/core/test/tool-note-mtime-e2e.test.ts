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
import { executeTool, registerToolPlugin, toolIdentity, type ToolExecution } from "./lib/tool"

const sessionID = Session.ID.make("ses_note_mtime_probe")

const unboundSession = {
  id: sessionID,
  projectID: "prj_note_mtime_probe",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
  location: { directory: AbsolutePath.make(process.cwd()) },
  metadata: undefined,
} as unknown as Session.Info

const chatNode = makeLocationNode({
  name: "test/note-mtime-probe",
  layer: Layer.effectDiscard(
    registerToolPlugin(NoteTool.Plugin, { session: { get: () => Effect.succeed(unboundSession) } }),
  ),
  deps: [Tool.node, NoteStore.node, Permission.node],
})

const harness = (directory: string) =>
  AppNodeBuilder.build(LayerNode.group([Tool.node, chatNode, NoteStore.node]), [
    Location.node.replace(
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
    ),
    Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
  ])

const call = (id: string, input: Record<string, unknown>) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: NoteTool.name, input },
})

const run = (tools: Tool.Interface, id: string, input: Record<string, unknown>) => executeTool(tools, call(id, input))

/** The whole model-visible text: `content` is the only part of a tool result a model reads. */
const modelText = (result: ToolExecution) =>
  (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")

const structured = (result: ToolExecution) => result.output as { output: string; name?: string; updated?: number }

/** The structured stamp, NaN when the tool did not report one, so a missing value fails instead of passing. */
const structuredUpdated = (result: ToolExecution) => structured(result).updated ?? Number.NaN

/**
 * Every 13-digit number anywhere in the model text. Epoch-millisecond timestamps have
 * 13 digits until 2286, so this is exactly "a number the model could mistake for the
 * mtime". Deliberately not keyed on a word like `updated`, so a renamed or removed
 * label does not hide a number that is still wrong.
 */
const timestampLike = (text: string) => text.match(/\d{13}/g) ?? []

/** The one timestamp the model may copy, whatever label it carries. */
const onlyStamp = (result: ToolExecution) => {
  const found = timestampLike(modelText(result))
  expect(found.length).toBe(1)
  return Number(found[0])
}

const onDisk = (directory: string, name: string) => path.join(directory, ".opencode", "notes", `${name}.md`)
const readFile = (target: string) => Effect.promise(() => fs.readFile(target, "utf8"))
const mtimeMs = (target: string) => Effect.promise(() => fs.stat(target)).pipe(Effect.map((info) => info.mtimeMs))

/** Sub-millisecond timestamp: 0.5 below a whole millisecond, as a real write lands. */
const setMtime = (target: string, millis: number) =>
  Effect.promise(() => fs.utimes(target, millis / 1000, millis / 1000))

/** The frontmatter timestamp the note file carries, read straight out of the file. */
const frontmatterUpdated = (target: string) =>
  readFile(target).pipe(
    Effect.map((content) => {
      const block = /^---\n([\s\S]*?)\n---/.exec(content)?.[1] ?? ""
      const match = /^updated: (\d+)$/m.exec(block)
      if (match === null) throw new Error(`no frontmatter updated in ${target}`)
      return Number(match[1])
    }),
  )

describe("note tool mtime end to end", () => {
  it.live("prints the real file mtime on every read, so the stamp a model copies always writes", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        const note = onDisk(directory, "plan")
        yield* run(tools, "create-plan", { action: "create", name: "plan", title: "План", body: "строка" })

        for (let round = 0; round < 8; round++) {
          const readResult = yield* run(tools, `read-${round}`, { action: "read", name: "plan" })
          const stamp = onlyStamp(readResult)
          const real = yield* mtimeMs(note)
          const written = yield* frontmatterUpdated(note)

          expect(stamp).toBe(Math.floor(real))
          expect(stamp).toBe(structuredUpdated(readResult))
          // The frontmatter timestamp is the value that used to be printed. Whenever it
          // differs from the real mtime, it must appear nowhere in the model text.
          if (written !== Math.floor(real)) expect(timestampLike(modelText(readResult))).not.toContain(String(written))

          const edited = yield* run(tools, `edit-${round}`, {
            action: "edit",
            name: "plan",
            body: `правка ${round}`,
            mode: "append",
            expectedMtime: stamp,
          })
          expect(edited).toMatchObject({ status: "completed" })
        }

        expect(yield* readFile(note)).toContain("строка\nправка 0\nправка 1")
      }).pipe(Effect.provide(harness(directory))),
    ),
  )

  it.live("writes with the printed stamp when the frontmatter timestamp is a millisecond off the real mtime", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        const note = onDisk(directory, "plan")
        yield* run(tools, "create-plan", { action: "create", name: "plan", title: "План", body: "строка" })

        // The state the human's own note was in: the file timestamp sits half a
        // millisecond below the frontmatter, so the whole millisecond differs.
        const frontmatter = yield* frontmatterUpdated(note)
        yield* setMtime(note, frontmatter - 0.5)
        const real = yield* mtimeMs(note)
        expect(Math.floor(real)).toBe(frontmatter - 1)

        const readResult = yield* run(tools, "read-forced", { action: "read", name: "plan" })
        const stamp = onlyStamp(readResult)
        expect(stamp).toBe(Math.floor(real))
        expect(stamp).toBe(frontmatter - 1)
        expect(stamp).not.toBe(frontmatter)

        const edited = yield* run(tools, "edit-forced", {
          action: "edit",
          name: "plan",
          body: "правка агента",
          expectedMtime: stamp,
        })
        expect(edited).toMatchObject({ status: "completed" })

        const restamped = onlyStamp(edited)
        expect(restamped).toBe(Math.floor(yield* mtimeMs(note)))

        const updated = yield* run(tools, "update-forced", {
          action: "update",
          name: "plan",
          status: "active",
          expectedMtime: restamped,
        })
        expect(updated).toMatchObject({ status: "completed" })
        expect(yield* readFile(note)).toContain("status: active")
      }).pipe(Effect.provide(harness(directory))),
    ),
  )

  it.live("shows only a note's own mtime, on every action the model can take", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        const plan = onDisk(directory, "plan")
        const second = onDisk(directory, "second")

        const created = yield* run(tools, "create-plan", {
          action: "create",
          name: "plan",
          title: "План",
          body: "строка",
        })
        expect(onlyStamp(created)).toBe(Math.floor(yield* mtimeMs(plan)))
        expect(structuredUpdated(created)).toBe(Math.floor(yield* mtimeMs(plan)))

        const readBack = yield* run(tools, "read-plan", { action: "read", name: "plan" })
        expect(onlyStamp(readBack)).toBe(Math.floor(yield* mtimeMs(plan)))

        const updated = yield* run(tools, "update-plan", {
          action: "update",
          name: "plan",
          status: "active",
          expectedMtime: onlyStamp(readBack),
        })
        expect(onlyStamp(updated)).toBe(Math.floor(yield* mtimeMs(plan)))

        // The frontmatter timestamp is the number that must never reach the model:
        // it is a `Date.now()` taken before the write, not the file mtime.
        const frontmatter = yield* frontmatterUpdated(plan)
        expect(modelText(updated)).not.toContain(`written ${frontmatter}`)
        expect(timestampLike(modelText(updated))).toEqual([String(Math.floor(yield* mtimeMs(plan)))])

        // A second note makes the listing real: every number it prints must be that
        // note's own mtime floor, so a stamp copied from a listing still writes.
        const createdSecond = yield* run(tools, "create-second", { action: "create", name: "second", title: "Второй" })
        expect(onlyStamp(createdSecond)).toBe(Math.floor(yield* mtimeMs(second)))

        const listed = yield* run(tools, "list-all", { action: "list" })
        const listedText = modelText(listed)
        const rows = listedText.split("\n")
        const floors = new Set<string>()
        for (const name of ["plan", "second"] as const) {
          const target = name === "plan" ? plan : second
          const line = rows.find((candidate) => candidate.startsWith(`- ${name} `))
          expect(line).toBeDefined()
          const floor = Math.floor(yield* mtimeMs(target))
          const stampInFile = yield* frontmatterUpdated(target)
          expect(timestampLike(line ?? "")).toEqual([String(floor)])
          // The frontmatter timestamp is a `Date.now()`, never the mtime: when the two
          // differ, the listing must not be showing the one the guard would refuse.
          if (stampInFile !== floor) expect(line).not.toContain(String(stampInFile))
          floors.add(String(floor))
        }
        expect(new Set(timestampLike(listedText))).toEqual(floors)
        expect(listedText).toContain("- plan [active] План")
        expect(listedText).toContain("- second [inbox] Второй")
      }).pipe(Effect.provide(harness(directory))),
    ),
  )

  it.live("refuses a stamp one millisecond off, so the guard is really reading the mtime", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        const note = onDisk(directory, "plan")
        yield* run(tools, "create-plan", { action: "create", name: "plan", title: "План", body: "строка" })

        const stamp = onlyStamp(yield* run(tools, "read-plan", { action: "read", name: "plan" }))

        const refused = yield* run(tools, "edit-off-by-one", {
          action: "edit",
          name: "plan",
          body: "правка агента",
          expectedMtime: stamp - 1,
        })
        expect(refused).toMatchObject({ status: "error" })
        expect(JSON.stringify(refused)).toContain("read it again before writing")
        expect(yield* readFile(note)).toContain("строка")
        expect(yield* readFile(note)).not.toContain("правка агента")

        const accepted = yield* run(tools, "edit-exact", {
          action: "edit",
          name: "plan",
          body: "правка агента",
          expectedMtime: stamp,
        })
        expect(accepted).toMatchObject({ status: "completed" })
      }).pipe(Effect.provide(harness(directory))),
    ),
  )
})
