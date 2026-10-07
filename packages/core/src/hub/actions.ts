export * as HubActions from "./actions.js"

import { all } from "./catalog/index.js"
import { HubHost } from "./host.js"
import { planFor, removeCommand, type Elevation } from "./install.js"

export type RunResult = {
  readonly exit: number
  readonly stdout: string
  readonly stderr: string
}

export type Runner = (command: string) => Promise<RunResult>

export type ActionOptions = {
  readonly runner?: Runner
  readonly platform?: NodeJS.Platform
  // Running as root: system managers are called without sudo. Defaults to the
  // real uid; tests pin it so the expected command does not depend on who runs them.
  readonly privileged?: boolean
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
// fixed catalog declares as `requires` (plus the alternative backends) may
// reach planFor: an arbitrary caller string would otherwise travel into the
// shell unchanged (review 07.10, MAJOR).
const KNOWN: ReadonlySet<string> = new Set([...all.flatMap((entry) => entry.requires ?? []), "nu", "pwsh"])

export async function installTool(tool: string, options: ActionOptions = {}): Promise<ActionResult> {
  if (!KNOWN.has(tool)) return unknownTool(tool)
  const platform = options.platform ?? process.platform
  const plan = planFor([tool], platform, undefined, { elevation: elevation(options, platform) })
  if (!plan) return withoutManager(tool, platform)
  return run(plan.command, options)
}

export async function removeTool(tool: string, options: ActionOptions = {}): Promise<ActionResult> {
  if (!KNOWN.has(tool)) return unknownTool(tool)
  const platform = options.platform ?? process.platform
  const plan = planFor([tool], platform)
  if (!plan) return withoutManager(tool, platform)
  return run(removeCommand(plan.manager, plan.tools, elevation(options, platform)), options)
}

// The panel runs actions with stdin closed, so sudo must not prompt.
function elevation(options: ActionOptions, platform: NodeJS.Platform): Elevation {
  return (options.privileged ?? HubHost.privileged(platform)) ? "none" : "batch"
}

async function run(command: string, options: ActionOptions): Promise<ActionResult> {
  const result = await (options.runner ?? spawnRunner(options.platform ?? process.platform))(command)
  if (result.exit === 0) return { ok: true, exit: 0, output: result.stdout, command }
  // The panel shows the output plus the command so it can be rerun by hand;
  // stderr travels with it unparsed — the exit code alone decides (plan.md, «Совет ИИ» 07.10).
  return { ok: false, exit: result.exit, output: `${command}\n${result.stderr || result.stdout}`, command }
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
    output: `no package manager with a package for ${tool} detected on ${platform}: nothing ran`,
    command: "",
  }
}

// Commands come from fixed catalog code and are handed to the platform shell
// verbatim: sh -c on Linux and macOS, cmd /c on Windows (winget, scoop and
// choco are all cmd-friendly). The shell is resolved by absolute path so a
// narrowed PATH cannot hide it.
function spawnRunner(platform: NodeJS.Platform): Runner {
  return async (command) => {
    // stdin stays closed so an action started from the panel never blocks on input.
    // Without an explicit env Bun.spawn reuses the environment captured at process
    // startup, so runtime PATH changes (opencode adjusting it, the test harness
    // steering detection) would silently not reach the child.
    const { key, value } = HubHost.spawnPath(process.env, platform)
    const argv =
      platform === "win32"
        ? [process.env.ComSpec ?? process.env.COMSPEC ?? "cmd.exe", "/d", "/s", "/c", command]
        : ["sh", "-c", command]
    const child = Bun.spawn(argv, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, [key]: value },
    })
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    return { exit, stdout, stderr }
  }
}
