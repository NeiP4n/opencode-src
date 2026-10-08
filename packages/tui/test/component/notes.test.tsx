/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import type { Route } from "@opencode/plugin/tui/context"
import type { Context } from "@opencode/plugin/tui/context"
import { Session } from "@opencode/core/session"
import { Note } from "@opencode/schema/note"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { NotesPage } from "../../src/feature-plugins/system/notes"
import { NOTES_PATH, listNotes, saveNote, type NotesFiles } from "../../src/feature-plugins/system/notes-data"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const OLD = 1_700_000_000_000
const NEW = 1_700_000_600_000

/** A canonical note file: the screen must not be the place that decides what a note looks like. */
function note(title: string, updated: number, body: string) {
  return Note.serialize({
    frontmatter: { title, status: "active", tags: [], session: undefined, created: OLD, updated },
    body,
  })
}

/** The notes port over a real folder, so the mtime guard is exercised against real files. */
function folder(directory: string): NotesFiles {
  return {
    list: () => readdir(directory),
    read: async (file) => ({ text: await readFile(path.join(directory, file), "utf8"), mtimeMs: 0 }),
    write: async (file, text) => void (await writeFile(path.join(directory, file), text)),
  }
}

test("listing is sorted by updated and survives a foreign or a broken note", async () => {
  await using tmp = await tmpdir()
  const directory = path.join(tmp.path, "notes")
  await mkdir(directory)
  await writeFile(path.join(directory, "alpha.md"), note("Alpha", OLD, "first"))
  await writeFile(path.join(directory, "beta.md"), note("Beta", NEW, "second"))
  await writeFile(path.join(directory, "notes.txt"), "not markdown")
  await writeFile(path.join(directory, "gamma.md"), "no frontmatter at all")

  const listing = await listNotes(folder(directory))

  // Newest first, and neither the text file nor the broken one takes the rest down.
  expect(listing.rows.map((row) => row.title)).toEqual(["Beta", "Alpha", "gamma"])
  expect(listing.rows.map((row) => row.parsed)).toEqual([true, true, false])
  expect(listing.unreadable).toEqual([])
})

test("a listed file that cannot be read is reported instead of failing the listing", async () => {
  await using _tmp = await tmpdir()
  const listing = await listNotes({
    list: async () => ["alpha.md", "vanished.md"],
    read: async (file) => {
      if (file === "vanished.md") throw new Error("ENOENT")
      return { text: note("Alpha", OLD, "first"), mtimeMs: 0 }
    },
    write: async () => {},
  })

  expect(listing.rows.map((row) => row.title)).toEqual(["Alpha"])
  expect(listing.unreadable).toEqual(["vanished.md"])
})

test("saving is refused when the file changed since it was read", async () => {
  await using tmp = await tmpdir()
  const directory = path.join(tmp.path, "notes")
  await mkdir(directory)
  const file = path.join(directory, "alpha.md")
  await writeFile(file, note("Alpha", OLD, "first"))

  const files = folder(directory)
  const snapshot = (await listNotes(files)).rows[0]
  // Somebody else writes the note between the read and the save.
  await writeFile(file, note("Alpha", OLD, "rewritten by someone else"))

  expect(await saveNote(files, snapshot, "my edit")).toEqual({ ok: false, reason: "changed" })
  expect(await readFile(file, "utf8")).toContain("rewritten by someone else")
})

test("saving writes the new body and keeps the frontmatter the core wrote", async () => {
  await using tmp = await tmpdir()
  const directory = path.join(tmp.path, "notes")
  await mkdir(directory)
  await writeFile(path.join(directory, "alpha.md"), note("Alpha", OLD, "first"))

  const files = folder(directory)
  expect(await saveNote(files, (await listNotes(files)).rows[0], "my edit")).toEqual({ ok: true })

  const written = Note.parse(await readFile(path.join(directory, "alpha.md"), "utf8"))
  expect(written.body).toBe("my edit")
  // The screen never invents core-owned timestamps.
  expect(written.frontmatter.created).toBe(OLD)
  expect(written.frontmatter.updated).toBe(OLD)
})

/**
 * The plugin context the screen reads: files over a real folder and a router that records where it
 * was sent. The keymap is the host one, so binds and `enabled` are exercised as in the app.
 */
function screen(directory: string, route: Route) {
  const navigations: Route[] = []
  return {
    navigations,
    context: {
      client: {
        file: {
          list: async () => ({
            location: { directory },
            data: (await readdir(path.join(directory, NOTES_PATH))).map((name) => ({
              path: `${NOTES_PATH}/${name}`,
              type: "file" as const,
            })),
          }),
          read: async (input: { path: string }) =>
            new TextEncoder().encode(await readFile(path.join(directory, input.path), "utf8")),
          write: async (input: { path: string; payload: Uint8Array }) =>
            void (await writeFile(path.join(directory, input.path), input.payload)),
        },
      },
      data: { location: { default: () => ({ directory }) }, session: { get: () => undefined } },
      keymap: { layer: Keymap.createLayer },
      ui: {
        router: {
          current: () => route,
          navigate: (destination: Route) => void navigations.push(destination),
          register: () => {
            throw new Error("Route already registered: notes")
          },
        },
        dialog: { clear: () => {} },
      },
    } as unknown as Context,
  }
}

