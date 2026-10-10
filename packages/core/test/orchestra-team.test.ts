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
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "./fixture/location"
import { TeamPlugin } from "@opencode/core/plugin/team"
import { agentHost, host } from "./plugin/host"
import type { PermissionEvaluation } from "@opencode/plugin/effect/permission"

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
      Agent.node,
    ]),
    [
      SessionExecution.node.replace(executionNode),
      Global.node.replace(tempGlobalLayer),
      Location.node.replace(
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/project") }))),
      ),
      offlineModels,
    ],
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

      // a second project in the same directory brings its own orchestrator, which joins neither team
      const neighbour = yield* orchestra.create({ name: "Neighbour", directory: tmp.path, template: "docs" })
      const ownIDs = (yield* orchestra.sessions(project.id)).map((session) => session.id)
      expect(ownIDs).not.toContain(neighbour.main)
      expect((yield* orchestra.sessions(neighbour.id)).map((session) => session.id)).not.toContain(main)
      // and neither team is copied into the other one
      expect(ownIDs.toSorted()).toEqual(members.map((session) => session.id).toSorted())
      const theirs = yield* orchestra.sessions(neighbour.id)
      expect(theirs.map((session) => session.agent).toSorted()).toEqual([
        Orchestra.role("reviewer"),
        Orchestra.role("writer"),
      ])
      expect(yield* orchestra.owns(project, theirs[0])).toBe(false)
      expect(yield* orchestra.owns(neighbour, theirs[0])).toBe(true)

      // a session no project opened goes to the oldest project in the directory until one claims it
      const sessions = yield* Session.Service
      const loose = yield* sessions.create({ location: { directory: developer.location.directory } })
      expect(yield* orchestra.owns(project, loose)).toBe(true)
      yield* orchestra.claim(loose.id, neighbour.id)
      expect(yield* orchestra.owns(project, loose)).toBe(false)
      expect((yield* orchestra.sessions(neighbour.id)).map((session) => session.id)).toContain(loose.id)
      // forgetting a project hands its sessions back to the directory rule
      yield* orchestra.remove(neighbour.id)
      expect(yield* orchestra.owners()).not.toHaveProperty(loose.id)
      expect(yield* orchestra.owns(project, loose)).toBe(true)

      // a run the operator started themselves is not reported
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

  it.live("operators add their own roles and teams and edit the built-in ones", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-team-")))
      const orchestra = yield* Orchestra.Service
      const auditor = yield* orchestra.saveRole(undefined, {
        name: " Code Auditor ",
        description: "Audits",
        rules: "Check licenses.",
        category: "",
        readOnly: true,
        model: "test/member",
      })
      expect(auditor).toMatchObject({ id: "code-auditor", name: "Code Auditor", category: "Team", origin: "custom" })
      expect(auditor.agent).toBe(Orchestra.role("code-auditor"))
      // a second role of the same name gets its own id
      const second = yield* orchestra.saveRole(undefined, { ...auditor, model: undefined })
      expect(second.id).toBe("code-auditor-2")

      const edited = yield* orchestra.saveRole("tester", { ...auditor, name: "QA", model: undefined })
      expect(edited.origin).toBe("edited")
      const roles = yield* orchestra.roles()
      expect(roles.find((role) => role.id === "tester")).toMatchObject({ name: "QA", origin: "edited" })
      expect(roles.slice(-2).map((role) => role.id)).toEqual(["code-auditor", "code-auditor-2"])

      const template = yield* orchestra.saveTemplate(undefined, {
        name: "Audit",
        description: "",
        members: [{ agent: auditor.agent, title: "", category: "" }],
      })
      expect(template).toMatchObject({ id: "audit", origin: "custom" })
      expect(template.members).toEqual([{ agent: auditor.agent, title: "Code Auditor", category: "Team" }])

      const project = yield* orchestra.create({ name: "Audit", directory: tmp.path, template: "audit" })
      const [member] = yield* orchestra.sessions(project.id)
      expect(member.agent).toBe(auditor.agent)
      // the runner reads only the session's model, so the role's model is set on its session
      expect(member.model).toMatchObject({ providerID: "test", id: "member" })

      // a custom role a team uses cannot be removed; removing an edited built-in restores it
      const blocked = yield* orchestra.removeRole("code-auditor").pipe(Effect.flip)
      expect(blocked.message).toContain("Audit")
      yield* orchestra.removeRole("tester")
      expect((yield* orchestra.roles()).find((role) => role.id === "tester")).toMatchObject({
        name: "Tester",
        origin: "builtin",
      })
      yield* orchestra.removeTemplate("audit")
      yield* orchestra.removeRole("code-auditor")
      expect((yield* orchestra.templates()).some((item) => item.id === "audit")).toBe(false)
      expect((yield* orchestra.roles()).some((role) => role.id === "code-auditor")).toBe(false)

      const invalid = yield* orchestra.saveRole(undefined, { ...auditor, model: "no-slash" }).pipe(Effect.flip)
      expect(invalid.field).toBe("model")
      const unknown = yield* orchestra
        .saveTemplate(undefined, {
          name: "X",
          description: "",
          members: [{ agent: Orchestra.role("nobody"), title: "", category: "" }],
        })
        .pipe(Effect.flip)
      expect(unknown.field).toBe("members")
    }).pipe(Effect.scoped),
  )

  it.live("team roles are agents that follow the operator's edits", () =>
    Effect.gen(function* () {
      const orchestra = yield* Orchestra.Service
      const agents = yield* Agent.Service
      const hooks: Array<(event: PermissionEvaluation) => Effect.Effect<void>> = []
      yield* TeamPlugin.Plugin.effect(
        host({
          agent: agentHost(agents),
          permission: {
            hook: (_, callback) => Effect.sync(() => hooks.push(callback)).pipe(Effect.as({ dispose: Effect.void })),
            list: () => Effect.die("unused permission.list"),
            get: () => Effect.die("unused permission.get"),
            reply: () => Effect.die("unused permission.reply"),
          },
        }),
      )
      // What the permission service passes to plugins once every agent and config rule allowed the edit.
      const evaluate = (agent: Agent.ID, action: string) =>
        Effect.gen(function* () {
          const event: PermissionEvaluation = {
            sessionID: Session.ID.create(),
            agent,
            action,
            resources: ["/project/file.txt"],
            effect: "allow",
          }
          yield* Effect.forEach(hooks, (hook) => hook(event), { discard: true })
          return event.effect
        })
      expect(String((yield* agents.get(Orchestra.role("developer")))?.name)).toBe("Developer")

      const role = yield* orchestra.saveRole(undefined, {
        name: "Translator",
        description: "Translates",
        rules: "Translate to Russian.",
        category: "Build",
        readOnly: true,
        model: "test/member",
      })
      const agent = yield* agents.get(role.agent).pipe(
        Effect.filterOrFail((item) => item !== undefined),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(agent.system).toEndWith("Translate to Russian.")
      expect(agent.model).toEqual(model)
      expect(agent.permissions).toContainEqual({ action: "edit", resource: "*", effect: "deny" })
      // a global `edit: allow` from config cannot reopen a read-only role
      expect(yield* evaluate(role.agent, "edit")).toBe("deny")
      expect(yield* evaluate(role.agent, "read")).toBe("allow")
      expect(yield* evaluate(Orchestra.role("developer"), "edit")).toBe("allow")
      expect(yield* evaluate(Orchestra.agent, "edit")).toBe("deny")

      yield* orchestra.removeRole(role.id)
      yield* agents.get(role.agent).pipe(
        Effect.filterOrFail((item) => item === undefined),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
    }).pipe(Effect.scoped),
  )
})
