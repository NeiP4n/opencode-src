import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const project = {
  id: "project",
  canonical: directory,
  name: "Demo",
  time: { created: 0, updated: 0, active: 0 },
  sandboxes: [],
}
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
const main = session("ses_main", "Orchestra")

function render(state: string, calls: { method: string; path: string; body?: unknown }[]) {
  return createAppFixture({
    width: 120,
    state,
    args: { sessionID: worker.id },
    config: { animations: false, session: { sidebar: "hide" } },
    fetch: async (url, request) => {
      if (url.pathname.startsWith("/api/orchestra"))
        calls.push({
          method: request.method,
          path: url.pathname,
          body: request.method === "PUT" ? await request.json() : undefined,
        })
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/project") return json([project])
      if (url.pathname === "/api/orchestra/project") return json({ access: { [worker.id]: "write" } })
      if (url.pathname === "/api/orchestra/project/main") return json(main)
      if (url.pathname.startsWith("/api/orchestra/access/")) return new Response(null, { status: 204 })
      if (url.pathname === "/api/session") return json({ data: [worker], cursor: {} })
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

test("the left panel lists projects with the orchestra and sessions at their access level", async () => {
  await using state = await tmpdir()
  const calls: { method: string; path: string; body?: unknown }[] = []
  await using setup = await render(state.path, calls)

  const frame = await setup.waitForFrame(
    // the open session's project starts expanded and shows the access the operator granted
    (frame) => frame.includes("Projects") && frame.includes("Demo") && frame.includes("[write]"),
  )
  expect(frame).toContain("Orchestra")
  expect(frame).toContain("Worker task")

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
  const orchestra = cell(setup.captureCharFrame(), "Orchestra")
  await setup.mockMouse.click(orchestra.x, orchestra.y)
  await setup.waitFor(() => calls.some((call) => call.path === "/api/orchestra/project/main"))
})
