export * as HubTool from "./hub.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import type { ShellCreateBefore } from "@opencode/plugin/effect/shell"
import type { Tool } from "@opencode/schema/tool"
import { Deferred, Effect, Schema, Scope } from "effect"
import { Environment } from "../../environment/index.js"
import { FileAccess } from "../../file-access.js"
import { Job } from "../../job.js"
import { Permission } from "../../permission.js"
import { Shell } from "../../shell.js"
import { ShellParse } from "../../shell/parse.js"
import { ShellResult } from "../../shell/result.js"
import { ShellSelect } from "../../shell/select.js"
import { Session } from "../../session.js"
import { SessionSchema } from "../../session/schema.js"
import { Config } from "../../config.js"
import { Hub } from "../../hub/index.js"
import { which } from "../../util/which.js"

export const name = "hub"
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000

const description = (tools: string[]) =>
  [
    "Run a ready-made fast command from the Universal Tool Hub instead of hand-writing shell.",
    "Prefer this tool over shell when a catalog entry covers the task: hub commands use fast modern CLIs (rg, fd, jq, yq, mlr) and pick the best available backend.",
    'Call with list or query to discover entries, id plus args to run one.',
    'With install plus id prints the package-manager command for missing tools. Use shell as fallback when no entry fits.',
    tools.length > 0 ? `Tools already available: ${tools.join(", ")}.` : "No optional hub tools detected yet.",
  ].join(" ")

export const Input = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  args: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  backend: Schema.optionalKey(Schema.Literals(["bash", "nu", "pwsh"])),
  list: Schema.optionalKey(Schema.Boolean),
  query: Schema.optionalKey(Schema.String),
  category: Schema.optionalKey(Schema.String),
  install: Schema.optionalKey(Schema.Boolean),
  workdir: Schema.optionalKey(Schema.String),
})

const EntryInfo = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  category: Schema.String,
  danger: Schema.Boolean,
  missing: Schema.Array(Schema.String),
  template: Schema.String,
  placeholders: Schema.Array(Schema.String),
})

const Output = Schema.Struct({
  output: Schema.String,
  status: Schema.optionalKey(Schema.Literals(["completed", "running", "planned"])),
  exit: Schema.optionalKey(Schema.Number),
  hubID: Schema.optionalKey(Schema.String),
  backend: Schema.optionalKey(Schema.String),
  command: Schema.optionalKey(Schema.String),
  shellID: Schema.optionalKey(Schema.String),
  truncated: Schema.optionalKey(Schema.Boolean),
  entries: Schema.optionalKey(Schema.Array(EntryInfo)),
})

type Output = typeof Output.Type

const failure = (message: string, error?: unknown) => new ToolFailure({ message, error })

const entryInfo = (entry: Hub.Entry) => {
  // Lazy backend: entries for another platform (windows.* on linux) have no
  // usable backend here. Show the first declared template instead of throwing,
  // the run path still filters by platform before executing.
  const key = (["bash", "nu", "pwsh"] as const).find((backend) => entry.templates[backend] !== undefined)
  const template = key !== undefined ? (entry.templates[key] ?? "") : ""
  return {
    id: entry.id,
    title: entry.title,
    description: entry.description,
    category: entry.category,
    danger: entry.danger === true,
    missing: Hub.supportsPlatform(entry) ? Hub.missingTools(entry) : [],
    template,
    placeholders: Hub.placeholders(template),
  }
}

const matches = (entry: Hub.Entry, query: string, category?: string) => {
  if (category && entry.category !== category) return false
  if (!query) return true
  const needle = query.toLowerCase()
  return (
    entry.id.includes(needle) ||
    entry.title.toLowerCase().includes(needle) ||
    entry.description.toLowerCase().includes(needle)
  )
}

