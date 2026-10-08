export * as Orchestra from "./orchestra.js"

import { Context, Effect, Layer, Option, Schema, Stream } from "effect"
import path from "node:path"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Orchestra } from "@opencode/schema/orchestra"
import { SessionID } from "@opencode/schema/session-id"
import type { Session as SessionSchema } from "@opencode/schema/session"
import { AbsolutePath } from "./schema.js"
import { Bus } from "./bus.js"
import { KV } from "./kv.js"
import { Session } from "./session.js"
import { SessionEvent } from "@opencode/schema/session-event"
import type { SessionMessage } from "./session/message.js"

export const agent = Orchestra.agent
export const role = Orchestra.role
export const Access = Orchestra.Access
export type Access = Orchestra.Access
export const allows = Orchestra.allows
export const contains = Orchestra.contains
export const Project = Orchestra.Project
export type Project = Orchestra.Project
export const ProjectID = Orchestra.ProjectID
export type ProjectID = Orchestra.ProjectID
export const Template = Orchestra.Template
export type Template = Orchestra.Template
export const templates = Orchestra.templates

export class ProjectNotFoundError extends Schema.TaggedError<ProjectNotFoundError>()("Orchestra.ProjectNotFoundError", {
  projectID: Schema.String,
}) {}

export class TemplateNotFoundError extends Schema.TaggedError<TemplateNotFoundError>()(
  "Orchestra.TemplateNotFoundError",
  { template: Schema.String },
) {}

export class DispatchError extends Schema.TaggedError<DispatchError>()("Orchestra.DispatchError", {
  message: Schema.String,
}) {}

export class DirectoryError extends Schema.TaggedError<DirectoryError>()("Orchestra.DirectoryError", {
  directory: Schema.String,
}) {}

export interface Interface {
  readonly projects: () => Effect.Effect<ReadonlyArray<Project>>
  // With a template, also opens the main session and one session per team member.
  readonly create: (input: {
    name: string
    directory: string
    template?: string
  }) => Effect.Effect<Project, DirectoryError | TemplateNotFoundError>
  readonly update: (
    id: ProjectID,
    input: { name?: string; directory?: string },
  ) => Effect.Effect<Project, ProjectNotFoundError | DirectoryError>
  // Forgets the project; its sessions and its main session stay.
  readonly remove: (id: ProjectID) => Effect.Effect<void, ProjectNotFoundError>
  // The project's main session, created in the project's directory on first use.
  readonly main: (id: ProjectID) => Effect.Effect<SessionSchema.Info, ProjectNotFoundError>
  // Top-level sessions opened in the project's directory or below it, main session excluded.
  readonly sessions: (id: ProjectID) => Effect.Effect<ReadonlyArray<SessionSchema.Info>, ProjectNotFoundError>
  // The project whose main session this is, if any.
  readonly mainOf: (sessionID: SessionID) => Effect.Effect<Project | undefined>
  readonly access: (sessionID: SessionID) => Effect.Effect<Access>
  readonly accessMany: (sessionIDs: ReadonlyArray<SessionID>) => Effect.Effect<Record<string, Access>>
  readonly setAccess: (sessionID: SessionID, access: Access) => Effect.Effect<void>
  // Categories group a project's sessions ("Planning", "Build", ...); free text, empty clears it.
  readonly categories: (sessionIDs: ReadonlyArray<SessionID>) => Effect.Effect<Record<string, string>>
  readonly setCategory: (sessionID: SessionID, category: string) => Effect.Effect<void>
  // Sends a task from the project's main session to a team session. When that
  // session's run ends, its final answer is delivered back to the main session
  // as a <team-report> and wakes it, so the orchestrator never has to poll.
  readonly dispatch: (input: {
    project: Project
    sessionID: SessionID
    text: string
  }) => Effect.Effect<void, DispatchError>
  // When a dispatched task was sent, while its report is still outstanding.
  readonly pending: (sessionID: SessionID) => Effect.Effect<number | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Orchestra") {}

// Projects and access levels are host bookkeeping, not session history, so
// they live in KV. Session metadata would be inherited by every child and fork.
const PROJECT = "orchestra/project/"
const ACCESS = "orchestra/access/"
const CATEGORY = "orchestra/category/"
const TASK = "orchestra/task/"
// Reports longer than this are cut; the orchestrator reads the rest with the sessions tool.
const REPORT_LIMIT = 6000
// How many recent top-level sessions are scanned when listing a project.
const SCAN_LIMIT = 500
const decodeProject = Schema.decodeUnknownOption(Project)
const decodeAccess = Schema.decodeUnknownOption(Access)
// A task that is waiting for its report: which main session to deliver it to and when it was sent.
const Task = Schema.Struct({ main: SessionID, sent: Schema.Number })
const decodeTask = Schema.decodeUnknownOption(Task)

// Annotated: the layer calls Session operations whose types reach back through the
// instance graph that includes this node, so an inferred type would be circular.
const layer: Layer.Layer<Service, never, KV.Service | Session.Service | FSUtil.Service | Bus.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const sessions = yield* Session.Service
    const fs = yield* FSUtil.Service
    const bus = yield* Bus.Service

