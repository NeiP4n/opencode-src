export * as OrchestraTool from "./orchestra.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Effect, Schema } from "effect"
import { Orchestra } from "../../orchestra.js"
import { AbsolutePath } from "../../schema.js"
import { Session } from "../../session.js"
import { SessionSchema } from "../../session/schema.js"
import type { SessionMessage } from "../../session/message.js"

export const name = "sessions"

const description = [
  "Run this project's AI team: the other sessions of the project, each a separate chat with its own role.",
  "Only the project's main session (the orchestrator) has this tool.",
  "Actions: list shows the team by category with each session's role, status, access and whether a report is outstanding;",
  "send gives a session a task and starts its model; its final answer comes back to you automatically as a <team-report> message, so end your turn instead of waiting;",
  "read returns a session's latest messages; create opens a new team session with a role and a category and can give it a first task; stop interrupts a running session.",
  "Access per session is hidden < read < write < full: read allows list and read, write adds send, full adds stop. Sessions you create get full access.",
].join("\n")

export const Input = Schema.Struct({
  action: Schema.Literals(["list", "read", "send", "create", "stop"]),
  sessionID: Schema.optionalKey(SessionSchema.ID).annotate({ description: "Target session for read, send and stop" }),
  text: Schema.optionalKey(Schema.String).annotate({
    description: "Message for send, or the first task for create",
  }),
  title: Schema.optionalKey(Schema.String).annotate({ description: "Title of the session to create" }),
  role: Schema.optionalKey(Schema.String).annotate({
    description: "Role id of the session to create, e.g. architect, developer, tester, reviewer",
  }),
  category: Schema.optionalKey(Schema.String).annotate({
    description: "Category of the session to create, e.g. Planning, Build or Quality",
  }),
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
      project: Orchestra.Project,
      sessionID: SessionSchema.ID | undefined,
      required: Orchestra.Access,
    ) {
      if (!sessionID) return yield* new ToolFailure({ message: "Pass the sessionID of the target session" })
      const session = yield* sessions
        .get(sessionID)
        .pipe(Effect.mapError(() => new ToolFailure({ message: `Session not found: ${sessionID}` })))
      const access = yield* orchestra.access(session.id)
      if (
        session.id === project.main ||
        access === "hidden" ||
        !Orchestra.contains(project.directory, session.location.directory)
      )
        return yield* new ToolFailure({ message: `Session not found: ${sessionID}` })
      if (!Orchestra.allows(access, required))
        return yield* new ToolFailure({
          message: `Access to ${sessionID} is "${access}"; this action needs "${required}". The operator can raise it in the project panel.`,
        })
      return session
    })

    // The team as the orchestrator may see it, grouped by category in first-seen order.
    const team = Effect.fnUntraced(function* (project: Orchestra.Project) {
      const members = yield* orchestra.sessions(project.id).pipe(Effect.orDie)
      const access = yield* orchestra.accessMany(members.map((session) => session.id))
      const categories = yield* orchestra.categories(members.map((session) => session.id))
      return members
        .filter((session) => access[session.id] !== "hidden")
        .map((session) => ({ session, access: access[session.id], category: categories[session.id] ?? "Other" }))
    })

    const grouped = <T extends { category: string }>(rows: ReadonlyArray<T>, line: (row: T) => string) =>
      [...new Set(rows.map((row) => row.category))]
        .map((category) =>
          [`${category}:`, ...rows.filter((row) => row.category === category).map((row) => `- ${line(row)}`)].join(
            "\n",
          ),
        )
        .join("\n")

    const list = Effect.fnUntraced(function* (project: Orchestra.Project) {
      const rows = yield* team(project)
      if (rows.length === 0) return "No team sessions in this project yet. Create one with action create."
      const active = yield* sessions.active
      const pending = yield* Effect.forEach(rows, (row) => orchestra.pending(row.session.id))
      const now = Date.now()
      return grouped(
        rows.map((row, index) => ({ ...row, sent: pending[index] })),
        (row) =>
          [
            `${row.session.title ?? "(untitled)"} ${row.session.id}`,
            `role ${row.session.agent ?? "default"}`,
            active.has(row.session.id) ? "running" : "idle",
            `access ${row.access}`,
            ...(row.sent === undefined
              ? []
              : [`report due (task sent ${Math.round((now - row.sent) / 60_000)} min ago)`]),
          ].join(" · "),
      )
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
              const project = yield* orchestra.mainOf(context.sessionID)
              if (!project)
                return yield* new ToolFailure({ message: "Only a project's main session can manage sessions" })
              const dispatch = (sessionID: SessionSchema.ID, text: string) =>
                orchestra
                  .dispatch({ project, sessionID, text })
                  .pipe(Effect.mapError((error) => new ToolFailure({ message: "Could not send the task", error })))

              switch (input.action) {
                case "list":
                  return { output: yield* list(project) }
                case "read": {
                  const session = yield* target(project, input.sessionID, "read")
                  const messages = yield* sessions
                    .messages({ sessionID: session.id, limit: input.limit ?? 10, order: "desc" })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: "Could not read the session", error })))
                  const text = messages.toReversed().flatMap(render).join("\n\n")
                  return { sessionID: session.id, output: text || "The session has no messages yet." }
                }
                case "send": {
                  const session = yield* target(project, input.sessionID, "write")
                  if (!input.text?.trim()) return yield* new ToolFailure({ message: "Pass the message as text" })
                  yield* dispatch(session.id, input.text)
                  return {
                    sessionID: session.id,
                    output: `Sent to ${session.title ?? session.id}. Its report will arrive here when it finishes.`,
                  }
                }
                case "create": {
                  const roles = yield* orchestra.roles()
                  if (input.role && !roles.some((role) => role.id === input.role))
                    return yield* new ToolFailure({
                      message: `Unknown role ${input.role}. Roles: ${roles.map((role) => role.id).join(", ")}`,
                    })
                  const created = yield* sessions
                    .create({
                      location: { directory: AbsolutePath.make(project.directory) },
                      title: input.title?.trim() || undefined,
                      agent: input.role ? Orchestra.role(input.role) : undefined,
                    })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: "Could not create a session", error })))
                  yield* orchestra.setAccess(created.id, "full")
                  if (input.category?.trim()) yield* orchestra.setCategory(created.id, input.category)
                  if (input.text?.trim()) yield* dispatch(created.id, input.text)
                  return {
                    sessionID: created.id,
                    output: `Created ${created.id}${input.text?.trim() ? "; its report will arrive here when it finishes" : ""}.`,
                  }
                }
                case "stop": {
                  const session = yield* target(project, input.sessionID, "full")
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
        if (!(yield* orchestra.mainOf(event.sessionID))) delete event.tools[name]
      })
    // The main session also gets its team roster with every request. Status is left
    // out: it changes during a turn, and the stable roster keeps the prompt cacheable.
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        yield* hook(event)
        if (!event.tools[name]) return
        const project = yield* orchestra.mainOf(event.sessionID)
        if (!project) return
        const rows = yield* team(project)
        event.system.push({
          type: "text",
          text: [
            `# Your team — project "${project.name}" (${project.directory})`,
            rows.length === 0
              ? "No team sessions yet. Create them with the sessions tool, action create."
              : grouped(
                  rows,
                  (row) =>
                    `${row.session.title ?? "(untitled)"} ${row.session.id} · role ${row.session.agent ?? "default"} · access ${row.access}`,
                ),
          ].join("\n"),
        })
      }),
    )
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
