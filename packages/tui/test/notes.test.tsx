import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const project = { id: "prj_demo", name: "Demo", directory, created: 0 }
const other = { id: "prj_empty", name: "Empty", directory: "/tmp/empty-project", created: 0 }
const session = (id: string, title: string) => ({
  id,
  title,
  projectID: "project",
  location: { directory },
  agent: "build",
  model: { providerID: "provider", id: "model" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
})
const worker = session("ses_worker", "Worker task")
const now = Date.now()

type Note = {
  name: string
  frontmatter: {
    title: string
    status: "inbox" | "active" | "done" | "archived"
    tags: string[]
    length?: "brief" | "balanced" | "detailed"
    session?: string
    created: number
    updated: number
  }
  body: string
  mtime: number
}

const plan = (): Note => ({
  name: "release-plan",
  frontmatter: {
    title: "Release plan",
    status: "active",
    tags: ["release"],
    session: worker.id,
    created: now - 3_600_000,
    updated: now - 120_000,
  },
  body: "# Goals\n\nShip the notes canvas.",
  mtime: 100,
})
const ideas = (): Note => ({
  name: "ideas",
  frontmatter: {
    title: "Onboarding ideas",
    status: "inbox",
    tags: ["ux"],
    created: now,
    updated: now - 86_400_000 * 2,
  },
  body: "",
  mtime: 50,
})

type Call = { method: string; path: string; body?: unknown }

function render(state: string, input: { notes: Note[]; calls: Call[]; conflict?: () => boolean }) {
  return createAppFixture({
    width: 150,
    height: 40,
    state,
    args: { sessionID: worker.id },
    config: { animations: false, session: { sidebar: "hide" }, debug: { devtools: true } },
    fetch: async (url, request) => {
      if (url.pathname.startsWith("/api/note")) {
        const body = request.method === "GET" ? undefined : await request.json().catch(() => undefined)
        input.calls.push({ method: request.method, path: url.pathname, body })
        if (url.pathname === "/api/note" && request.method === "GET")
          return json({ location, data: url.search.includes("empty-project") ? [] : input.notes })
        const name = url.pathname.split("/")[3]
        const note = input.notes.find((item) => item.name === name)
        if (!note) return json({ _tag: "NoteNotFoundError", name, message: "missing" }, { status: 404 })
        if (input.conflict?.())
          return json({ _tag: "NoteConflictError", name, expected: 1, actual: 2, message: "changed" }, { status: 409 })
        if (url.pathname.endsWith("/edit") && body && typeof body === "object" && "body" in body) {
          note.body = String(body.body)
          note.mtime += 1
        }
        if (request.method === "PATCH" && body && typeof body === "object" && "length" in body) {
          note.frontmatter.length = body.length as Note["frontmatter"]["length"]
          note.mtime += 1
        }
        return json({ location, data: note })
      }
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/orchestra/project") return json([project, other])
      if (url.pathname === `/api/orchestra/project/${project.id}/session`)
        return json({ data: [worker], access: { [worker.id]: "write" } })
      if (url.pathname === `/api/orchestra/project/${other.id}/session`) return json({ data: [], access: {} })
      if (url.pathname === "/api/session") return json({ data: [worker], cursor: {} })
      if (url.pathname === `/api/session/${worker.id}`) return json({ data: worker })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
    },
  })
}

function cell(frame: string, needle: string) {
  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes(needle))
  if (y < 0) throw new Error(`no ${needle} on screen:\n${frame}`)
  return { x: lines[y].indexOf(needle), y }
}

async function click(setup: Awaited<ReturnType<typeof render>>, needle: string, offset = 0) {
  const target = cell(setup.captureCharFrame(), needle)
  await setup.mockMouse.click(target.x + offset, target.y)
}

