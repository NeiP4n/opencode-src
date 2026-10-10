export * as PeerTool from "./peer.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Effect, Schema } from "effect"
import { Peer } from "../../peer.js"
import type { Room } from "@opencode/schema/room"
import { Permission } from "../../permission.js"

export const name = "peers"

const description = [
  "Work together with the AI on another computer: the rooms this computer joined over the network, each a project or session another person hosts with their own AI.",
  "Actions: list shows the rooms, what you may do in each and their sessions;",
  "read returns a room session's latest messages;",
  "send gives the AI in a room session a task or a question; its answer comes back to you automatically as a <peer-report> message, so end your turn instead of waiting;",
  "create starts a new session in a project room, optionally with a first task sent the same way;",
  "passport describes the other computer: its system, shells, installed tools, the project's branch and commit, and the plots (участки) teams hold there, so you know what it can check that this computer cannot;",
  "run executes one command on the other computer in the project, for example its tests on another operating system; the host approves each run, you need the cohost role, and the output comes back directly.",
  "Respect plots: do not ask the other AI to change files inside a plot another team holds.",
  "Pass room as the room ID from list, and sessionID to pick a session other than the room's own.",
  "Write to the other AI as to a capable colleague: say what you need, what you already know, and what the answer should contain.",
].join("\n")

export const Input = Schema.Struct({
  action: Schema.Literals(["list", "read", "send", "create", "passport", "run"]),
  room: Schema.optionalKey(Schema.String).annotate({ description: "Room ID from list, for read, send and create" }),
  sessionID: Schema.optionalKey(Schema.String).annotate({
    description: "Session of the room for read and send; the room's own session when omitted",
  }),
  text: Schema.optionalKey(Schema.String).annotate({
    description: "Message for send, the first task for create, or the command for run",
  }),
  title: Schema.optionalKey(Schema.String).annotate({ description: "Title of the session to create" }),
  limit: Schema.optionalKey(Schema.Int).annotate({ description: "How many recent messages read returns (default 10)" }),
})

export const Output = Schema.Struct({ output: Schema.String })

