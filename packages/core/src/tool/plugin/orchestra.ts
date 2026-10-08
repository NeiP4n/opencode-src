export * as OrchestraTool from "./orchestra.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Effect, Schema } from "effect"
import { Orchestra } from "../../orchestra.js"
import { Session } from "../../session.js"
import { SessionSchema } from "../../session/schema.js"
import type { SessionMessage } from "../../session/message.js"

export const name = "sessions"

const description = [
  "Manage the other sessions of this project. Only the project's main session (the orchestra) has this tool.",
  "Actions: list shows each session with its status and the access the operator granted;",
  "read returns the latest messages of a session; send posts a message into a session, which starts its model;",
  "create opens a new session in the project and can give it a first task; stop interrupts a running session.",
  "Access per session is hidden < read < write < full: read allows list and read, write adds send, full adds stop.",
  "Sessions you create get full access. Prefer sending clear, self-contained tasks and reading results back over doing the work here.",
].join("\n")

export const Input = Schema.Struct({
  action: Schema.Literals(["list", "read", "send", "create", "stop"]),
  sessionID: Schema.optionalKey(SessionSchema.ID).annotate({ description: "Target session for read, send and stop" }),
  text: Schema.optionalKey(Schema.String).annotate({
    description: "Message for send, or the first task for create",
  }),
  title: Schema.optionalKey(Schema.String).annotate({ description: "Title of the session to create" }),
  limit: Schema.optionalKey(Schema.Int).annotate({ description: "How many recent messages read returns (default 10)" }),
})

export const Output = Schema.Struct({
  output: Schema.String,
  sessionID: Schema.optionalKey(SessionSchema.ID),
})

export const Plugin = {
  id: "opencode.tool.orchestra",
  effect: Effect.fn("OrchestraTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const orchestra = yield* Orchestra.Service

    // Every action runs on behalf of the project's main session and only
    // reaches sessions of the same project at the level the operator granted.
    const target = Effect.fnUntraced(function* (
      main: SessionSchema.Info,
      sessionID: SessionSchema.ID | undefined,
      required: Orchestra.Access,
    ) {
      if (!sessionID) return yield* new ToolFailure({ message: "Pass the sessionID of the target session" })
      const session = yield* sessions
        .get(sessionID)
        .pipe(Effect.mapError(() => new ToolFailure({ message: `Session not found: ${sessionID}` })))
      const access = yield* orchestra.access(session.id)
      if (session.projectID !== main.projectID || session.id === main.id || access === "hidden")
        return yield* new ToolFailure({ message: `Session not found: ${sessionID}` })
      if (!Orchestra.allows(access, required))
        return yield* new ToolFailure({
          message: `Access to ${sessionID} is "${access}"; this action needs "${required}". The operator can raise it in the project panel.`,
        })
      return session
    })

    const list = Effect.fnUntraced(function* (main: SessionSchema.Info) {
      const project = (yield* sessions.list({ project: main.projectID, parentID: null })).data
      const active = yield* sessions.active
      const rows = yield* Effect.forEach(
        project.filter((session) => session.id !== main.id),
        (session) => orchestra.access(session.id).pipe(Effect.map((access) => ({ session, access }))),
      )
      const visible = rows.filter((row) => row.access !== "hidden")
      if (visible.length === 0) return "No other sessions in this project."
      return visible
        .map(
          (row) =>
            `${row.session.id}  ${row.session.title ?? "(untitled)"}  [${active.has(row.session.id) ? "running" : "idle"}, access: ${row.access}]`,
        )
        .join("\n")
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const main = yield* sessions
                .get(context.sessionID)
                .pipe(Effect.mapError(() => new ToolFailure({ message: `Session not found: ${context.sessionID}` })))
              if (!(yield* orchestra.isMain(main)))
                return yield* new ToolFailure({ message: "Only the project's main session can manage sessions" })

              switch (input.action) {
                case "list":
                  return { output: yield* list(main) }
                case "read": {
                  const session = yield* target(main, input.sessionID, "read")
                  const messages = yield* sessions
                    .messages({ sessionID: session.id, limit: input.limit ?? 10, order: "desc" })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: "Could not read the session", error })))
                  const text = messages.toReversed().flatMap(render).join("\n\n")
                  return { sessionID: session.id, output: text || "The session has no messages yet." }
                }
                case "send": {
                  const session = yield* target(main, input.sessionID, "write")
                  if (!input.text?.trim()) return yield* new ToolFailure({ message: "Pass the message as text" })
                  yield* sessions
                    .prompt({ sessionID: session.id, text: input.text, metadata: { orchestra: { from: main.id } } })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: "Could not send the message", error })))
                  return {
                    sessionID: session.id,
                    output: `Sent to ${session.title ?? session.id}; its model is working on it.`,
                  }
                }
                case "create": {
                  const created = yield* sessions
                    .create({ location: main.location, title: input.title?.trim() || undefined })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: "Could not create a session", error })))
                  yield* orchestra.setAccess(created.id, "full")
                  if (input.text?.trim())
                    yield* sessions
                      .prompt({ sessionID: created.id, text: input.text, metadata: { orchestra: { from: main.id } } })
                      .pipe(
                        Effect.mapError((error) => new ToolFailure({ message: "Could not start the session", error })),
                      )
                  return {
                    sessionID: created.id,
                    output: `Created ${created.id}${input.text?.trim() ? " and gave it the task" : ""}.`,
                  }
                }
                case "stop": {
                  const session = yield* target(main, input.sessionID, "full")
                  const stopped = yield* sessions.interrupt(session.id)
                  return { sessionID: session.id, output: stopped ? "Stopped." : "The session was not running." }
                }
              }
            }).pipe(
              Effect.map((output) => ({
                output,
                content: output.output,
                metadata: output.sessionID ? { sessionID: output.sessionID } : {},
              })),
            ),
        }),
      )
      .pipe(Effect.orDie)

    // The tool only exists for the project's main session; every other session
    // never sees it, so it cannot be prompted into managing its siblings.
    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        if (!event.tools[name]) return
        const session = yield* sessions.get(event.sessionID).pipe(Effect.option)
        const main = session._tag === "Some" && (yield* orchestra.isMain(session.value))
        if (!main) delete event.tools[name]
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}

function render(message: SessionMessage.Info) {
  if (message.type === "user") return [`[user] ${message.text}`]
  if (message.type === "synthetic") return [`[note] ${message.text}`]
  if (message.type !== "assistant") return []
  const text = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
  const tools = message.content.flatMap((part) => (part.type === "tool" ? [part.name] : []))
  return [`[assistant] ${text}${tools.length > 0 ? `\n(tools: ${tools.join(", ")})` : ""}`]
}
