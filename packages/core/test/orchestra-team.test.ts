import { describe, expect } from "bun:test"
import { Effect, Layer, Schedule } from "effect"
import { Money } from "@opencode/schema/money"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Agent } from "@opencode/core/agent"
import { Job } from "@opencode/core/job"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Orchestra } from "@opencode/core/orchestra"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionStore } from "@opencode/core/session/store"
import { tmpdir } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"

const model = Model.Ref.make({ id: Model.ID.make("member"), providerID: Provider.ID.make("test") })
const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

// Stands in for the runner: a woken team session answers with its title and ends
// its run the way the title asks ("fails", "stops at shutdown" or succeeds).
const executionNode = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const store = yield* SessionStore.Service
      const run = Effect.fn("OrchestraTeamTest.run")(function* (sessionID: Session.ID) {
        const session = yield* store.get(sessionID)
        if (!session || session.agent === Orchestra.agent) return
        const assistantMessageID = SessionMessage.ID.create()
        yield* bus.publish(SessionEvent.Step.Started, {
          sessionID,
          assistantMessageID,
          agent: session.agent ?? Agent.ID.make("build"),
          model,
          started: 0,
        })
        yield* bus.publish(SessionEvent.Text.Started, { sessionID, assistantMessageID, ordinal: 0 })
        yield* bus.publish(SessionEvent.Text.Ended, {
          sessionID,
          assistantMessageID,
          ordinal: 0,
          text: `${session.title}: answer`,
        })
        yield* bus.publish(SessionEvent.Step.Ended, {
          sessionID,
          assistantMessageID,
          finish: "stop",
          cost: Money.USD.zero,
          tokens,
        })
        if (session.title?.includes("fails"))
          return yield* bus.publish(SessionEvent.Execution.Failed, {
            sessionID,
            error: { type: "provider.transport", message: "Disconnected" },
          })
        if (session.title?.includes("shutdown"))
          return yield* bus.publish(SessionEvent.Execution.Interrupted, { sessionID, reason: "shutdown" })
        yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID })
      })
      return SessionExecution.Service.of({
        active: Effect.succeed(new Set()),
        isActive: () => Effect.succeed(false),
        resume: run,
        wake: (sessionID) => run(sessionID).pipe(Effect.ignore),
        interrupt: () => Effect.succeed(false),
        awaitIdle: () => Effect.void,
      })
    }),
  ),
  deps: [Bus.node, SessionStore.node],
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
      Orchestra.node,
    ]),
    [SessionExecution.node.replace(executionNode), Global.node.replace(tempGlobalLayer), offlineModels],
  ),
)

// Reports are admitted to the orchestrator's inbox; the stub runner never delivers them.
const reports = (sessionID: Session.ID) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const inbox = yield* sessions.inbox(sessionID)
    return inbox.flatMap((item) =>
      item.type === "synthetic" && item.payload.text.startsWith("<team-report") ? [item.payload.text] : [],
    )
  })

describe("Orchestra team", () => {
  it.live("a dispatched task reports back to the orchestrator when its run ends", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-team-")))
      const orchestra = yield* Orchestra.Service
      const project = yield* orchestra.create({ name: "Team", directory: tmp.path, template: "bugfix" })
      const main = project.main!
      const members = yield* orchestra.sessions(project.id)
      const byTitle = (title: string) => members.find((session) => session.title === title)!

      expect(members.map((session) => session.agent)).toEqual([
        Orchestra.role("debugger"),
        Orchestra.role("developer"),
        Orchestra.role("tester"),
      ])
      expect(yield* orchestra.categories(members.map((session) => session.id))).toEqual({
        [byTitle("Debugger").id]: "Quality",
        [byTitle("Developer").id]: "Build",
        [byTitle("Tester").id]: "Quality",
      })

      const developer = byTitle("Developer")
      yield* orchestra.dispatch({ project, sessionID: developer.id, text: "Fix the bug" })
      const [report] = yield* reports(main).pipe(
        Effect.filterOrFail((found) => found.length > 0),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(report).toContain(`session="${developer.id}"`)
      expect(report).toContain('state="done"')
      expect(report).toContain("Developer: answer")
      expect(yield* orchestra.pending(developer.id)).toBeUndefined()

      // a run the operator started themselves is not reported
      const sessions = yield* Session.Service
      yield* sessions.prompt({ sessionID: developer.id, text: "operator's own question" })
      yield* Effect.sleep("50 millis")
      expect(yield* reports(main)).toHaveLength(1)
    }).pipe(Effect.scoped),
  )

  it.live("failed runs are reported and shutdowns wait for the resumed run", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-team-")))
      const orchestra = yield* Orchestra.Service
      const sessions = yield* Session.Service
      const project = yield* orchestra.create({ name: "Team", directory: tmp.path, template: "docs" })
      const main = project.main!
      const location = { directory: (yield* sessions.get(main)).location.directory }
      const failing = yield* sessions.create({ location, title: "Writer fails", agent: Orchestra.role("writer") })
      const paused = yield* sessions.create({ location, title: "Reviewer shutdown", agent: Orchestra.role("reviewer") })

      yield* orchestra.dispatch({ project, sessionID: paused.id, text: "Review" })
      yield* orchestra.dispatch({ project, sessionID: failing.id, text: "Write" })
      const found = yield* reports(main).pipe(
        Effect.filterOrFail((items) => items.length > 0),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(found).toHaveLength(1)
      expect(found[0]).toContain('state="failed"')
      expect(found[0]).toContain("Run failed: Disconnected")
      // the shutdown left its task open for the run that resumes after restart
      expect(yield* orchestra.pending(paused.id)).toBeNumber()
    }).pipe(Effect.scoped),
  )
})
