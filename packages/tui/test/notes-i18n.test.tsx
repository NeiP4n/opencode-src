import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

/**
 * The Notes panel is the left panel's Notes tab. These sentences are its own English
 * wording, not shared chrome, so under `language: "ru"` none of them may survive.
 * Wording is deliberately not hardcoded on the Russian side: the developer picks the
 * Russian, this test only insists that the panel goes through `translate()` at all.
 */
const PANEL_SENTENCES = [
  "No notes yet.",
  "+ New note",
  "or ask the AI in any chat of this project to write one.",
  "This chat writes into the selected note only.",
  "Filter by title or #tag",
  "Note title, enter to create",
  "Could not read notes:",
  "No project",
]

const location = { directory, project: { id: "project", directory, canonical: directory } }
const project = { id: "prj_demo", name: "Demo", directory, created: 0 }
const session = {
  id: "ses_worker",
  title: "Worker task",
  projectID: "project",
  location: { directory },
  agent: "build",
  model: { providerID: "provider", id: "model" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}

type Note = {
  name: string
  frontmatter: {
    title: string
    status: "inbox" | "active" | "done" | "archived"
    tags: string[]
    created: number
    updated: number
  }
  body: string
  mtime: number
}

const note = (): Note => ({
  name: "release-plan",
  frontmatter: {
    title: "Release plan",
    status: "active",
    tags: ["release"],
    created: Date.now() - 600_000,
    updated: Date.now() - 120_000,
  },
  body: "# Goals\n\nShip the notes canvas.",
  mtime: 100,
})

function render(state: string, notes: Note[], language: "en" | "ru") {
  return createAppFixture({
    width: 150,
    height: 40,
    state,
    args: { sessionID: session.id },
    config: { animations: false, session: { sidebar: "hide" }, debug: { devtools: true }, language },
    fetch: async (url, request) => {
      if (url.pathname.startsWith("/api/note"))
        return url.pathname === "/api/note" && request.method === "GET"
          ? json({ location, data: notes })
          : json({ location, data: notes[0] })
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/orchestra/project") return json([project])
      if (url.pathname === `/api/orchestra/project/${project.id}/session`)
        return json({ data: [session], access: { [session.id]: "write" } })
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
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

/** A cell found by any of several wordings, so the test survives the translation itself. */
function cell(frame: string, needles: readonly string[]) {
  const lines = frame.split("\n")
  for (const needle of needles) {
    const y = lines.findIndex((line) => line.includes(needle))
    if (y >= 0) return { x: lines[y].indexOf(needle), y }
  }
  throw new Error(`no ${needles.join(" | ")} on screen:\n${frame}`)
}

async function openNotesTab(setup: Awaited<ReturnType<typeof render>>) {
  const target = cell(setup.captureCharFrame(), ["Заметки", "Notes"])
  await setup.mockMouse.click(target.x + 1, target.y)
}

test("the Notes panel is in Russian when the language is ru", async () => {
  await using state = await tmpdir()
  await using setup = await render(state.path, [note()], "ru")

  await setup.waitForFrame((frame) => frame.includes("Заметки"))
  await openNotesTab(setup)
  const frame = await setup.waitForFrame((frame) => frame.includes("Release plan"))

  // Nothing English of the panel may survive: these are its own sentences.
  for (const sentence of PANEL_SENTENCES) expect(frame).not.toContain(sentence)
  // And the panel must say something: deleting the text is not a translation either.
  expect(frame).toMatch(/[А-Яа-яЁё]/)
})

test("the empty Notes state is in Russian when the language is ru", async () => {
  await using state = await tmpdir()
  await using setup = await render(state.path, [], "ru")

  await setup.waitForFrame((frame) => frame.includes("Заметки"))
  await openNotesTab(setup)
  // The empty panel's count line is "0 notes" or its Russian twin; the digit is the
  // one part of that row that no translation changes.
  const frame = await setup.waitForFrame((frame) => /Demo\s+0\b/.test(frame))
  expect(frame).not.toContain("Release plan")

  for (const sentence of PANEL_SENTENCES) expect(frame).not.toContain(sentence)
  expect(frame).toMatch(/[А-Яа-яЁё]/)
})