    const projects = Effect.fn("Orchestra.projects")(function* () {
      const result = yield* kv.scan({ prefix: PROJECT, limit: 1000 })
      return result.entries
        .flatMap((entry) => Option.toArray(decodeProject(entry.value)))
        .toSorted((a, b) => a.created - b.created)
    })

    const get = Effect.fnUntraced(function* (id: ProjectID) {
      const project = decodeProject(yield* kv.get(PROJECT + id))
      if (Option.isNone(project)) return yield* new ProjectNotFoundError({ projectID: id })
      return project.value
    })

    const save = (project: Project) =>
      kv.set(PROJECT + project.id, Schema.encodeSync(Project)(project)).pipe(Effect.as(project))

    // The operator types the path, so it is resolved here and must already be a directory.
    const directory = Effect.fnUntraced(function* (input: string) {
      const resolved = path.resolve(input.trim().replace(/^~(?=$|[\\/])/, process.env.HOME ?? "~"))
      if (!(yield* fs.isDir(resolved))) return yield* new DirectoryError({ directory: resolved })
      return resolved
    })

    const mainSession = Effect.fnUntraced(function* (project: Project) {
      const created = yield* sessions
        .create({
          location: { directory: AbsolutePath.make(project.directory) },
          title: `${project.name} · Orchestrator`,
          agent: Orchestra.agent,
        })
        .pipe(Effect.orDie)
      yield* save({ ...project, main: created.id })
      return created
    })

