export * as Peer from "./peer.js"

import { Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Room } from "@opencode/schema/room"
import { SessionID } from "@opencode/schema/session-id"
import { KV } from "./kv.js"
import { Session } from "./session.js"

// Rooms on other computers that this computer joined, kept on the server so this
// computer's AI can work with the AI there: read its sessions, hand it a task, and get
// its answer back. The client registers each room it joins with the guest token the
// host issued; that token is the only credential, and it reaches only that room.
export const Link = Schema.Struct({
  url: Schema.String,
  roomID: Schema.String,
  token: Schema.String,
  name: Schema.String,
  guest: Schema.String,
}).annotate({ identifier: "Peer.Link" })
export type Link = typeof Link.Type

export class PeerError extends Schema.TaggedError<PeerError>()("Peer.Error", {
  message: Schema.String,
  // The host's HTTP status, when it answered at all.
  status: Schema.Number.pipe(Schema.optional),
}) {}

const RemoteSession = Schema.Struct({ id: Schema.String, title: Schema.String.pipe(Schema.optional) })
export type RemoteSession = typeof RemoteSession.Type

const Joined = Schema.Struct({
  role: Room.Role,
  room: Schema.Struct({ name: Schema.String, directory: Schema.String.pipe(Schema.optional) }),
  session: RemoteSession,
})
const Sessions = Schema.Struct({ data: Schema.Array(RemoteSession) })
const Chat = Schema.Struct({ data: Schema.Array(Room.Message), running: Schema.Boolean })
const Created = Schema.Struct({ data: RemoteSession })

export interface Interface {
  readonly links: () => Effect.Effect<ReadonlyArray<Link>>
  readonly saveLink: (link: Link) => Effect.Effect<void>
  readonly removeLink: (input: { url: string; roomID: string }) => Effect.Effect<void>
  // What this guest may do in the room, and the room's own session.
  readonly joined: (link: Link) => Effect.Effect<typeof Joined.Type, PeerError>
  readonly sessions: (link: Link) => Effect.Effect<ReadonlyArray<RemoteSession>, PeerError>
  readonly chat: (link: Link, sessionID?: string) => Effect.Effect<typeof Chat.Type, PeerError>
  readonly create: (link: Link, title?: string) => Effect.Effect<RemoteSession, PeerError>
  // Posts a message from this computer's AI into a session of the room. When the AI
  // there has answered and stopped, its answer is delivered back into `from` as a
  // <peer-report> and wakes it, so the sending AI never has to poll.
  readonly send: (input: {
    link: Link
    sessionID?: string
    text: string
    from: SessionID
  }) => Effect.Effect<RemoteSession, PeerError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Peer") {}

const LINK = "peer/link/"
const TASK = "peer/task/"
// A peer that has not answered after this long is reported as silent.
const TASK_TTL = Duration.hours(2)
const POLL = Duration.seconds(3)
const REPORT_LIMIT = 6000
const REQUEST_TIMEOUT = Duration.seconds(10)
// Statuses that will not change by asking again: the guest was removed or the room closed.
const GONE = new Set([401, 403, 404])

const Task = Schema.Struct({
  from: SessionID,
  url: Schema.String,
  roomID: Schema.String,
  sessionID: Schema.String,
  name: Schema.String,
  // When it was sent, by this computer's clock, for giving up on a silent peer.
  sent: Schema.Number,
  // The peer's answers that were already there; the first other one answers this message.
  // IDs rather than times, because the two computers' clocks need not agree.
  before: Schema.Array(Schema.String),
})
type Task = typeof Task.Type

const decodeLink = Schema.decodeUnknownOption(Link)
const decodeTask = Schema.decodeUnknownOption(Task)

export function linkKey(input: { url: string; roomID: string }) {
  return `${input.url}#${input.roomID}`
}

const layer: Layer.Layer<Service, never, KV.Service | Session.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const sessions = yield* Session.Service

    const scan = <A>(prefix: string, decode: (value: unknown) => Option.Option<A>) =>
      kv
        .scan({ prefix, limit: 1000 })
        .pipe(Effect.map((result) => result.entries.flatMap((entry) => Option.toArray(decode(entry.value)))))

    // The guest routes of the host's server, with the room token as the only credential.
    const call = <S extends Schema.Top>(
      link: Pick<Link, "url" | "token">,
      path: string,
      schema: S,
      init: { method?: string; body?: unknown } = {},
    ) =>
      Effect.tryPromise({
        try: async (signal) => {
          const response = await fetch(new URL(path, link.url), {
            method: init.method ?? "GET",
            headers: { authorization: `Bearer ${link.token}`, "content-type": "application/json" },
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
            signal,
          })
          const text = await response.text()
          if (!response.ok)
            throw new PeerError({
              message: failure(text) ?? `The host answered ${response.status}`,
              status: response.status,
            })
          return text ? JSON.parse(text) : undefined
        },
        catch: (error) =>
          error instanceof PeerError
            ? error
            : new PeerError({ message: error instanceof Error ? error.message : String(error) }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: REQUEST_TIMEOUT,
          orElse: () => Effect.fail(new PeerError({ message: "The host did not answer in time" })),
        }),
        Effect.flatMap((value) =>
          Schema.decodeUnknownEffect(schema)(value).pipe(
            Effect.mapError(() => new PeerError({ message: "The host answered in an unexpected shape" })),
          ),
        ),
      )

