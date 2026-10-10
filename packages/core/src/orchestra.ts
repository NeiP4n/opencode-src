export * as Orchestra from "./orchestra.js"

import { Context, Effect, Layer, Option, PubSub, Schema, Stream } from "effect"
import path from "node:path"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Orchestra } from "@opencode/schema/orchestra"
import { Model } from "@opencode/schema/model"
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
export const ownerOf = Orchestra.ownerOf
export const Project = Orchestra.Project
export type Project = Orchestra.Project
export const ProjectID = Orchestra.ProjectID
export type ProjectID = Orchestra.ProjectID
export const Template = Orchestra.Template
export type Template = Orchestra.Template
export const TemplateSpec = Orchestra.TemplateSpec
export type TemplateSpec = Orchestra.TemplateSpec
export const Role = Orchestra.Role
export type Role = Orchestra.Role
export const RoleSpec = Orchestra.RoleSpec
export type RoleSpec = Orchestra.RoleSpec

export class ProjectNotFoundError extends Schema.TaggedError<ProjectNotFoundError>()("Orchestra.ProjectNotFoundError", {
  projectID: Schema.String,
}) {}

export class TemplateNotFoundError extends Schema.TaggedError<TemplateNotFoundError>()(
  "Orchestra.TemplateNotFoundError",
  { template: Schema.String },
) {}

// A role or team the operator saved or removed that cannot be: an empty name,
// an unknown role, a role a team still uses, a malformed model.
export class TeamError extends Schema.TaggedError<TeamError>()("Orchestra.TeamError", {
  message: Schema.String,
  field: Schema.String.pipe(Schema.optional),
}) {}

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
  // Top-level sessions the project owns (see ownerOf), every project's main session excluded.
  readonly sessions: (id: ProjectID) => Effect.Effect<ReadonlyArray<SessionSchema.Info>, ProjectNotFoundError>
  // Whether a session belongs to the project, so the orchestrator never reaches another project's team.
  readonly owns: (project: Project, session: SessionSchema.Info) => Effect.Effect<boolean>
  // Which project opened each session that a project opened, by session ID.
  readonly owners: () => Effect.Effect<Record<string, ProjectID>>
  // Records that the project opened this session, so it stays with it in a shared directory.
  readonly claim: (sessionID: SessionID, projectID: ProjectID) => Effect.Effect<void, ProjectNotFoundError>
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
  // Team roles and templates: the built-in ones, with the operator's edits
  // applied, followed by the operator's own in the order they were created.
  readonly roles: () => Effect.Effect<ReadonlyArray<Role>>
  // Without an id creates a custom role; with one replaces that role.
  readonly saveRole: (id: string | undefined, spec: RoleSpec) => Effect.Effect<Role, TeamError>
  // Deletes a custom role, or restores a built-in one to its default.
  readonly removeRole: (id: string) => Effect.Effect<void, TeamError>
  readonly templates: () => Effect.Effect<ReadonlyArray<Template>>
  readonly saveTemplate: (id: string | undefined, spec: TemplateSpec) => Effect.Effect<Template, TeamError>
  readonly removeTemplate: (id: string) => Effect.Effect<void, TeamError>
  // Emits after every saved or removed role or template, so agents can be rebuilt.
  readonly changes: Stream.Stream<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Orchestra") {}