test("the Notes tab lists the project's notes, filters them and shows an empty project", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, { notes: [plan(), ideas()], calls })

  // A chat bound to a note offers the way to it even in the Projects tab.
  await setup.waitForFrame((frame) => frame.includes("Projects │ Notes") && frame.includes("Note: Release plan"))

  await click(setup, "Notes", 1)
  const frame = await setup.waitForFrame(
    (frame) => frame.includes("Onboarding ideas") && frame.includes("2 notes") && frame.includes("Ship the notes"),
  )
  expect(frame).toContain("● Release plan")
  expect(frame).toContain("○ Onboarding ideas")
  expect(frame).toContain("2m")
  expect(frame).toContain("2d")
  // Notes mode of a bound chat shows the note as its document.
  expect(frame).toContain("AI writes")
  expect(frame).toContain("Ship the notes canvas.")

  await click(setup, "Filter by title", 1)
  await setup.mockInput.typeText("#ux")
  await setup.waitForFrame((frame) => !frame.includes("● Release plan") && frame.includes("○ Onboarding ideas"))
  await setup.mockInput.typeText("zz")
  await setup.waitForFrame((frame) => frame.includes('No notes match "#uxzz".'))

  // The project switcher shows the other project and its empty state.
  await click(setup, "▸ Demo", 2)
  await setup.waitForFrame((frame) => frame.includes("    Empty"))
  await click(setup, "    Empty", 4)
  const empty = await setup.waitForFrame((frame) => frame.includes("No notes yet."))
  expect(empty).toContain("+ New note")
  expect(empty).toContain("ask the AI")
})

test("the length control and the editor write through the note API once", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, { notes: [plan(), ideas()], calls })
  await setup.waitForFrame((frame) => frame.includes("Note: Release plan"))
  await click(setup, "Note: Release plan", 2)
  await setup.waitForFrame((frame) => frame.includes("Detailed & useful") && frame.includes("● Balanced"))

  await click(setup, "Detailed & useful", 2)
  await setup.waitFor(() => calls.some((call) => call.method === "PATCH"))
  expect(calls.find((call) => call.method === "PATCH")).toEqual({
    method: "PATCH",
    path: "/api/note/release-plan",
    body: { length: "detailed", expectedMtime: 100 },
  })
  await setup.waitForFrame((frame) => frame.includes("● Detailed & useful"))

  await click(setup, "✎ Edit", 1)
  await setup.waitForFrame((frame) => frame.includes("ctrl+s save"))
  await Bun.sleep(50)
  await setup.mockInput.typeText("Draft ")
  setup.mockInput.pressKey("s", { ctrl: true })
  await setup.waitFor(() => calls.some((call) => call.path.endsWith("/edit")))
  await setup.waitForFrame((frame) => frame.includes("Draft # Goals") || frame.includes("Draft"))
  await Bun.sleep(100)
  const edits = calls.filter((call) => call.path.endsWith("/edit"))
  expect(edits).toHaveLength(1)
  expect(edits[0].body).toEqual({ body: "Draft # Goals\n\nShip the notes canvas.", expectedMtime: 101 })
  await setup.waitForFrame((frame) => !frame.includes("ctrl+s save"))
})

test("a save that lost a race keeps the text and offers the latest version", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  const notes = [plan()]
  let conflict = false
  await using setup = await render(state.path, { notes, calls, conflict: () => conflict })
  await setup.waitForFrame((frame) => frame.includes("Note: Release plan"))
  await click(setup, "Note: Release plan", 2)
  await setup.waitForFrame((frame) => frame.includes("✎ Edit"))
  await click(setup, "✎ Edit", 1)
  await setup.waitForFrame((frame) => frame.includes("ctrl+s save"))
  await Bun.sleep(50)
  await setup.mockInput.typeText("Mine ")

  conflict = true
  setup.mockInput.pressKey("s", { ctrl: true })
  const frame = await setup.waitForFrame((frame) => frame.includes("Not saved: this note changed"))
  expect(frame).toContain("Reload latest")
  expect(frame).toContain("Overwrite with mine")
  expect(frame).toContain("Mine # Goals")
})

test("a note written elsewhere updates live from note.updated", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  const notes = [plan()]
  await using setup = await render(state.path, { notes, calls })
  await setup.waitForFrame((frame) => frame.includes("Note: Release plan"))
  await click(setup, "Note: Release plan", 2)
  await setup.waitForFrame((frame) => frame.includes("Ship the notes canvas."))

  notes[0].body = "# Goals\n\nWritten by a guest through the AI."
  notes[0].mtime += 1
  setup.events.emit({
    id: "evt_note",
    created: Date.now(),
    type: "note.updated",
    location,
    data: { name: "release-plan" },
  })
  await setup.waitForFrame((frame) => frame.includes("Written by a guest through the AI."))

  // The chat toggle puts the note aside for the full chat, and the chip brings it back.
  await click(setup, "⇤ Chat", 1)
  await setup.waitForFrame((frame) => !frame.includes("AI writes") && frame.includes("Note: Release plan"))
})