    const room = (link: Link) => `/api/room/${encodeURIComponent(link.roomID)}/guest`
    const query = (sessionID?: string) => (sessionID ? `?sessionID=${encodeURIComponent(sessionID)}` : "")

    const chat = (link: Link, sessionID?: string) => call(link, `${room(link)}/message${query(sessionID)}`, Chat)

    // A report is due once the peer has answered after the message and is no longer running.
    const check = Effect.fnUntraced(function* (key: string, task: Task) {
      const stored = Option.getOrUndefined(decodeLink(yield* kv.get(LINK + linkKey(task))))
      const expired = Date.now() - task.sent > Duration.toMillis(TASK_TTL)
      const state = stored
        ? yield* chat(stored, task.sessionID).pipe(
            Effect.map((result) => ({ ok: true as const, result })),
            Effect.catch((error) =>
              Effect.succeed({ ok: false as const, error: error.message, gone: GONE.has(error.status ?? 0) }),
            ),
          )
        : { ok: false as const, error: "This computer left the room", gone: true }
      if (state.ok) {
        const answer = state.result.data.filter(
          (message) => message.role === "assistant" && !task.before.includes(message.id),
        )
        if ((state.result.running || answer.length === 0) && !expired) return
        return yield* deliver(key, task, answer.at(-1)?.text ?? "(no answer before the wait ran out)", "done")
      }
      // A host that is down for a moment gets more time; a closed room or a removed guest is reported now.
      if (!expired && !state.gone) return
      yield* deliver(key, task, state.error, "failed")
    })

    const deliver = Effect.fnUntraced(function* (key: string, task: Task, text: string, state: "done" | "failed") {
      yield* kv.remove(key)
      const body =
        text.length > REPORT_LIMIT ? `${text.slice(0, REPORT_LIMIT)}\n… (cut; read the session for the rest)` : text
      yield* sessions
        .synthetic({
          sessionID: task.from,
          description: `${task.name}: ${state}`,
          text: [
            `<peer-report room="${task.name}" roomID="${task.roomID}" session="${task.sessionID}" state="${state}">`,
            body,
            "</peer-report>",
          ].join("\n"),
          metadata: { source: "peer", roomID: task.roomID, sessionID: task.sessionID, state },
        })
        .pipe(Effect.ignore)
    })

    yield* Effect.gen(function* () {
      const result = yield* kv.scan({ prefix: TASK, limit: 1000 })
      yield* Effect.forEach(result.entries, (entry) =>
        Option.match(decodeTask(entry.value), {
          onNone: () => kv.remove(entry.key),
          onSome: (task) => check(entry.key, task),
        }),
      )
    }).pipe(Effect.repeat(Schedule.spaced(POLL)), Effect.forkScoped({ startImmediately: true }))

    return Service.of({
      links: () =>
        scan(LINK, decodeLink).pipe(Effect.map((links) => links.toSorted((a, b) => a.name.localeCompare(b.name)))),
      saveLink: (link) => kv.set(LINK + linkKey(link), Schema.encodeSync(Link)(link)),
      removeLink: (input) => kv.remove(LINK + linkKey(input)),
      joined: (link) => call(link, room(link), Joined),
      sessions: (link) => call(link, `${room(link)}/session`, Sessions).pipe(Effect.map((result) => result.data)),
      chat,
      create: (link, title) =>
        call(link, `${room(link)}/session`, Created, { method: "POST", body: { title } }).pipe(
          Effect.map((result) => result.data),
        ),
      send: Effect.fn("Peer.send")(function* (input) {
        const joined = yield* call(input.link, `${room(input.link)}${query(input.sessionID)}`, Joined)
        const before = (yield* chat(input.link, joined.session.id)).data
          .filter((message) => message.role === "assistant")
          .map((message) => message.id)
        yield* call(input.link, `${room(input.link)}/prompt`, Schema.Unknown, {
          method: "POST",
          body: { text: input.text, sessionID: joined.session.id, ai: true },
        })
        const task: Task = {
          from: input.from,
          url: input.link.url,
          roomID: input.link.roomID,
          sessionID: joined.session.id,
          name: input.link.name,
          sent: Date.now(),
          before,
        }
        yield* kv.set(`${TASK}${input.from}/${linkKey(task)}/${task.sessionID}`, Schema.encodeSync(Task)(task))
        return joined.session
      }),
    })
  }),
)

// The host's errors carry a readable message; anything else falls back to the status.
function failure(text: string) {
  return Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ message: Schema.String })))(text),
  )?.message
}

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node, Session.node] })