// Projects and access levels are host bookkeeping, not session history, so
// they live in KV. Session metadata would be inherited by every child and fork.
const PROJECT = "orchestra/project/"
const ACCESS = "orchestra/access/"
const CATEGORY = "orchestra/category/"
const TASK = "orchestra/task/"
const ROLE = "orchestra/role/"
const TEMPLATE = "orchestra/template/"
// The project that opened a session. Without it, every project in one directory would share one team.
const OWNER = "orchestra/owner/"
// Reports longer than this are cut; the orchestrator reads the rest with the sessions tool.
const REPORT_LIMIT = 6000
// How many recent top-level sessions are scanned when listing a project.
const SCAN_LIMIT = 500
const decodeProject = Schema.decodeUnknownOption(Project)
const decodeAccess = Schema.decodeUnknownOption(Access)
const decodeProjectID = Schema.decodeUnknownOption(ProjectID)
// A task that is waiting for its report: which main session to deliver it to and when it was sent.
const Task = Schema.Struct({ main: SessionID, sent: Schema.Number })
const decodeTask = Schema.decodeUnknownOption(Task)
// Saved roles and templates keep when they were first created, so custom ones list in creation order.
const StoredRole = Schema.Struct({ ...Orchestra.RoleSpec.fields, created: Schema.Number })
const StoredTemplate = Schema.Struct({ ...Orchestra.TemplateSpec.fields, created: Schema.Number })
const decodeRole = Schema.decodeUnknownOption(StoredRole)
const decodeTemplate = Schema.decodeUnknownOption(StoredTemplate)
const decodeCreated = Schema.decodeUnknownOption(Schema.Struct({ created: Schema.Number }))

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

    const owners = Effect.fn("Orchestra.owners")(function* () {
      const read = (after?: string): Effect.Effect<KV.Entry[]> =>
        kv
          .scan({ prefix: OWNER, after, limit: 1000 })
          .pipe(
            Effect.flatMap((result) =>
              result.next
                ? read(result.next).pipe(Effect.map((rest) => [...result.entries, ...rest]))
                : Effect.succeed([...result.entries]),
            ),
          )
      return Object.fromEntries(
        (yield* read()).flatMap((entry) =>
          Option.toArray(decodeProjectID(entry.value)).map((id) => [entry.key.slice(OWNER.length), id]),
        ),
      )
    })

    const owns = Effect.fn("Orchestra.owns")(function* (project: Project, session: SessionSchema.Info) {
      const claimed = Option.getOrUndefined(decodeProjectID(yield* kv.get(OWNER + session.id)))
      return Orchestra.ownerOf(yield* projects(), session.location.directory, claimed)?.id === project.id
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
      const id = SessionID.create()
      yield* kv.set(OWNER + id, project.id)
      const created = yield* sessions
        .create({
          id,
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

    const changed = yield* PubSub.sliding<void>(16)

    const stored = Effect.fnUntraced(function* <A extends { created: number }>(
      prefix: string,
      decode: (value: unknown) => Option.Option<A>,
    ) {
      const result = yield* kv.scan({ prefix, limit: 1000 })
      return result.entries.flatMap((entry) =>
        Option.toArray(decode(entry.value)).map((value) => ({ ...value, id: entry.key.slice(prefix.length) })),
      )
    })

    const roles = Effect.fn("Orchestra.roles")(function* () {
      const saved = yield* stored(ROLE, decodeRole)
      return merge(Orchestra.roles, saved).map(({ created: _, ...item }) => ({
        ...item,
        agent: Orchestra.role(item.id),
      }))
    })

    const templates = Effect.fn("Orchestra.templates")(function* () {
      return merge(Orchestra.templates, yield* stored(TEMPLATE, decodeTemplate)).map(({ created: _, ...item }) => item)
    })

    // The key to save under — the given id, or a new one made from the name — and when it was first saved.
    const slot = Effect.fnUntraced(function* (
      prefix: string,
      id: string | undefined,
      taken: ReadonlyArray<{ id: string }>,
      name: string,
    ) {
      if (id && !taken.some((item) => item.id === id)) return yield* new TeamError({ message: `Unknown id: ${id}` })
      const key = id ?? freeID(name, taken)
      const created = Option.match(decodeCreated(yield* kv.get(prefix + key)), {
        onNone: () => Date.now(),
        onSome: (value) => value.created,
      })
      return { key, created }
    })

    const access = Effect.fn("Orchestra.access")(function* (sessionID: SessionID) {
      return Option.getOrElse(decodeAccess(yield* kv.get(ACCESS + sessionID)), () => Orchestra.defaultAccess)
    })

    return Service.of({
      projects,
      create: Effect.fn("Orchestra.create")(function* (input) {
        const template = input.template ? (yield* templates()).find((item) => item.id === input.template) : undefined
        if (input.template && !template) return yield* new TemplateNotFoundError({ template: input.template })
        const resolved = yield* directory(input.directory)
        const project = yield* save({
          id: ProjectID.create(),
          name: input.name.trim() || path.basename(resolved),
          directory: resolved,
          created: Date.now(),
        })
        if (!template) return project
        const team = yield* roles()
        // Sessions list newest first, so opening the last member first shows the team in template order.
        yield* Effect.forEach(
          template.members.toReversed(),
          (member) => {
            // Claimed before it exists, so nothing ever lists the session under another project.
            const id = SessionID.create()
            return kv.set(OWNER + id, project.id).pipe(
              Effect.andThen(
                sessions.create({
                  id,
                  location: { directory: AbsolutePath.make(resolved) },
                  title: member.title,
                  agent: member.agent,
                  model: modelOf(team.find((role) => role.agent === member.agent)),
                }),
              ),
              Effect.orDie,
              Effect.andThen(Effect.all([kv.set(ACCESS + id, "full"), kv.set(CATEGORY + id, member.category)])),
            )
          },
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
        // Its sessions go back to whichever project contains their directory.
        const claims = yield* owners()
        yield* Effect.forEach(
          Object.keys(claims).filter((sessionID) => claims[sessionID] === id),
          (sessionID) => kv.remove(OWNER + sessionID),
          { discard: true },
        )
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
        const all = yield* projects()
        const claims = yield* owners()
        const recent = (yield* sessions.list({ parentID: null, limit: SCAN_LIMIT, order: "desc" })).data
        // Another project in the same directory has its own orchestrator; it never joins this team.
        return recent.filter(
          (session) =>
            session.id !== project.main &&
            session.agent !== Orchestra.agent &&
            Orchestra.ownerOf(all, session.location.directory, claims[session.id])?.id === project.id,
        )
      }),
      owns,
      owners,
      claim: Effect.fn("Orchestra.claim")(function* (sessionID, projectID) {
        yield* get(projectID)
        yield* kv.set(OWNER + sessionID, projectID)
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
      roles,
      saveRole: Effect.fn("Orchestra.saveRole")(function* (id, input) {
        const spec = yield* requireRole(input)
        const target = yield* slot(ROLE, id, yield* roles(), spec.name)
        yield* kv.set(ROLE + target.key, Schema.encodeSync(StoredRole)({ ...spec, created: target.created }))
        yield* PubSub.publish(changed, undefined)
        return {
          ...spec,
          id: target.key,
          agent: Orchestra.role(target.key),
          origin: originOf(Orchestra.roles, target.key),
        }
      }),
      removeRole: Effect.fn("Orchestra.removeRole")(function* (id) {
        const role = (yield* roles()).find((item) => item.id === id)
        if (!role) return yield* new TeamError({ message: `Unknown role: ${id}` })
        // A built-in role is only reset, so it stays available to every team.
        if (role.origin === "custom") {
          const users = (yield* templates()).filter((template) =>
            template.members.some((member) => member.agent === role.agent),
          )
          if (users.length > 0)
            return yield* new TeamError({
              message: `${role.name} is in ${users.map((template) => template.name).join(", ")}; remove it there first`,
            })
        }
        yield* kv.remove(ROLE + id)
        yield* PubSub.publish(changed, undefined)
      }),
      templates,
      saveTemplate: Effect.fn("Orchestra.saveTemplate")(function* (id, input) {
        const spec = yield* requireTemplate(input, yield* roles())
        const target = yield* slot(TEMPLATE, id, yield* templates(), spec.name)
        yield* kv.set(TEMPLATE + target.key, Schema.encodeSync(StoredTemplate)({ ...spec, created: target.created }))
        yield* PubSub.publish(changed, undefined)
        return { ...spec, id: target.key, origin: originOf(Orchestra.templates, target.key) }
      }),
      removeTemplate: Effect.fn("Orchestra.removeTemplate")(function* (id) {
        if (!(yield* templates()).some((item) => item.id === id))
          return yield* new TeamError({ message: `Unknown team: ${id}` })
        yield* kv.remove(TEMPLATE + id)
        yield* PubSub.publish(changed, undefined)
      }),
      changes: Stream.fromPubSub(changed),
    })
  }),
)

// Built-ins in their own order with saved edits applied, then the saved custom items oldest first.
function merge<A extends { id: string }, B extends { id: string; created: number }>(
  builtin: readonly A[],
  saved: readonly B[],
) {
  const edits = new Map(saved.map((item) => [item.id, item]))
  return [
    ...builtin.map((item) => {
      const edit = edits.get(item.id)
      return edit ? { ...edit, origin: "edited" as const } : { ...item, created: 0, origin: "builtin" as const }
    }),
    ...saved
      .filter((item) => !builtin.some((base) => base.id === item.id))
      .toSorted((a, b) => a.created - b.created)
      .map((item) => ({ ...item, origin: "custom" as const })),
  ]
}

// The runner only reads a session's own model, so a role's model is set on the
// sessions opened for it; the TUI applies agent models only to prompts it sends.
export function modelOf(role: Role | undefined) {
  return role?.model ? Model.Ref.parse(role.model) : undefined
}

function originOf(builtin: readonly { id: string }[], id: string): Orchestra.Origin {
  return builtin.some((item) => item.id === id) ? "edited" : "custom"
}

// Ids are lowercase words joined by "-", so role agents read as team-code-auditor.
function freeID(name: string, taken: ReadonlyArray<{ id: string }>) {
  const base =
    name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "custom"
  const used = new Set(taken.map((item) => item.id))
  const free = (n: number): string => (used.has(`${base}-${n}`) ? free(n + 1) : `${base}-${n}`)
  return used.has(base) ? free(2) : base
}

const requireRole = Effect.fnUntraced(function* (input: RoleSpec) {
  const name = input.name.trim()
  if (!name) return yield* new TeamError({ message: "Enter the role's name", field: "name" })
  const model = input.model?.trim()
  // Parsed the way the agent plugin parses it, so a saved model never breaks agent loading.
  if (model)
    yield* Effect.try({
      try: () => Model.Ref.parse(model),
      catch: () => new TeamError({ message: "Model must look like provider/model", field: "model" }),
    })
  return {
    name,
    description: input.description.trim(),
    rules: input.rules.trim(),
    category: input.category.trim() || "Team",
    readOnly: input.readOnly,
    ...(model ? { model } : {}),
  }
})

function requireTemplate(input: TemplateSpec, roles: ReadonlyArray<Role>) {
  const name = input.name.trim()
  if (!name) return Effect.fail(new TeamError({ message: "Enter the team's name", field: "name" }))
  if (input.members.length === 0)
    return Effect.fail(new TeamError({ message: "Add at least one member", field: "members" }))
  const unknown = input.members.find((member) => !roles.some((role) => role.agent === member.agent))
  if (unknown) return Effect.fail(new TeamError({ message: `Unknown role: ${unknown.agent}`, field: "members" }))
  return Effect.succeed({
    name,
    description: input.description.trim(),
    members: input.members.map((member) => {
      const role = roles.find((item) => item.agent === member.agent)
      return {
        agent: member.agent,
        title: member.title.trim() || role?.name || member.agent,
        category: member.category.trim() || role?.category || "Team",
      }
    }),
  })
}

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
