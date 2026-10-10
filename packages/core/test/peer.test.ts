import { describe, expect } from "bun:test"
import { Effect, Layer, Schedule } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Job } from "@opencode/core/job"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Peer } from "@opencode/core/peer"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { tmpdir } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"
import { location } from "./fixture/location"

// Nothing runs a model here: reports are admitted to the sender's inbox and stay there.
const idle = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.succeed(
    SessionExecution.Service,
    SessionExecution.Service.of({
      active: Effect.succeed(new Set()),
      isActive: () => Effect.succeed(false),
      resume: () => Effect.void,
      wake: () => Effect.void,
      interrupt: () => Effect.succeed(false),
      awaitIdle: () => Effect.void,
    }),
  ),
  deps: [],
})

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      Job.node,
      Session.node,
      SessionExecution.node,
      LocationServiceMap.node,
      Peer.node,
    ]),
    [
      SessionExecution.node.replace(idle),
      Global.node.replace(tempGlobalLayer),
      Location.node.replace(
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/project") }))),
      ),
      offlineModels,
    ],
  ),
)

// The friend's computer: one room whose AI answers each prompt a moment later.
function friend() {
  const state = { closed: false }
  const prompts: unknown[] = []
  const chat: { id: string; role: "user" | "assistant"; text: string; created: number }[] = [
    { id: "old", role: "assistant", text: "an earlier answer", created: 0 },
  ]
  let running = false
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (request.headers.get("authorization") !== "Bearer token")
        return Response.json({ message: "no" }, { status: 401 })
      if (state.closed) return Response.json({ message: "Room not found: room_far" }, { status: 404 })
      if (url.pathname === "/api/room/room_far/guest")
        return Response.json({ role: "member", room: { name: "Far lab" }, session: { id: "ses_far", title: "Far" } })
      if (url.pathname === "/api/room/room_far/guest/message") return Response.json({ data: chat, running })
      if (url.pathname === "/api/room/room_far/guest/prompt") {
        prompts.push(await request.json())
        running = true
        setTimeout(() => {
          if (state.closed) return
          chat.push({ id: "new", role: "assistant", text: "the friend's answer", created: -5 })
          running = false
        }, 200)
        return Response.json({ data: {} })
      }
      return new Response(null, { status: 404 })
    },
  })
  return {
    server,
    prompts,
    close: () => (state.closed = true),
    link: { url: server.url.toString(), roomID: "room_far", token: "token", name: "Far lab", guest: "Bo" },
  }
}

const reports = (sessionID: Session.ID) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const inbox = yield* sessions.inbox(sessionID)
    return inbox.flatMap((item) =>
      item.type === "synthetic" && item.payload.text.startsWith("<peer-report") ? [item.payload.text] : [],
    )
  })

const waitReport = (sessionID: Session.ID) =>
  reports(sessionID).pipe(
    Effect.filterOrFail((found) => found.length > 0),
    Effect.retry(Schedule.spaced("50 millis")),
    Effect.timeout("10 seconds"),
    Effect.map((found) => found[0]),
  )

describe("Peer", () => {
  it.live(
    "a message to the friend's AI comes back as a report once it answers",
    () =>
      Effect.gen(function* () {
        const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-peer-")))
        const host = friend()
        yield* Effect.addFinalizer(() => Effect.promise(() => host.server.stop()))
        const peers = yield* Peer.Service
        const sessions = yield* Session.Service
        const mine = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })

        yield* peers.saveLink(host.link)
        expect(yield* peers.links()).toEqual([host.link])
        const sent = yield* peers.send({ link: host.link, text: "check the parser", from: mine.id })
        expect(sent.id).toBe("ses_far")
        expect(host.prompts).toEqual([{ text: "check the parser", sessionID: "ses_far", ai: true }])

        // the answer counts though the friend's clock dates it before the message was sent
        const report = yield* waitReport(mine.id)
        expect(report).toContain('room="Far lab"')
        expect(report).toContain('state="done"')
        expect(report).toContain("the friend's answer")
        expect(report).not.toContain("an earlier answer")
      }).pipe(Effect.scoped),
    { timeout: 20_000 },
  )

  it.live(
    "a room its host closed, or one this computer left, is reported at once instead of waited for",
    () =>
      Effect.gen(function* () {
        const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-peer-")))
        const host = friend()
        yield* Effect.addFinalizer(() => Effect.promise(() => host.server.stop()))
        const peers = yield* Peer.Service
        const sessions = yield* Session.Service
        const mine = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
        yield* peers.saveLink(host.link)
        yield* peers.send({ link: host.link, text: "hello", from: mine.id })
        // the friend closes the room before answering
        host.close()
        const closed = yield* waitReport(mine.id)
        expect(closed).toContain('state="failed"')
        expect(closed).toContain("Room not found")

        const other = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
        const reopened = friend()
        yield* Effect.addFinalizer(() => Effect.promise(() => reopened.server.stop()))
        yield* peers.saveLink(reopened.link)
        yield* peers.send({ link: reopened.link, text: "hello again", from: other.id })
        yield* peers.removeLink(reopened.link)
        const left = yield* waitReport(other.id)
        expect(left).toContain('state="failed"')
        expect(left).toContain("left the room")
      }).pipe(Effect.scoped),
    { timeout: 20_000 },
  )
})
