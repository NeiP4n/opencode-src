import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const project = { id: "prj_demo", name: "Demo", directory, created: 0 }
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
const main = session("ses_main", "Demo · Orchestrator")

type Call = { method: string; path: string; body?: unknown }

const team = {
  id: "feature",
  name: "Feature",
  description: "Design, build, test and review a new feature",
  members: [
    { agent: "architect", title: "Architect" },
    { agent: "developer", title: "Developer" },
  ],
}

function render(state: string, calls: Call[], projects: (typeof project)[]) {
  return createAppFixture({
    width: 120,
    state,
    args: { sessionID: worker.id },
    config: { animations: false, session: { sidebar: "hide" }, debug: { devtools: true } },
    fetch: async (url, request) => {
      if (url.pathname.startsWith("/api/orchestra"))
        calls.push({
          method: request.method,
          path: url.pathname,
          body: request.method === "GET" ? undefined : await request.json().catch(() => undefined),
        })
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/orchestra/project" && request.method === "POST")
        return json({ ...project, id: "prj_new", name: "Created" })
      if (url.pathname === "/api/orchestra/project") return json(projects)
      if (url.pathname === "/api/orchestra/template") return json([team])
      if (url.pathname === `/api/orchestra/project/${project.id}/session`)
        return json({ data: [worker], access: { [worker.id]: "write" }, category: { [worker.id]: "Build" } })
      if (url.pathname === `/api/orchestra/project/${project.id}/main`) return json(main)
      if (url.pathname.startsWith("/api/orchestra/access/")) return new Response(null, { status: 204 })
      if (url.pathname.startsWith("/api/orchestra/category/")) return new Response(null, { status: 204 })
      if (url.pathname === "/api/session") return json({ data: [worker], cursor: {} })
      if (url.pathname === `/api/session/${worker.id}` && request.method === "DELETE") {
        calls.push({ method: "DELETE", path: url.pathname })
        return new Response(null, { status: 204 })
      }
      if (url.pathname === `/api/session/${worker.id}`) return json({ data: worker })
      if (url.pathname === `/api/session/${main.id}`) return json({ data: main })
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

test("the left panel lists the operator's projects with the orchestrator and sessions by category at their access level", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, calls, [project])

  // the open session's project starts expanded and shows the access the operator granted
  const frame = await setup.waitForFrame(
    (frame) => frame.includes("Projects") && frame.includes("Demo") && frame.includes("[write]"),
  )
  expect(frame).toContain("★ Orchestrator")
  // sessions sit under their category
  const lines = frame.split("\n")
  expect(lines.findIndex((line) => line.includes("Build"))).toBeLessThan(
    lines.findIndex((line) => line.includes("Worker task")),
  )

  // clicking the chip steps to the next level and stores it
  const chip = cell(frame, "[write]")
  await setup.mockMouse.click(chip.x + 1, chip.y)
  await setup.waitForFrame((frame) => frame.includes("[full]"))
  await setup.waitFor(() => calls.some((call) => call.method === "PUT"))
  expect(calls.find((call) => call.method === "PUT")).toEqual({
    method: "PUT",
    path: `/api/orchestra/access/${worker.id}`,
    body: { access: "full" },
  })

  // the orchestra row opens the project's main session
  const orchestra = cell(setup.captureCharFrame(), "★ Orchestrator")
  await setup.mockMouse.click(orchestra.x + 2, orchestra.y)
  await setup.waitFor(() => calls.some((call) => call.path === `/api/orchestra/project/${project.id}/main`))
})

test("deleting a session takes two clicks on its ×", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, calls, [project])
  const frame = await setup.waitForFrame((frame) => frame.includes("Worker task") && frame.includes("[write] ×"))
  const button = cell(frame, " ×")
  await setup.mockMouse.click(button.x + 1, button.y)
  await setup.waitForFrame((frame) => frame.includes("delete?"))
  expect(calls.some((call) => call.method === "DELETE")).toBe(false)
  const confirm = cell(setup.captureCharFrame(), "delete?")
  await setup.mockMouse.click(confirm.x, confirm.y)
  await setup.waitFor(() => calls.some((call) => call.method === "DELETE"))
  await setup.waitForFrame((frame) => !frame.includes("Worker task"))
})