async function render(context: Context) {
  const app = await testRender(
    () => (
      <TestTuiContexts directory="/workspace">
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Keymap.Provider>
              <NotesPage context={context} markdown={() => undefined} />
            </Keymap.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 90, height: 30, kittyKeyboard: true },
  )
  app.renderer.start()
  return app
}

test("the screen lists the folder newest first and opens the selected note", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, NOTES_PATH), { recursive: true })
  await writeFile(path.join(tmp.path, NOTES_PATH, "alpha.md"), note("Alpha", OLD, "first body"))
  await writeFile(path.join(tmp.path, NOTES_PATH, "beta.md"), note("Beta", NEW, "second body"))
  await writeFile(path.join(tmp.path, NOTES_PATH, "notes.txt"), "not a note")

  const app = await render(screen(tmp.path, { type: "home" }).context)
  try {
    await app.waitForFrame((frame) => frame.includes("Beta"))
    const frame = app.captureCharFrame()
    expect(frame).toContain("UPDATED")
    expect(frame).toContain("STATUS")
    expect(frame).toContain("TAGS")
    expect(frame.indexOf("Beta")).toBeLessThan(frame.indexOf("Alpha"))
    expect(frame).toContain("2 notes")
    // Only markdown files are note rows.
    expect(frame).not.toContain("notes.txt")

    app.mockInput.pressKey("RETURN")
    await app.waitForFrame((text) => text.includes("second body"))
    expect(app.captureCharFrame()).not.toContain("first body")
  } finally {
    app.renderer.destroy()
  }
})

test("notes.back returns to the route the screen was opened from", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, NOTES_PATH), { recursive: true })
  await writeFile(path.join(tmp.path, NOTES_PATH, "alpha.md"), note("Alpha", OLD, "first body"))

  const opened: Route = {
    type: "plugin",
    id: "opencode.notes",
    name: "notes",
    data: { returnRoute: { type: "session", sessionID: Session.ID.make("ses_1") } },
  }
  const environment = screen(tmp.path, opened)
  const app = await render(environment.context)
  try {
    await app.waitForFrame((frame) => frame.includes("Alpha"))
    // The chat button is offered exactly because the screen was opened from a chat.
    await app.waitForFrame((frame) => frame.includes("chat"))

    app.mockInput.pressKey("ESCAPE")
    await app.waitFor(() => environment.navigations.length > 0)
    expect(environment.navigations.at(-1)).toEqual({ type: "session", sessionID: "ses_1" })
  } finally {
    app.renderer.destroy()
  }
})

test("a broken note and an unreadable one do not break the listing on screen", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, NOTES_PATH), { recursive: true })
  await writeFile(path.join(tmp.path, NOTES_PATH, "alpha.md"), note("Alpha", OLD, "first body"))
  await writeFile(path.join(tmp.path, NOTES_PATH, "gamma.md"), "no frontmatter at all")
  // Listed by the folder, unreadable on read: exactly what a half-synced checkout looks like.
  await symlink(path.join(tmp.path, NOTES_PATH, "gone.md"), path.join(tmp.path, NOTES_PATH, "lost.md"))

  const app = await render(screen(tmp.path, { type: "home" }).context)
  try {
    await app.waitForFrame((frame) => frame.includes("Alpha"))
    await app.waitForFrame((frame) => frame.includes("unreadable"))
    expect(app.captureCharFrame()).toContain("Alpha")
    expect(app.captureCharFrame()).toContain("gamma")
    expect(app.captureCharFrame()).toContain("1 unreadable")
  } finally {
    app.renderer.destroy()
  }
})

test("editing refuses to overwrite a note that changed on disk", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, NOTES_PATH), { recursive: true })
  const file = path.join(tmp.path, NOTES_PATH, "alpha.md")
  await writeFile(file, note("Alpha", OLD, "first body"))

  const app = await render(screen(tmp.path, { type: "home" }).context)
  try {
    await app.waitForFrame((frame) => frame.includes("Alpha"))
    app.mockInput.pressKey("RETURN")
    await app.waitForFrame((frame) => frame.includes("first body"))
    app.mockInput.pressKey("e")
    await app.waitForFrame((frame) => !frame.includes("first body"))

    // The agent writes the note while the editor is open.
    await writeFile(file, note("Alpha", OLD, "agent body"))
    app.mockInput.pressKey("s", { ctrl: true })

    await app.waitForFrame((frame) => frame.includes("changed on disk"))
    expect(app.captureCharFrame()).toContain("alpha.md changed on disk")
    expect(await readFile(file, "utf8")).toContain("agent body")
  } finally {
    app.renderer.destroy()
  }
})