    const report = (sessionID: SessionID, state: "done" | "failed" | "stopped", detail?: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const task = decodeTask(yield* kv.get(TASK + sessionID))
        if (Option.isNone(task)) return
        yield* kv.remove(TASK + sessionID)
        const session = yield* sessions.get(sessionID).pipe(Effect.orElseSucceed(() => undefined))
        if (!session) return
        const recent = yield* sessions
          .messages({ sessionID, limit: 20, order: "desc" })
          .pipe(Effect.orElseSucceed((): SessionMessage.Info[] => []))
        const answer = recent.flatMap(finalText).at(0) ?? "(no text answer)"
        const body =
          answer.length > REPORT_LIMIT
            ? `${answer.slice(0, REPORT_LIMIT)}\n… (cut; read the session for the rest)`
            : answer
        const title = session.title ?? sessionID
        yield* sessions
          .synthetic({
            sessionID: task.value.main,
            description: `${title}: ${state}`,
            text: [
              `<team-report session="${sessionID}" title="${title}" role="${session.agent ?? "default"}" state="${state}">`,
              ...(detail ? [detail] : []),
              body,
              "</team-report>",
            ].join("\n"),
            metadata: { source: "team", sessionID, state },
          })
          .pipe(Effect.ignore)
      })

    // A shutdown interruption is resumed after restart, so its report waits for the real end.
    yield* bus
      .subscribe([SessionEvent.Execution.Succeeded, SessionEvent.Execution.Failed, SessionEvent.Execution.Interrupted])
      .pipe(
        Stream.runForEach((event) => {
          if (event.type === SessionEvent.Execution.Succeeded.type) return report(event.data.sessionID, "done")
          if (event.type === SessionEvent.Execution.Failed.type)
            return report(event.data.sessionID, "failed", `Run failed: ${event.data.error.message}`)
          if (event.data.reason === "shutdown") return Effect.void
          return report(event.data.sessionID, "stopped", `Run was interrupted (${event.data.reason}).`)
        }),
        Effect.forkScoped({ startImmediately: true }),
      )

    const access = Effect.fn("Orchestra.access")(function* (sessionID: SessionID) {
      return Option.getOrElse(decodeAccess(yield* kv.get(ACCESS + sessionID)), () => Orchestra.defaultAccess)
    })

    return Service.of({
      projects,
      create: Effect.fn("Orchestra.create")(function* (input) {
        const template = input.template ? templates.find((item) => item.id === input.template) : undefined
        if (input.template && !template) return yield* new TemplateNotFoundError({ template: input.template })
        const resolved = yield* directory(input.directory)
        const project = yield* save({
          id: ProjectID.create(),
          name: input.name.trim() || path.basename(resolved),
          directory: resolved,
          created: Date.now(),
        })
        if (!template) return project
        // Sessions list newest first, so opening the last member first shows the team in template order.
        yield* Effect.forEach(
          template.members.toReversed(),
          (member) =>
            sessions
              .create({
                location: { directory: AbsolutePath.make(resolved) },
                title: member.title,
                agent: member.agent,
              })
              .pipe(
                Effect.orDie,
                Effect.flatMap((session) =>
                  Effect.all([kv.set(ACCESS + session.id, "full"), kv.set(CATEGORY + session.id, member.category)]),
                ),
              ),
          { discard: true },
        )
        const main = yield* mainSession(project)
        return { ...project, main: main.id }
      }),
      update: Effect.fn("Orchestra.update")(function* (id, input) {
        const project = yield* get(id)
        return yield* save({
          ...project,
          name: input.name?.trim() || project.name,
          directory: input.directory === undefined ? project.directory : yield* directory(input.directory),
        })
      }),
      remove: Effect.fn("Orchestra.remove")(function* (id) {
        yield* get(id)
        yield* kv.remove(PROJECT + id)
      }),
      main: Effect.fn("Orchestra.main")(function* (id) {
        const project = yield* get(id)
        const existing = project.main
          ? yield* sessions.get(project.main).pipe(Effect.orElseSucceed(() => undefined))
          : undefined
        if (!existing) return yield* mainSession(project)
        if (existing.agent === Orchestra.agent) return existing
        // Main sessions created before the Orchestra agent existed adopt it on next open.
        yield* sessions.switchAgent({ sessionID: existing.id, agent: Orchestra.agent }).pipe(Effect.orDie)
        return { ...existing, agent: Orchestra.agent }
      }),
      sessions: Effect.fn("Orchestra.sessions")(function* (id) {
        const project = yield* get(id)
        const recent = (yield* sessions.list({ parentID: null, limit: SCAN_LIMIT, order: "desc" })).data
        return recent.filter(
          (session) => session.id !== project.main && Orchestra.contains(project.directory, session.location.directory),
        )
      }),
      mainOf: Effect.fn("Orchestra.mainOf")(function* (sessionID) {
        return (yield* projects()).find((project) => project.main === sessionID)
      }),
      access,
      accessMany: Effect.fn("Orchestra.accessMany")(function* (sessionIDs) {
        const levels = yield* Effect.forEach(sessionIDs, (id) => access(id).pipe(Effect.map((level) => [id, level])))
        return Object.fromEntries(levels)
      }),
      setAccess: Effect.fn("Orchestra.setAccess")(function* (sessionID, level) {
        yield* kv.set(ACCESS + sessionID, level)
      }),
      categories: Effect.fn("Orchestra.categories")(function* (sessionIDs) {
        const entries = yield* Effect.forEach(sessionIDs, (id) =>
          kv.get(CATEGORY + id).pipe(Effect.map((value) => (typeof value === "string" && value ? [[id, value]] : []))),
        )
        return Object.fromEntries(entries.flat())
      }),
      setCategory: Effect.fn("Orchestra.setCategory")(function* (sessionID, category) {
        const name = category.trim()
        if (!name) return yield* kv.remove(CATEGORY + sessionID)
        yield* kv.set(CATEGORY + sessionID, name)
      }),
      dispatch: Effect.fn("Orchestra.dispatch")(function* (input) {
        if (!input.project.main) return
        // Recorded before the prompt so a run that ends at once still finds its task.
        yield* kv.set(TASK + input.sessionID, Schema.encodeSync(Task)({ main: input.project.main, sent: Date.now() }))
        yield* sessions
          .prompt({
            sessionID: input.sessionID,
            text: input.text,
            metadata: { orchestra: { project: input.project.id, from: input.project.main } },
          })
          .pipe(
            Effect.tapError(() => kv.remove(TASK + input.sessionID)),
            Effect.mapError((error) => new DispatchError({ message: String(error) })),
          )
      }),
      pending: Effect.fn("Orchestra.pending")(function* (sessionID) {
        return Option.getOrUndefined(Option.map(decodeTask(yield* kv.get(TASK + sessionID)), (task) => task.sent))
      }),
    })
  }),
)

// The last assistant answer with text, newest first.
function finalText(message: SessionMessage.Info) {
  if (message.type !== "assistant") return []
  const text = message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n")
    .trim()
  return text ? [text] : []
}

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [KV.node, Session.node, FSUtil.node, Bus.node],
})