export const Plugin = {
  id: "opencode.tool.peer",
  effect: Effect.fn("PeerTool.Plugin")(function* (ctx: Context) {
    const peers = yield* Peer.Service
    const permission = yield* Permission.Service

    const linkOf = Effect.fnUntraced(function* (room: string | undefined) {
      if (!room) return yield* new ToolFailure({ message: "Pass room, the room ID from list" })
      const link = (yield* peers.links()).find((item) => item.roomID === room)
      if (!link) return yield* new ToolFailure({ message: `No joined room ${room}. List the rooms first.` })
      return link
    })

    const failed = (error: Peer.PeerError) => new ToolFailure({ message: error.message })

    const list = Effect.fnUntraced(function* () {
      const links = yield* peers.links()
      if (links.length === 0) return "This computer has not joined any room. The operator joins one with Connect."
      const rooms = yield* Effect.forEach(links, (link) =>
        Effect.all([peers.joined(link), peers.sessions(link)]).pipe(
          Effect.map(([joined, sessions]) =>
            [
              `${link.name} · room ${link.roomID} · you are ${joined.role} as ${link.guest}${joined.room.directory ? " · whole project" : ""}`,
              ...sessions.map(
                (session) =>
                  `- ${session.title ?? "(untitled)"} ${session.id}${session.id === joined.session.id ? " (the room's own)" : ""}`,
              ),
            ].join("\n"),
          ),
          Effect.catch((error) => Effect.succeed(`${link.name} · room ${link.roomID} · unreachable: ${error.message}`)),
        ),
      )
      return rooms.join("\n\n")
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
              // Anything leaving for another computer asks the operator first.
              const ask = (resource: string) =>
                permission.assert({
                  action: name,
                  resources: [resource],
                  save: ["*"],
                  metadata: input,
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.messageID, id: context.id },
                })
              const send = (link: Peer.Link, text: string, sessionID?: string) =>
                peers
                  .send({ link, sessionID, text: wrap(link, text), from: context.sessionID })
                  .pipe(Effect.mapError(failed))

              switch (input.action) {
                case "list":
                  return { output: yield* list() }
                case "read": {
                  const link = yield* linkOf(input.room)
                  const chat = yield* peers.chat(link, input.sessionID).pipe(Effect.mapError(failed))
                  const lines = chat.data
                    .slice(-(input.limit ?? 10))
                    .map(
                      (message) =>
                        `[${message.role === "assistant" ? "AI" : (message.author ?? "host")}] ${message.text}`,
                    )
                  return {
                    output: [
                      ...(lines.length > 0 ? lines : ["The session has no messages yet."]),
                      ...(chat.running ? ["(the AI there is working right now)"] : []),
                    ].join("\n\n"),
                  }
                }
                case "send": {
                  const link = yield* linkOf(input.room)
                  if (!input.text?.trim()) return yield* new ToolFailure({ message: "Pass the message as text" })
                  yield* ask(link.name)
                  const session = yield* send(link, input.text, input.sessionID)
                  return {
                    output: `Sent to ${link.name} · ${session.title ?? session.id}. The answer will arrive here as a <peer-report> when that AI finishes.`,
                  }
                }
                case "passport": {
                  const link = yield* linkOf(input.room)
                  const passport = yield* peers.passport(link).pipe(Effect.mapError(failed))
                  return { output: describePassport(link, passport) }
                }
                case "run": {
                  const link = yield* linkOf(input.room)
                  if (!input.text?.trim()) return yield* new ToolFailure({ message: "Pass the command as text" })
                  yield* ask(link.name)
                  const result = yield* peers
                    .run({ link, command: input.text, sessionID: input.sessionID })
                    .pipe(Effect.mapError(failed))
                  return {
                    output: [
                      `Ran on ${link.name} with ${result.shell}, exit code ${result.exitCode}${result.cut ? " (output cut to its end)" : ""}:`,
                      result.output || "(no output)",
                    ].join("\n"),
                  }
                }
                case "create": {
                  const link = yield* linkOf(input.room)
                  yield* ask(link.name)
                  const created = yield* peers
                    .create(link, input.title?.trim() || undefined)
                    .pipe(Effect.mapError(failed))
                  if (input.text?.trim()) yield* send(link, input.text, created.id)
                  return {
                    output: `Created ${created.id} in ${link.name}${input.text?.trim() ? "; its answer will arrive here as a <peer-report>" : ""}.`,
                  }
                }
              }
            }).pipe(
              Effect.map((output) => ({ output, content: output.output })),
              // A declined permission ends the action like any other failure, with its reason.
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: error.message, error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)

    // Sessions on a computer that joined no room never see the tool, and the rest learn
    // which rooms exist with every request; the roster is stable, so the prompt caches.
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        if (!event.tools[name]) return
        const links = yield* peers.links()
        if (links.length === 0) {
          delete event.tools[name]
          return
        }
        event.system.push({
          type: "text",
          text: [
            "# Rooms on other computers",
            "You can work with the AI in these rooms through the peers tool:",
            ...links.map((link) => `- ${link.name} · room ${link.roomID} · you are ${link.guest} there`),
          ].join("\n"),
        })
      }),
    )
    const hide = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        if (event.tools[name] && (yield* peers.links()).length === 0) delete event.tools[name]
      })
    yield* ctx.session.hook("compaction", hide)
    yield* ctx.session.hook("generate", hide)
  }),
}

function describePassport(link: Peer.Link, passport: Room.Passport) {
  return [
    `${link.name}: ${passport.machine} · ${passport.os} ${passport.release} ${passport.arch}`,
    `Shells: ${passport.shells.join(", ") || "none found"}`,
    `Tools: ${passport.tools.join(", ") || "none from the Registry"}`,
    `Project ${passport.project.directory}${passport.project.branch ? ` on ${passport.project.branch} at ${passport.project.commit}` : ""}${passport.project.changed ? `, ${passport.project.changed} file(s) changed and not committed` : ""}`,
    passport.plots.length === 0
      ? "No plots are taken there."
      : [
          "Plots taken there:",
          ...passport.plots.map(
            (plot) =>
              `- ${plot.paths.join(", ")} · ${plot.team} on ${plot.machine} · ${plot.purpose} · until ${new Date(plot.expires).toLocaleTimeString()}`,
          ),
        ].join("\n"),
  ].join("\n")
}

// The AI on the other side learns who writes and that its final answer travels back.
function wrap(link: Peer.Link, text: string) {
  return [
    `<peer-message from="${link.guest}'s AI">`,
    text,
    "</peer-message>",
    "This comes from the AI of another computer working with you through this shared room. Do the task or answer it; your final answer is sent back to that AI automatically.",
  ].join("\n")
}