export const Plugin = {
  id: "opencode.tool.hub",
  effect: Effect.fn("HubTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const jobs = yield* Job.Service
    const scope = yield* Scope.Scope
    const environment = yield* Environment.Service
    const access = yield* FileAccess.Service
    const shell = yield* Shell.Service
    const select = yield* ShellSelect.Service
    const compatibleShell = select.resolve({ priority: "compat" })
    const permission = yield* Permission.Service
    const config = yield* Config.Service
    const detected = Hub.available()

    const toolResult = (output: Output) => ({
      output,
      content: output.output ? [{ type: "text" as const, text: output.output }] : [],
      metadata: {
        ...(output.status !== undefined ? { status: output.status } : {}),
        ...(output.hubID !== undefined ? { hubID: output.hubID } : {}),
        ...(output.backend !== undefined ? { backend: output.backend } : {}),
        ...(output.command !== undefined ? { command: output.command } : {}),
        ...(output.shellID !== undefined ? { shellID: output.shellID } : {}),
      },
    })
    const backgroundResult = (shellID: string, file: string): Output => ({
      output: `Command moved to the background (shell ID: ${shellID}).\nOutput is streaming to: ${file}`,
      shellID,
      truncated: false,
      status: "running",
    })

    const notifyWhenDone = Effect.fn("HubTool.notifyWhenDone")(
      function* (
        sessionID: SessionSchema.ID,
        id: string,
        shellID: string,
        command: string,
        settled: Deferred.Deferred<Output>,
      ) {
        const info = (yield* jobs.wait({ id })).info
        if (!info || info.status === "running") return
        const output = info.status === "completed" ? yield* Deferred.await(settled) : undefined
        const text = output ? output.output : info.status === "error" ? (info.error ?? "Command failed") : "Cancelled"
        yield* sessions.synthetic({
          ...(info.notificationID ? { id: info.notificationID } : {}),
          sessionID,
          description: command,
          ...ShellResult.notification({
            jobID: id,
            shellID,
            command,
            state: info.status,
            text,
            output: output ? { output: output.output, truncated: output.truncated ?? false, exit: output.exit } : undefined,
          }),
        })
        if (info.notificationID) yield* jobs.completeBackground(info.notificationID)
      },
      Effect.forkIn(scope, { startImmediately: true }),
    )

    const prepare = Effect.fn("HubTool.prepare")(function* (invocation: ShellCreateBefore, context: Tool.Context) {
      const source = { type: "tool" as const, messageID: context.messageID, id: context.id }
      const target = yield* access.resolve({ path: invocation.cwd, kind: "directory" })
      invocation.cwd = target.absolute
      const timeout = invocation.timeout
      const portable = Config.latest(yield* config.entries(), "experimental")?.portable_shell_scanner === true
      const parsed = yield* ShellParse.scan(invocation.command, invocation.shell, target.absolute, { portable })
      const directories = yield* Effect.forEach(parsed.directories, (directory) =>
        access.resolve({ path: FileAccess.resolvePath(target.absolute, directory), kind: "directory" }),
      )
      yield* access.authorizeExternal([target, ...directories], context)
      if (parsed.commands.length > 0)
        yield* permission.assert({
          action: name,
          resources: parsed.commands.map((command) => command.resource),
          save: parsed.commands.map((command) => command.save),
          sessionID: context.sessionID,
          agent: context.agent,
          source,
        })
      const workdir = yield* Environment.typeFollowing(environment.files, target.absolute).pipe(
        Effect.catchTag("Environment.NotFound", () =>
          Effect.fail(new Error(`Working directory does not exist: ${target.absolute}`)),
        ),
      )
      if (workdir !== "directory")
        return yield* Effect.fail(new Error(`Working directory is not a directory: ${target.absolute}`))
      return timeout
    })
    yield* ctx.tool.transform((editor) =>
      editor.add({
        name,
        options: { codemode: false },
        description: description(detected),
        input: Input,
        output: Output,
        execute: (input, context) =>
          Effect.gen(function* () {
            if (input.install === true) {
              if (!input.id) return yield* failure("Pass an entry id to get its install command")
              const found = Hub.get(input.id)
              if (!found) return yield* failure(`Unknown hub command: ${input.id}`)
              const lacking = Hub.missingTools(found)
              if (lacking.length === 0)
                return { output: `All tools for ${input.id} are already installed.`, status: "completed" as const, hubID: input.id }
              const plan = Hub.planFor(lacking)
              if (!plan)
                return { output: `No package manager detected. Install manually: ${lacking.join(", ")}.`, status: "planned" as const, hubID: input.id }
              return { output: `Install with: ${plan.command}`, status: "planned" as const, hubID: input.id, command: plan.command }
            }
            if (input.list === true || (input.query !== undefined && input.id === undefined)) {
              const state = yield* Effect.tryPromise(() => Hub.read()).pipe(
                Effect.orElseSucceed(() => ({ version: 1 as const, enabled: {} }) as Hub.State),
              )
              const listing = Hub.all.filter(
                (entry) => matches(entry, input.query ?? "", input.category) && Hub.discoverable(state, entry),
              )
              return {
                output: listing.map((entry) => `${entry.id} [${entry.category}]${entry.danger === true ? " DANGER" : ""} - ${entry.title}`).join("\n"),
                status: "completed" as const,
                entries: listing.map(entryInfo),
              }
            }
            if (!input.id) return yield* failure("Pass an entry id, or use list/query to discover one")
            const entry = Hub.get(input.id)
            if (!entry) return yield* failure(`Unknown hub command: ${input.id}`)
            let rendered: Hub.Rendered
            try {
              rendered = Hub.prepare(entry, input.args ?? {}, { backend: input.backend })
            } catch (error) {
              if (error instanceof Hub.MissingToolError) {
                const plan = Hub.planFor(error.missing)
                const hint = plan ? ` Install with: ${plan.command}.` : " No package manager detected; use shell as fallback."
                return yield* failure(`Missing tools for ${input.id}: ${error.missing.join(", ")}.${hint}`)
              }
              if (error instanceof Hub.MissingArgumentError)
                return yield* failure(`Missing arguments for ${input.id}: ${error.missing.join(", ")}`)
              throw error
            }
            const timeout = DEFAULT_TIMEOUT_MS
            const info = yield* shell.create(
              {
                command: rendered.command,
                cwd: input.workdir,
                timeout,
                shell: yield* compatibleShell,
                metadata: { sessionID: context.sessionID },
              },
              (invocation) =>
                Effect.gen(function* () {
                  invocation.env.AGENT = "1"
                  invocation.env.OPENCODE = "1"
                  invocation.env.AI_AGENT ||= "opencode"
                  invocation.env.OPENCODE_SESSION_ID = context.sessionID
                  yield* prepare(invocation, context)
                }),
            )
            yield* context.progress({ shellID: info.id })
            const settled = yield* Deferred.make<Output>()
            const run = Effect.gen(function* () {
              const result = yield* shell.result(info)
              if (!result.capture) return yield* new Shell.NotFoundError({ id: info.id })
              const out = ShellResult.output(result)
              return {
                ...out,
                status: "completed" as const,
                hubID: entry.id,
                backend: rendered.backend,
                command: rendered.command,
              }
            }).pipe(
              Effect.tap((output) => Deferred.succeed(settled, output)),
              Effect.map((output) => output.output),
              Effect.onInterrupt(() => shell.remove(info.id).pipe(Effect.ignore)),
            )
            const job = yield* jobs.start({
              id: info.id,
              type: name,
              title: rendered.command,
              metadata: { sessionID: context.sessionID, shellID: info.id },
              recovery: { kind: "shell", sessionID: context.sessionID, shellID: info.id, command: info.command },
              run,
            })
            const result = yield* jobs
              .block({ id: job.id, sessionID: context.sessionID })
              .pipe(Effect.onInterrupt(() => jobs.cancel(job.id).pipe(Effect.ignore)))
            if (result?.type === "backgrounded") {
              yield* shell.timeout(info.id, 0)
              yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, settled)
              return backgroundResult(info.id, info.file)
            }
            if (result?.info.status === "error") return yield* Effect.fail(new Error(result.info.error ?? "Command failed"))
            if (result?.info.status === "cancelled") return yield* Effect.fail(new Error("Command cancelled"))
            return yield* Deferred.await(settled)
          }).pipe(
            Effect.map(toolResult),
            Effect.mapError((error) => new ToolFailure({ message: `Unable to run hub command: ${input.id ?? "?"}`, error })),
          ),
      }),
    ).pipe(Effect.orDie)

    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const tool = event.tools[name]
        if (!tool) return
        tool.description = description(detected)
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}