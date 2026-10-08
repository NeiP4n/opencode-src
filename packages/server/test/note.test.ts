import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const host = { authorization: `Basic ${btoa("opencode:secret")}` }

const setup = Effect.gen(function* () {
  const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-note-")))
  const handler = yield* ServerFetch.make({
    app: { version: "test" },
    database: { path: ":memory:" },
    fs: { filewatcher: false },
    models: { fetch: false },
    config: { directory: tmp.path, project: false, content: "{}" },
    password: "secret",
  })
  const at = `location[directory]=${encodeURIComponent(tmp.path)}`
  const call = (path: string, init: { method?: string; body?: unknown } = {}) =>
    Effect.promise(async () => {
      const response = await handler(
        new Request(`http://opencode.local${path}${path.includes("?") ? "&" : "?"}${at}`, {
          method: init.method ?? "GET",
          headers: { "content-type": "application/json", ...host },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        }),
      )
      const text = await response.text()
      return { status: response.status, body: text ? JSON.parse(text) : undefined }
    })
  return { call }
})

it.live("creates, edits, binds and removes a note over the API", () =>
  Effect.gen(function* () {
    const { call } = yield* setup

    const created = yield* call("/api/note", {
      method: "POST",
      body: { title: "План сети", body: "draft", length: "brief" },
    })
    expect(created.status).toBe(200)
    expect(created.body.data).toMatchObject({
      name: "plan-seti",
      body: "draft",
      frontmatter: { title: "План сети", length: "brief", status: "inbox" },
    })

    const edited = yield* call("/api/note/plan-seti/edit", {
      method: "POST",
      body: { body: "more", mode: "append", expectedMtime: created.body.data.mtime },
    })
    expect(edited.status).toBe(200)
    expect(edited.body.data.body).toBe("draft\nmore")

    const updated = yield* call("/api/note/plan-seti", {
      method: "PATCH",
      body: { length: "detailed", status: "active", expectedMtime: edited.body.data.mtime },
    })
    expect(updated.body.data.frontmatter).toMatchObject({ length: "detailed", status: "active" })

    const linked = yield* call("/api/note/plan-seti/link", {
      method: "POST",
      body: { session: "ses_canvas", expectedMtime: updated.body.data.mtime },
    })
    expect(linked.body.data.frontmatter.session).toBe("ses_canvas")
    expect((yield* call("/api/note/session/ses_canvas")).body.data.name).toBe("plan-seti")
    expect((yield* call("/api/note/session/ses_nobody")).body.data).toBeNull()
    expect((yield* call("/api/note")).body.data.map((note: { name: string }) => note.name)).toEqual(["plan-seti"])

    const unlinked = yield* call("/api/note/plan-seti/link", {
      method: "POST",
      body: { expectedMtime: linked.body.data.mtime },
    })
    expect(unlinked.body.data.frontmatter.session).toBeUndefined()

    const removed = yield* call(`/api/note/plan-seti?expectedMtime=${unlinked.body.data.mtime}`, { method: "DELETE" })
    expect(removed.status).toBe(204)
    expect((yield* call("/api/note/plan-seti")).status).toBe(404)
  }).pipe(Effect.scoped),
)

it.live("maps a stale write to 409, a missing note to 404 and a bad name to 400", () =>
  Effect.gen(function* () {
    const { call } = yield* setup
    const created = yield* call("/api/note", { method: "POST", body: { title: "Plan", name: "room-plan" } })

    const stale = yield* call("/api/note/room-plan/edit", {
      method: "POST",
      body: { body: "late", expectedMtime: created.body.data.mtime - 1000 },
    })
    expect(stale.status).toBe(409)
    expect(stale.body).toMatchObject({
      _tag: "NoteConflictError",
      name: "room-plan",
      expected: created.body.data.mtime - 1000,
      actual: created.body.data.mtime,
    })

    const missing = yield* call("/api/note/absent-note")
    expect(missing.status).toBe(404)
    expect(missing.body._tag).toBe("NoteNotFoundError")

    const invalid = yield* call("/api/note", { method: "POST", body: { title: "Plan", name: "Not A Slug" } })
    expect(invalid.status).toBe(400)
    expect(invalid.body).toMatchObject({ _tag: "InvalidRequestError", field: "name", kind: "not_slug" })
  }).pipe(Effect.scoped),
)
