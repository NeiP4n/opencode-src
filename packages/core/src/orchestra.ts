export * as Orchestra from "./orchestra.js"

import { Context, Effect, Layer, Option, Schema } from "effect"
import path from "node:path"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Orchestra } from "@opencode/schema/orchestra"
import { SessionID } from "@opencode/schema/session-id"
import type { Session as SessionSchema } from "@opencode/schema/session"
import { AbsolutePath } from "./schema.js"
import { KV } from "./kv.js"
import { Session } from "./session.js"

export const agent = Orchestra.agent
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
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Orchestra") {}

// Projects and access levels are host bookkeeping, not session history, so
// they live in KV. Session metadata would be inherited by every child and fork.
const PROJECT = "orchestra/project/"
const ACCESS = "orchestra/access/"
// How many recent top-level sessions are scanned when listing a project.
const SCAN_LIMIT = 500
const decodeProject = Schema.decodeUnknownOption(Project)
const decodeAccess = Schema.decodeUnknownOption(Access)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const sessions = yield* Session.Service
    const fs = yield* FSUtil.Service

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
          title: `${project.name} · Orchestra`,
          agent: Orchestra.agent,
        })
        .pipe(Effect.orDie)
      yield* save({ ...project, main: created.id })
      return created
    })

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
                Effect.flatMap((session) => kv.set(ACCESS + session.id, "full")),
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
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node, Session.node, FSUtil.node] })
