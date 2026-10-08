export * as HubActions from "./actions.js"

import { all } from "./catalog/index.js"
import { detectManager, planFor, removeCommand, updateCommand } from "./install.js"

export type RunResult = {
  readonly exit: number
  readonly stdout: string
  readonly stderr: string
}

export type Runner = (command: string) => Promise<RunResult>

export type ActionOptions = {
  readonly runner?: Runner
  readonly platform?: NodeJS.Platform
}

export type ActionResult = {
  readonly ok: boolean
  readonly exit: number
  readonly output: string
  readonly command: string
}

// No manager means no process ever ran; a non-zero exit keeps callers that only
// look at the exit code from treating "nothing happened" as success.
const NO_COMMAND_EXIT = 1

// Tool names are spliced into shell commands verbatim, so only names that the
// fixed catalog declares as `requires` may reach planFor: an arbitrary caller
// string would otherwise travel into `sh -c` unchanged (review 07.10, MAJOR).
// The terminals hub commands can run in are installable too.
const KNOWN: ReadonlySet<string> = new Set([...all.flatMap((entry) => entry.requires ?? []), "nu", "pwsh"])

export async function installTool(tool: string, options: ActionOptions = {}): Promise<ActionResult> {
  if (!KNOWN.has(tool)) return unknownTool(tool)
  const platform = options.platform ?? process.platform
  const plan = planFor([tool], platform)
  if (!plan) return withoutManager(tool, platform)
  return run(plan.command, options)
}

export async function removeTool(tool: string, options: ActionOptions = {}): Promise<ActionResult> {
  if (!KNOWN.has(tool)) return unknownTool(tool)
  const platform = options.platform ?? process.platform
  const plan = planFor([tool], platform)
  if (!plan) return withoutManager(tool, platform)
  return run(removeCommand(plan.manager, plan.tools), options)
}

// The manager asked a mirror for a package version that is gone: its package
// databases are older than the mirror, and installs keep failing until they are
// refreshed.
export function staleDatabase(output: string) {
  return /\b404\b/.test(output) && /(failed retrieving file|не удалось получить файл|Failed to fetch)/i.test(output)
}

export async function updateSystem(options: ActionOptions = {}): Promise<ActionResult> {
  const platform = options.platform ?? process.platform
  const manager = detectManager(platform)
  const command = manager ? updateCommand(manager) : undefined
  if (!command)
    return {
      ok: false,
      exit: NO_COMMAND_EXIT,
      output: `no package database update for ${manager ?? platform}`,
      command: "",
    }
  return run(command, options)
}

// One line that says why a package-manager action failed. A held database lock
// is the common case and its own output buries the cause under advice lines,
// so it gets a direct explanation; otherwise the first error line wins over the
// trailing hint lines managers print after it.
export function failureReason(output: string) {
  if (output.includes("/var/lib/pacman/db.lck"))
    return "pacman database is locked: wait for the running pacman, or remove /var/lib/pacman/db.lck if none is running"
  if (/Could not get lock .*dpkg/.test(output)) return "dpkg is locked by another apt or dpkg process"
  if (staleDatabase(output)) return "the package databases are outdated: update the system, then install again"
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  return lines.find((line) => /^(error|ошибка|E:)/i.test(line)) ?? lines.at(-1) ?? "failed"
}

async function run(command: string, options: ActionOptions): Promise<ActionResult> {
  const result = await (options.runner ?? spawnRunner(options.platform ?? process.platform))(command)
  if (result.exit === 0) return { ok: true, exit: 0, output: result.stdout, command }
  // The panel shows the output plus the command so it can be rerun by hand;
  // stderr travels with it unparsed — the exit code alone decides (plan.md, «Совет ИИ» 07.10).
  return { ok: false, exit: result.exit, output: `${command}\n${result.stderr}`, command }
}

// Rejected before any command is built: nothing ran, so the empty command
// tells the panel there is nothing to rerun by hand.
function unknownTool(tool: string): ActionResult {
  return {
    ok: false,
    exit: NO_COMMAND_EXIT,
    output: `unknown tool "${tool}": not in the hub catalog`,
    command: "",
  }
}

function withoutManager(tool: string, platform: NodeJS.Platform): ActionResult {
  return {
    ok: false,
    exit: NO_COMMAND_EXIT,
    output: `no package manager detected on ${platform}: nothing ran for ${tool}`,
    command: "",
  }
}

// Commands come from fixed catalog code and are handed to the platform shell
// verbatim: sh -c everywhere but Windows, which shells through cmd /c.
function spawnRunner(platform: NodeJS.Platform): Runner {
  return async (command) => {
    // stdin stays closed so an action started from the panel never blocks on input.
    // Without an explicit env Bun.spawn reuses the environment captured at process
    // startup, so runtime PATH changes (opencode adjusting it, the test harness
    // steering detection) would silently not reach the child.
    const child = Bun.spawn(platform === "win32" ? ["cmd", "/c", command] : ["sh", "-c", command], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    return { exit, stdout, stderr }
  }
}
