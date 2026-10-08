import { expect } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
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