test("a project is created from a name and a path", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, calls, [])

  // without projects the tree takes no room; the bottom bar offers to create the first one
  const frame = await setup.waitForFrame((frame) => frame.includes("+ Project"))
  expect(frame).not.toContain("Projects")
  const add = cell(frame, "+ Project")
  await setup.mockMouse.click(add.x, add.y)
  await setup.waitForFrame((frame) => frame.includes("New project") && frame.includes("Path"))

  await setup.mockInput.typeText("Created")
  await setup.mockInput.pressEnter()
  await setup.waitFor(() => calls.some((call) => call.method === "POST" && call.path === "/api/orchestra/project"))
  expect(calls.find((call) => call.method === "POST")?.body).toEqual({ name: "Created", directory })
})

test("a new project can start with an AI team from a template", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, calls, [])

  const add = cell(await setup.waitForFrame((frame) => frame.includes("+ Project")), "+ Project")
  await setup.mockMouse.click(add.x, add.y)
  // the template list shows each team with its roles; "No team" is selected first
  await setup.waitForFrame((frame) => frame.includes("● No team") && frame.includes("Architect, Developer"))

  await setup.mockInput.typeText("Team")
  await setup.mockInput.pressTab()
  await setup.mockInput.pressTab()
  await setup.mockInput.pressArrow("down")
  await setup.waitForFrame((frame) => frame.includes("● Feature"))
  await setup.mockInput.pressEnter()
  await setup.waitFor(() => calls.some((call) => call.method === "POST" && call.path === "/api/orchestra/project"))
  expect(calls.find((call) => call.method === "POST")?.body).toEqual({ name: "Team", directory, template: "feature" })
})

test("the team is picked with the mouse and a click on a field takes the keyboard back", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, calls, [])

  const add = cell(await setup.waitForFrame((frame) => frame.includes("+ Project")), "+ Project")
  await setup.mockMouse.click(add.x, add.y)
  const frame = await setup.waitForFrame((frame) => frame.includes("● No team") && frame.includes("Feature"))
  const feature = cell(frame, "Feature")
  await setup.mockMouse.click(feature.x, feature.y)
  const picked = await setup.waitForFrame((frame) => frame.includes("● Feature"))

  // back in the name field by mouse: typing goes there, not to the team list
  const name = cell(picked, "Name")
  await setup.mockMouse.click(name.x + 8, name.y)
  await Bun.sleep(30)
  await setup.mockInput.typeText("Mouse")
  await setup.mockInput.pressEnter()
  await setup.waitFor(() => calls.some((call) => call.method === "POST" && call.path === "/api/orchestra/project"))
  expect(calls.find((call) => call.method === "POST")?.body).toEqual({ name: "Mouse", directory, template: "feature" })
})

test("a session is moved to another category from the tree", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, calls, [project])

  const frame = await setup.waitForFrame((frame) => frame.includes("Build") && frame.includes("Worker task"))
  const row = frame.split("\n").findIndex((line) => line.includes("Worker task"))
  const hash = frame.split("\n")[row].indexOf("# ")
  await setup.mockMouse.click(hash, row)
  // the dialog starts from the current category
  await setup.waitForFrame((frame) => frame.includes("Session category"))
  for (const _ of "Build") await setup.mockInput.pressBackspace()
  await setup.mockInput.typeText("Quality")
  await setup.mockInput.pressEnter()
  await setup.waitFor(() => calls.some((call) => call.path === `/api/orchestra/category/${worker.id}`))
  expect(calls.find((call) => call.path === `/api/orchestra/category/${worker.id}`)?.body).toEqual({
    category: "Quality",
  })
  await setup.waitForFrame((frame) => frame.split("\n").some((line) => line.trim() === "Quality"))
})
