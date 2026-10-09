import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

const location = { directory, project: { id: "project", directory, canonical: directory } }
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
const developer = {
  id: "developer",
  agent: "team-developer",
  name: "Developer",
  description: "Implements changes",
  rules: "Role: developer.",
  category: "Build",
  readOnly: false,
  origin: "builtin",
}
const feature = {
  id: "feature",
  name: "Feature",
  description: "Design, build, test and review a new feature",
  origin: "builtin",
  members: [{ agent: "team-developer", title: "Developer", category: "Build" }],
}

type Call = { method: string; path: string; body?: unknown }

function render(state: string, calls: Call[], language?: "ru") {
  const roles: Record<string, unknown>[] = [developer]
  const teams: Record<string, unknown>[] = [feature]
  return createAppFixture({
    width: 140,
    height: 44,
    state,
    args: { sessionID: session.id },
    config: { animations: false, language, session: { sidebar: "hide" }, debug: { devtools: true } },
    fetch: async (url, request) => {
      const body = request.method === "GET" ? undefined : await request.json().catch(() => undefined)
      if (url.pathname.startsWith("/api/orchestra")) calls.push({ method: request.method, path: url.pathname, body })
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/orchestra/project") return json([])
      if (url.pathname === "/api/orchestra/role" && request.method === "POST") {
        const role = { ...(body as object), id: "auditor", agent: "team-auditor", origin: "custom" }
        roles.push(role)
        return json(role)
      }
      if (url.pathname === "/api/orchestra/role") return json(roles)
      if (url.pathname === "/api/orchestra/template" && request.method === "POST") {
        const team = { ...(body as object), id: "audit", origin: "custom" }
        teams.push(team)
        return json(team)
      }
      if (url.pathname === "/api/orchestra/template") return json(teams)
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

function cell(frame: string, needle: string) {
  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes(needle))
  if (y < 0) throw new Error(`no ${needle} on screen`)
  return { x: lines[y].indexOf(needle), y }
}

test("the team editor creates a role and a team made of it", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, calls)

  const bar = await setup.waitForFrame((frame) => frame.includes("Teams") && frame.includes("Experiments"))
  const item = cell(bar, "Teams")
  await setup.mockMouse.click(item.x + 1, item.y)
  await setup.waitForFrame((frame) => frame.includes("Team editor") && frame.includes("Feature"))

  // roles tab, new role: the list's first row, then tab into the form
  setup.mockInput.pressArrow("right")
  await setup.waitForFrame((frame) => frame.includes("+ New role") && frame.includes("Developer"))
  setup.mockInput.pressKey("n", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Rules"))
  setup.mockInput.typeText("Auditor")
  setup.mockInput.pressTab()
  setup.mockInput.typeText("Quality")
  setup.mockInput.pressTab()
  setup.mockInput.pressTab()
  setup.mockInput.pressTab()
  // the file access switch
  setup.mockInput.pressArrow("right")
  setup.mockInput.pressTab()
  setup.mockInput.typeText("Check licenses.")
  setup.mockInput.pressKey("s", { ctrl: true })
  await setup.waitFor(() => calls.some((call) => call.method === "POST" && call.path === "/api/orchestra/role"))
  expect(calls.find((call) => call.method === "POST")?.body).toEqual({
    name: "Auditor",
    category: "Quality",
    description: "",
    rules: "Check licenses.",
    readOnly: true,
  })
  await setup.waitForFrame((frame) => frame.includes("Auditor") && frame.includes("custom"))

  // teams tab, new team with the new role
  setup.mockInput.pressKey("n", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Rules"))
  setup.mockInput.pressTab()
  setup.mockInput.pressTab()
  setup.mockInput.pressTab()
  setup.mockInput.pressTab()
  setup.mockInput.pressTab()
  setup.mockInput.pressTab()
  setup.mockInput.pressTab()
  // back on the list
  setup.mockInput.pressArrow("left")
  await setup.waitForFrame((frame) => frame.includes("+ New team"))
  setup.mockInput.pressKey("n", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("+ Add member"))
  setup.mockInput.typeText("Audit")
  setup.mockInput.pressTab()
  setup.mockInput.pressTab()
  // "+ Add member", then the new row's role picker steps to the next role
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("1."))
  setup.mockInput.pressTab()
  setup.mockInput.pressArrow("right")
  await setup.waitForFrame((frame) => frame.includes("‹ Auditor"))
  setup.mockInput.pressKey("s", { ctrl: true })
  await setup.waitFor(() => calls.some((call) => call.method === "POST" && call.path === "/api/orchestra/template"))
  expect(calls.find((call) => call.path === "/api/orchestra/template" && call.method === "POST")?.body).toEqual({
    name: "Audit",
    description: "",
    members: [{ agent: "team-auditor", title: "", category: "" }],
  })
})

test("the team editor follows the language switch", async () => {
  await using state = await tmpdir()
  await using setup = await render(state.path, [], "ru")
  const bar = await setup.waitForFrame((frame) => frame.includes("Команды"))
  const item = cell(bar, "Команды")
  await setup.mockMouse.click(item.x + 1, item.y)
  const frame = await setup.waitForFrame((frame) => frame.includes("Редактор команд") && frame.includes("Feature"))
  expect(frame).toContain("+ Новая команда")
  expect(frame).toContain("Участники")
  expect(frame).not.toContain("Members")
})
