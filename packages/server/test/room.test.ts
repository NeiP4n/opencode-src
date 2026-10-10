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
    expect(listed.body.rooms).toEqual([{ id: room.id, name: "Lab", open: false }])
    expect(typeof listed.body.host).toBe("string")
  }).pipe(Effect.scoped),
)

it.live("an open room admits guests by its ID without a code; a closed one does not", () =>
  Effect.gen(function* () {
    const { call, room } = yield* setup
    const closed = yield* call("/api/room/join", { method: "POST", body: { roomID: room.id, name: "Phone" } })
    expect(closed.status).toBe(401)

    yield* call(`/api/room/${room.id}`, { method: "PATCH", headers: host, body: { open: true } })
    expect((yield* call("/api/room/public")).body.rooms).toEqual([{ id: room.id, name: "Lab", open: true }])
    const joined = yield* call("/api/room/join", { method: "POST", body: { roomID: room.id, name: "Phone" } })
    expect(joined.status).toBe(200)
    expect(joined.body.room).toMatchObject({ id: room.id, open: true })
    const view = yield* call(`/api/room/${room.id}/guest`, {
      headers: { authorization: `Bearer ${joined.body.token}` },
    })
    expect(view.status).toBe(200)
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

it.live("guests join as members the host lists, and a viewer may read but not post", () =>
  Effect.gen(function* () {
    const { call, room, code, session } = yield* setup
    const joined = (yield* call("/api/room/join", { method: "POST", body: { code, name: "Phone", device: "dev-1" } }))
      .body
    expect(joined.role).toBe("member")
    const guest = { authorization: `Bearer ${joined.token}` }
    expect((yield* call(`/api/room/${room.id}/guest`, { headers: guest })).body.role).toBe("member")

    const members = (yield* call(`/api/room/${room.id}/member`, { headers: host })).body.data
    expect(members).toMatchObject([
      { id: joined.guest.id, name: "Phone", role: "member", device: "dev-1", online: true },
    ])
    // the member list is the host's: a guest token does not open it
    expect((yield* call(`/api/room/${room.id}/member`, { headers: guest })).status).toBe(401)

    // guests read the full session, as the host's own message list pages it
    const full = yield* call(`/api/room/${room.id}/guest/session/message`, { headers: guest })
    expect(full.status).toBe(200)
    expect(full.body.cursor).toBeDefined()
    yield* call(`/api/room/${room.id}/guest/prompt`, { method: "POST", headers: guest, body: { text: "hi" } })
    expect((yield* call(`/api/session/${session.id}/inbox`, { headers: host })).status).toBe(200)

    const updated = yield* call(`/api/room/${room.id}/member/${joined.guest.id}`, {
      method: "PATCH",
      headers: host,
      body: { role: "viewer" },
    })
    expect(updated.body.data.role).toBe("viewer")
    expect((yield* call(`/api/room/${room.id}/guest/message`, { headers: guest })).status).toBe(200)
    const blocked = yield* call(`/api/room/${room.id}/guest/prompt`, {
      method: "POST",
      headers: guest,
      body: { text: "may I?" },
    })
    expect(blocked.status).toBe(403)
  }).pipe(Effect.scoped),
)

it.live("a kicked guest loses the room until it joins again; a banned one cannot", () =>
  Effect.gen(function* () {
    const { call, room, code } = yield* setup
    const join = (name: string, device: string) =>
      call("/api/room/join", { method: "POST", body: { code, name, device } })
    const first = (yield* join("Phone", "dev-1")).body
    const guest = { authorization: `Bearer ${first.token}` }

    expect(
      (yield* call(`/api/room/${room.id}/member/${first.guest.id}`, { method: "DELETE", headers: host })).status,
    ).toBe(204)
    expect((yield* call(`/api/room/${room.id}/guest`, { headers: guest })).status).toBe(401)

    const again = (yield* join("Phone", "dev-1")).body
    expect(again.token).toBeDefined()
    const ban = yield* call(`/api/room/${room.id}/member/${again.guest.id}/ban`, { method: "POST", headers: host })
    expect(ban.body.data).toMatchObject({ name: "Phone", device: "dev-1" })
    expect(
      (yield* call(`/api/room/${room.id}/guest`, { headers: { authorization: `Bearer ${again.token}` } })).status,
    ).toBe(401)
    // a new name does not get past the ban; another device does
    expect((yield* join("Tablet", "dev-1")).status).toBe(401)
    expect((yield* join("Tablet", "dev-2")).status).toBe(200)

    const bans = (yield* call(`/api/room/${room.id}/ban`, { headers: host })).body.data
    expect(bans).toHaveLength(1)
    yield* call(`/api/room/${room.id}/ban/${bans[0].id}`, { method: "DELETE", headers: host })
    expect((yield* join("Phone", "dev-1")).status).toBe(200)
  }).pipe(Effect.scoped),
)

it.live("a helper answers permission requests; a member may not", () =>
  Effect.gen(function* () {
    const { call, room, code } = yield* setup
    const joined = (yield* call("/api/room/join", { method: "POST", body: { code, name: "Phone" } })).body
    const guest = { authorization: `Bearer ${joined.token}` }
    const reply = () =>
      call(`/api/room/${room.id}/guest/permission/per_missing/reply`, {
        method: "POST",
        headers: guest,
        body: { decision: "once" },
      })
    expect((yield* reply()).status).toBe(403)
    yield* call(`/api/room/${room.id}/member/${joined.guest.id}`, {
      method: "PATCH",
      headers: host,
      body: { role: "helper" },
    })
    // past the role check the request is simply unknown
    expect((yield* reply()).status).toBe(404)
  }).pipe(Effect.scoped),
)

it.live("a project room opens every session under its directory and lets members start new ones", () =>
  Effect.gen(function* () {
    const { call, session, directory } = yield* setup
    const project = (yield* call("/api/room", {
      method: "POST",
      headers: host,
      body: { sessionID: session.id, name: "Project", directory, open: true },
    })).body.data
    expect(project.directory).toBe(directory)
    const other = (yield* call("/api/session", {
      method: "POST",
      headers: host,
      body: { title: "Other", location: { directory } },
    })).body.data
    const outside = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-room-outside-")))
    const elsewhere = (yield* call("/api/session", {
      method: "POST",
      headers: host,
      body: { title: "Elsewhere", location: { directory: outside.path } },
    })).body.data

    const joined = (yield* call("/api/room/join", { method: "POST", body: { roomID: project.id, name: "Phone" } })).body
    const guest = { authorization: `Bearer ${joined.token}` }
    const listed = (yield* call(`/api/room/${project.id}/guest/session`, { headers: guest })).body.data.map(
      (item: { id: string }) => item.id,
    )
    expect(listed).toContain(session.id)
    expect(listed).toContain(other.id)
    expect(listed).not.toContain(elsewhere.id)

    // another session of the project opens and takes prompts; one outside it reads as missing
    expect(
      (yield* call(`/api/room/${project.id}/guest?sessionID=${other.id}`, { headers: guest })).body.session.id,
    ).toBe(other.id)
    const prompt = yield* call(`/api/room/${project.id}/guest/prompt`, {
      method: "POST",
      headers: guest,
      body: { text: "in the other one", sessionID: other.id },
    })
    expect(prompt.status).toBe(200)
    expect((yield* call(`/api/room/${project.id}/guest?sessionID=${elsewhere.id}`, { headers: guest })).status).toBe(
      404,
    )
    expect(
      (yield* call(`/api/room/${project.id}/guest/session/message?sessionID=${elsewhere.id}`, { headers: guest }))
        .status,
    ).toBe(404)

    const created = yield* call(`/api/room/${project.id}/guest/session`, {
      method: "POST",
      headers: guest,
      body: { title: "From the phone" },
    })
    expect(created.status).toBe(200)
    expect(created.body.data.location.directory).toBe(directory)
  }).pipe(Effect.scoped),
)

it.live("only cohosts switch the model and agent or run commands; a single-session room starts no sessions", () =>
  Effect.gen(function* () {
    const { call, session, room, code } = yield* setup
    const joined = (yield* call("/api/room/join", { method: "POST", body: { code, name: "Phone" } })).body
    const guest = { authorization: `Bearer ${joined.token}` }
    const agent = () =>
      call(`/api/room/${room.id}/guest/session/${session.id}/agent`, {
        method: "POST",
        headers: guest,
        body: { agent: "build" },
      })
    expect((yield* agent()).status).toBe(403)
    expect((yield* call(`/api/room/${room.id}/guest/agent`, { headers: guest })).status).toBe(200)
    expect(
      (yield* call(`/api/room/${room.id}/guest/session`, { method: "POST", headers: guest, body: {} })).status,
    ).toBe(400)

    yield* call(`/api/room/${room.id}/member/${joined.guest.id}`, {
      method: "PATCH",
      headers: host,
      body: { role: "cohost" },
    })
    expect((yield* agent()).status).toBe(204)
  }).pipe(Effect.scoped),
)

it.live("a guest who leaves drops out of the host's members and its token stops working", () =>
  Effect.gen(function* () {
    const { call, room, code } = yield* setup
    const joined = (yield* call("/api/room/join", { method: "POST", body: { code, name: "Phone" } })).body
    const guest = { authorization: `Bearer ${joined.token}` }
    expect((yield* call(`/api/room/${room.id}/member`, { headers: host })).body.data).toHaveLength(1)
    expect((yield* call(`/api/room/${room.id}/guest`, { method: "DELETE", headers: guest })).status).toBe(204)
    expect((yield* call(`/api/room/${room.id}/member`, { headers: host })).body.data).toEqual([])
    expect((yield* call(`/api/room/${room.id}/guest`, { headers: guest })).status).toBe(401)
  }).pipe(Effect.scoped),
)
