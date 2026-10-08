import { expect } from "bun:test"
import { SessionExecution } from "@opencode/core/session/execution"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Effect, Layer } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"
import { ServerRoomDiscovery } from "../src/room-discovery"
import { PORT, QUERY, decodeReply } from "@opencode/protocol/room-discovery"
import { createSocket } from "node:dgram"
import { hostname } from "node:os"

// Rooms only admit prompts; no model runs in these tests.
const idle = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.succeed(new Set()),
    isActive: () => Effect.succeed(false),
    resume: () => Effect.void,
    wake: () => Effect.void,
    interrupt: () => Effect.succeed(false),
    awaitIdle: () => Effect.void,
  }),
)

const host = { authorization: `Basic ${btoa("opencode:secret")}` }

const setup = Effect.gen(function* () {
  const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-room-")))
  const handler = yield* ServerFetch.make(
    {
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
      config: { directory: tmp.path, project: false, content: "{}" },
      password: "secret",
    },
    {
      overrides: [
        SessionExecution.node.replace(makeGlobalNode({ service: SessionExecution.Service, layer: idle, deps: [] })),
      ],
    },
  )
  const call = (path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) =>
    Effect.promise(async () => {
      const response = await handler(
        new Request(`http://opencode.local${path}`, {
          method: init.method ?? "GET",
          headers: { "content-type": "application/json", ...init.headers },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        }),
      )
      const text = await response.text()
      return { status: response.status, body: text ? JSON.parse(text) : undefined }
    })
  const session = (yield* call("/api/session", {
    method: "POST",
    headers: host,
    body: { title: "Shared", location: { directory: tmp.path } },
  })).body.data
  const room = (yield* call("/api/room", {
    method: "POST",
    headers: host,
    body: { sessionID: session.id, name: "Lab" },
  })).body.data
  const code = (yield* call(`/api/room/${room.id}/code`, { method: "POST", headers: host })).body.code as string
  return { call, session, room, code, directory: tmp.path }
})

it.live("a join code admits a guest whose token opens only that room", () =>
  Effect.gen(function* () {
    const { call, session, room, code } = yield* setup
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)

    // codes are typed by hand, so case and separators do not matter
    const joined = yield* call("/api/room/join", {
      method: "POST",
      body: { code: code.toLowerCase().replace("-", " "), name: "Laptop" },
    })
    expect(joined.status).toBe(200)
    expect(joined.body.room).toMatchObject({ id: room.id, sessionID: session.id, name: "Lab" })
    const guest = { authorization: `Bearer ${joined.body.token}` }

    const view = yield* call(`/api/room/${room.id}/guest`, { headers: guest })
    expect(view.status).toBe(200)
    expect(view.body.session.id).toBe(session.id)
    expect(view.body.guest.name).toBe("Laptop")

    // the token is no server credential: the host API stays closed
    expect((yield* call("/api/session", { headers: guest })).status).toBe(401)
    expect((yield* call(`/api/session/${session.id}`, { headers: guest })).status).toBe(401)
    expect((yield* call("/api/room", { headers: guest })).status).toBe(401)
    // and it does not open another room
    const other = (yield* call("/api/room", { method: "POST", headers: host, body: { sessionID: session.id } })).body
      .data
    expect((yield* call(`/api/room/${other.id}/guest`, { headers: guest })).status).toBe(401)
    // without a token the guest routes refuse as well
    expect((yield* call(`/api/room/${room.id}/guest`)).status).toBe(401)
  }).pipe(Effect.scoped),
)

it.live("devices on the network see room names without a credential", () =>
  Effect.gen(function* () {
    const { call, room } = yield* setup
    const listed = yield* call("/api/room/public")
    expect(listed.status).toBe(200)
    expect(listed.body.rooms).toEqual([{ id: room.id, name: "Lab" }])
    expect(typeof listed.body.host).toBe("string")
  }).pipe(Effect.scoped),
)

