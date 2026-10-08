export * as Orchestra from "./orchestra.js"

import { Context, Effect, Layer, Option, Schema } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Orchestra } from "@opencode/schema/orchestra"
import { Project } from "@opencode/schema/project"
import { SessionID } from "@opencode/schema/session-id"
import type { Session as SessionSchema } from "@opencode/schema/session"
import { AbsolutePath } from "./schema.js"
import { KV } from "./kv.js"
import { Session } from "./session.js"

export const Access = Orchestra.Access
export type Access = Orchestra.Access
export const allows = Orchestra.allows

export interface Interface {
  // The project's main session, created on first use in the project's directory.
  readonly main: (project: { readonly id: Project.ID; readonly canonical: string }) => Effect.Effect<SessionSchema.Info>
  // Whether this session is the main session of its own project.
  readonly isMain: (session: SessionSchema.Info) => Effect.Effect<boolean>
  readonly state: (projectID: Project.ID) => Effect.Effect<Orchestra.State>
  readonly access: (sessionID: SessionID) => Effect.Effect<Access>
  readonly setAccess: (sessionID: SessionID, access: Access) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Orchestra") {}

// Both the main-session pointer and the access levels are host bookkeeping, not
// session history, so they live in KV: session metadata would be inherited by
// every child and fork, spreading the main role to sessions that do not have it.
const mainKey = (projectID: Project.ID) => `orchestra/main/${projectID}`
const ACCESS = "orchestra/access/"
const decodeAccess = Schema.decodeUnknownOption(Access)
const decodeSessionID = Schema.decodeUnknownOption(SessionID)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const sessions = yield* Session.Service

    // A pointer to a deleted session counts as no main session.
    const existingMain = Effect.fnUntraced(function* (projectID: Project.ID) {
      const id = decodeSessionID(yield* kv.get(mainKey(projectID)))
      if (Option.isNone(id)) return undefined
      return yield* sessions.get(id.value).pipe(Effect.orElseSucceed(() => undefined))
    })

    const access = Effect.fn("Orchestra.access")(function* (sessionID: SessionID) {
      return Option.getOrElse(decodeAccess(yield* kv.get(ACCESS + sessionID)), () => Orchestra.defaultAccess)
    })

    return Service.of({
      main: Effect.fn("Orchestra.main")(function* (project) {
        const existing = yield* existingMain(project.id)
        if (existing) return existing
        const created = yield* sessions
          .create({ location: { directory: AbsolutePath.make(project.canonical) }, title: "Orchestra" })
          .pipe(Effect.orDie)
        yield* kv.set(mainKey(project.id), created.id)
        return created
      }),
      isMain: Effect.fn("Orchestra.isMain")(function* (session) {
        return (yield* kv.get(mainKey(session.projectID))) === session.id
      }),
      state: Effect.fn("Orchestra.state")(function* (projectID) {
        const main = yield* existingMain(projectID)
        const project = (yield* sessions.list({ project: projectID, parentID: null })).data
        const levels = yield* Effect.forEach(project, (session) =>
          kv.get(ACCESS + session.id).pipe(Effect.map((value) => [session.id, decodeAccess(value)] as const)),
        )
        return {
          ...(main ? { main: main.id } : {}),
          access: Object.fromEntries(
            levels.flatMap(([id, level]) => (Option.isSome(level) ? [[id, level.value]] : [])),
          ),
        }
      }),
      access,
      setAccess: Effect.fn("Orchestra.setAccess")(function* (sessionID, level) {
        yield* kv.set(ACCESS + sessionID, level)
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node, Session.node] })
