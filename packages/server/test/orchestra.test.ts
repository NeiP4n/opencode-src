import { expect } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Effect, Schedule } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("operator projects own the sessions under their directory and one main session each", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-")))
    const app = path.join(tmp.path, "app")
    const nested = path.join(app, "web")
    const other = path.join(tmp.path, "other")
    yield* Effect.promise(() => Promise.all([mkdir(nested, { recursive: true }), mkdir(other)]))
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
      config: { directory: tmp.path, project: false, content: "{}" },
    })
    const call = (route: string, method = "GET", body?: unknown) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://opencode.local${route}`, {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        )
        const text = await response.text()
        return { status: response.status, body: text ? JSON.parse(text) : undefined }
      })
    const session = (directory: string, title: string) =>
      call("/api/session", "POST", { title, location: { directory } }).pipe(
        Effect.map((response) => response.body.data),
      )

    // a path that is not a directory is refused
    expect(
      (yield* call("/api/orchestra/project", "POST", { name: "Ghost", directory: path.join(tmp.path, "nope") })).status,
    ).toBe(400)

    const project = (yield* call("/api/orchestra/project", "POST", { name: "App", directory: app })).body
    expect(project).toMatchObject({ name: "App", directory: app })
    expect((yield* call("/api/orchestra/project")).body.map((item: { id: string }) => item.id)).toEqual([project.id])

    const top = yield* session(app, "Top")
    const deep = yield* session(nested, "Deep")
    yield* session(other, "Elsewhere")

    const main = (yield* call(`/api/orchestra/project/${project.id}/main`, "POST")).body
    expect(main.title).toBe("App · Orchestra")
    expect((yield* call(`/api/orchestra/project/${project.id}/main`, "POST")).body.id).toBe(main.id)

    expect((yield* call(`/api/orchestra/access/${deep.id}`, "PUT", { access: "write" })).status).toBe(204)
    const listed = (yield* call(`/api/orchestra/project/${project.id}/session`)).body
    // sessions below the directory belong to it; the main session and other directories do not
    expect(listed.data.map((item: { id: string }) => item.id).toSorted()).toEqual([top.id, deep.id].toSorted())
    expect(listed.access).toEqual({ [top.id]: "read", [deep.id]: "write" })

    expect((yield* call(`/api/orchestra/project/${project.id}`, "PATCH", { name: "Renamed" })).body.name).toBe(
      "Renamed",
    )
    expect((yield* call(`/api/orchestra/project/${project.id}`, "DELETE")).status).toBe(204)
    expect((yield* call("/api/orchestra/project")).body).toEqual([])
    // forgetting the project keeps its sessions
    expect((yield* call(`/api/session/${main.id}`)).status).toBe(200)
  }).pipe(Effect.scoped),
)

it.live("a team template opens the orchestra and its role sessions, and the orchestra keeps its role", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-team-")))
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
      config: { directory: tmp.path, project: false, content: "{}" },
    })
    const call = (route: string, method = "GET", body?: unknown) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://opencode.local${route}`, {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        )
        const text = await response.text()
        return { status: response.status, body: text ? JSON.parse(text) : undefined }
      })

    const templates = (yield* call("/api/orchestra/template")).body
    const feature = templates.find((item: { id: string }) => item.id === "feature")
    expect(feature.members.map((member: { agent: string }) => member.agent)).toEqual([
      "architect",
      "developer",
      "tester",
      "reviewer",
    ])

    expect(
      (yield* call("/api/orchestra/project", "POST", { name: "X", directory: tmp.path, template: "nope" })).status,
    ).toBe(400)
    // the refused template created nothing
    expect((yield* call("/api/orchestra/project")).body).toEqual([])

    const project = (yield* call("/api/orchestra/project", "POST", {
      name: "Team",
      directory: tmp.path,
      template: "feature",
    })).body
    expect(project.main).toBeDefined()

    const main = (yield* call(`/api/session/${project.main}`)).body.data
    expect(main.agent).toBe("orchestra")
    const listed = (yield* call(`/api/orchestra/project/${project.id}/session`)).body
    const members = listed.data
      .map((item: { title: string; agent: string }) => [item.title, item.agent])
      .toSorted(([a]: string[], [b]: string[]) => a.localeCompare(b))
    expect(members).toEqual([
      ["Architect", "architect"],
      ["Developer", "developer"],
      ["Reviewer", "reviewer"],
      ["Tester", "tester"],
    ])
    expect(Object.values(listed.access)).toEqual(["full", "full", "full", "full"])

    // switching the orchestra to another agent is ignored
    expect((yield* call(`/api/session/${main.id}/agent`, "POST", { agent: "build" })).status).toBe(204)
    expect((yield* call(`/api/session/${main.id}`)).body.data.agent).toBe("orchestra")

    // role agents are registered by plugin activation, which finishes in the background
    const roles = ["orchestra", "architect", "developer", "tester", "reviewer", "debugger", "devops"]
    yield* call("/api/agent").pipe(
      Effect.map((response) => response.body.data.map((agent: { id: string }) => agent.id)),
      Effect.filterOrFail((ids: string[]) => roles.every((role) => ids.includes(role))),
      Effect.retry(Schedule.spaced("10 millis")),
      Effect.timeout("2 seconds"),
    )
  }).pipe(Effect.scoped),
)
