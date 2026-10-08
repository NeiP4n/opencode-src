import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("a project has one main session and per-session access for it", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-")))
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
      config: { directory: tmp.path, project: false, content: "{}" },
    })
    const call = (path: string, method = "GET", body?: unknown) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://opencode.local${path}`, {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        )
        const text = await response.text()
        return { status: response.status, body: text ? JSON.parse(text) : undefined }
      })

    const worker = (yield* call("/api/session", "POST", { title: "Worker", location: { directory: tmp.path } })).body
      .data
    const projectID = worker.projectID

    // nothing is opened until the operator opens the project
    expect((yield* call(`/api/orchestra/${projectID}`)).body).toEqual({ access: {} })

    const main = (yield* call(`/api/orchestra/${projectID}/main`, "POST")).body
    expect(main).toMatchObject({ projectID, title: "Orchestra" })
    // opening again returns the same session
    expect((yield* call(`/api/orchestra/${projectID}/main`, "POST")).body.id).toBe(main.id)

    expect((yield* call(`/api/orchestra/access/${worker.id}`, "PUT", { access: "write" })).status).toBe(204)
    expect((yield* call(`/api/orchestra/${projectID}`)).body).toEqual({
      main: main.id,
      access: { [worker.id]: "write" },
    })

    expect((yield* call(`/api/orchestra/access/${worker.id}`, "PUT", { access: "everything" })).status).toBe(400)
    expect((yield* call(`/api/orchestra/${projectID}/main`.replace(projectID, "missing"), "POST")).status).toBe(404)
  }).pipe(Effect.scoped),
)