it.live("the discovery responder answers a broadcast query with name and port", () =>
  Effect.gen(function* () {
    yield* ServerRoomDiscovery.respond(4321)
    const reply = yield* Effect.promise(
      () =>
        new Promise<string>((resolve) => {
          const socket = createSocket("udp4")
          socket.on("message", (message) => {
            socket.close()
            resolve(message.toString())
          })
          socket.bind(0, () => socket.send(QUERY, PORT, "127.0.0.1"))
        }),
    )
    expect(decodeReply(reply)).toEqual({ name: hostname(), port: 4321 })
  }).pipe(Effect.scoped),
)

it.live("a wrong code is refused and a forged token does not verify", () =>
  Effect.gen(function* () {
    const { call, room } = yield* setup
    const wrong = yield* call("/api/room/join", { method: "POST", body: { code: "AAAA-AAAA", name: "Phone" } })
    expect(wrong.status).toBe(401)
    const forged = { authorization: `Bearer ${room.id}.guest.9999999999.UGhvbmU.signature` }
    expect((yield* call(`/api/room/${room.id}/guest`, { headers: forged })).status).toBe(401)
  }).pipe(Effect.scoped),
)

it.live("the server stamps the guest as author and keeps approvals with the host", () =>
  Effect.gen(function* () {
    const { call, room, code } = yield* setup
    const joined = (yield* call("/api/room/join", { method: "POST", body: { code, name: "Phone" } })).body
    const guest = { authorization: `Bearer ${joined.token}` }

    const prompt = yield* call(`/api/room/${room.id}/guest/prompt`, {
      method: "POST",
      headers: guest,
      body: { text: "hello from the phone" },
    })
    expect(prompt.status).toBe(200)
    expect(prompt.body.data.payload.metadata.room).toEqual({ id: room.id, guest: joined.guest })

    // the guest's chat shows plain messages with their author
    const chat = yield* call(`/api/room/${room.id}/guest/message`, { headers: guest })
    expect(chat.status).toBe(200)
    expect(chat.body.running).toBe(false)

    const reply = yield* call(`/api/room/${room.id}/guest/permission/per_missing/reply`, {
      method: "POST",
      headers: guest,
      body: { decision: "once" },
    })
    expect(reply.status).toBe(403)
  }).pipe(Effect.scoped),
)

it.live("guests see the note the shared session is bound to", () =>
  Effect.gen(function* () {
    const { call, session, room, code, directory } = yield* setup
    const joined = (yield* call("/api/room/join", { method: "POST", body: { code, name: "Phone" } })).body
    const guest = { authorization: `Bearer ${joined.token}` }

    const before = yield* call(`/api/room/${room.id}/guest/note`, { headers: guest })
    expect(before.status).toBe(200)
    expect(before.body.data).toBeNull()
    expect((yield* call(`/api/room/${room.id}/guest/message`, { headers: guest })).body.note).toBeUndefined()

    const created = yield* call(`/api/note?location[directory]=${encodeURIComponent(directory)}`, {
      method: "POST",
      headers: host,
      body: { title: "Room plan", body: "draft", session: session.id },
    })
    expect(created.status).toBe(200)

    const after = yield* call(`/api/room/${room.id}/guest/note`, { headers: guest })
    expect(after.status).toBe(200)
    expect(after.body.data).toMatchObject({ name: "room-plan", body: "draft", frontmatter: { title: "Room plan" } })
    const chat = yield* call(`/api/room/${room.id}/guest/message`, { headers: guest })
    expect(chat.body.note).toEqual({ name: "room-plan", title: "Room plan" })
    // the room token opens the note of its own room only
    expect((yield* call(`/api/room/${room.id}/guest/note`)).status).toBe(401)
  }).pipe(Effect.scoped),
)

it.live("closing a room revokes its guests", () =>
  Effect.gen(function* () {
    const { call, room, code } = yield* setup
    const joined = (yield* call("/api/room/join", { method: "POST", body: { code, name: "Phone" } })).body
    expect((yield* call(`/api/room/${room.id}`, { method: "DELETE", headers: host })).status).toBe(204)
    expect(
      (yield* call(`/api/room/${room.id}/guest`, { headers: { authorization: `Bearer ${joined.token}` } })).status,
    ).toBe(404)
    // the code dies with the room
    expect((yield* call("/api/room/join", { method: "POST", body: { code, name: "Late" } })).status).toBe(401)
  }).pipe(Effect.scoped),
)
