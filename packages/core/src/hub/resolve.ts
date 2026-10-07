export * as HubResolve from "./resolve.js"

import type { Backend, Entry, Platform } from "./types.js"
import { optionalSlot, placeholders, slotKey } from "./types.js"
import { all } from "./catalog/index.js"
import { HubHost } from "./host.js"
import { fill } from "./quote.js"

export type Rendered = {
  readonly entry: Entry
  readonly backend: Backend
  readonly command: string
  // Executable that must run `command`: bash/sh on Linux, Git Bash or
  // PowerShell on Windows, nu wherever it was chosen.
  readonly shell: string
}

// The machine as the resolver sees it. Production probes the live system via
// hub/host.ts; tests hand in a fixed one so results do not depend on the host.
export type Machine = {
  readonly platform: NodeJS.Platform
  readonly locate: (tool: string) => HubHost.Located | undefined
  readonly shell: (backend: Backend) => string | undefined
}

export function machine(probe: HubHost.Probe = {}): Machine {
  return {
    platform: probe.platform ?? process.platform,
    locate: (tool) => HubHost.locate(tool, probe),
    shell: (backend) => HubHost.shellFor(backend, probe),
  }
}

export class MissingToolError extends Error {
  constructor(
    readonly id: string,
    readonly missing: readonly string[],
  ) {
    super(`Hub command ${id} requires missing tools: ${missing.join(", ")}`)
  }
}

export class MissingArgumentError extends Error {
  constructor(
    readonly id: string,
    readonly missing: readonly string[],
  ) {
    super(`Hub command ${id} is missing arguments: ${missing.join(", ")}`)
  }
}

export class NoBackendError extends Error {
  constructor(
    readonly id: string,
    readonly platform: NodeJS.Platform,
    readonly needs: readonly Backend[],
  ) {
    super(
      `Hub command ${id} has no shell to run it on ${platform}: needs ${needs.join(" or ")}` +
        (platform === "win32" && needs.includes("bash") ? " (bash on Windows means Git Bash from Git for Windows)" : ""),
    )
  }
}

export function supportsPlatform(entry: Entry, platform: NodeJS.Platform = process.platform): boolean {
  if (!entry.platforms) return true
  return entry.platforms.includes(platform as Platform)
}

// PowerShell aliases that shadow the POSIX tool of the same name (`ls` is
// Get-ChildItem, `curl` is Invoke-WebRequest on 5.1, `sort` is Sort-Object),
// plus Windows executables with a different CLI (`find.exe`, `ping.exe`).
const PWSH_SHADOWED = new Set([
  "cat", "cd", "chdir", "clear", "compare", "copy", "cp", "del", "diff", "dir", "echo", "erase", "fc",
  "find", "group", "history", "kill", "ls", "man", "md", "measure", "mkdir", "mount", "move", "mv", "ping",
  "popd", "ps", "pushd", "pwd", "rd", "ren", "rm", "rmdir", "select", "set", "sleep", "sort", "start", "tee",
  "type", "wget", "where", "write",
])

// A bash template that means the same thing when PowerShell runs it: one
// plain command with literal flags and bare placeholders, no pipes, quotes,
// globs or expansions, and a first word that is a real executable rather than
// a PowerShell alias. `rg --count {pattern} {path}` qualifies; anything with
// `|`, `'…'` or `$` stays bash-only.
export function portable(template: string | undefined): template is string {
  if (!template) return false
  const stripped = template.replace(/\{[a-zA-Z][a-zA-Z0-9_]*[?*]?\}/g, "x")
  if (/[|&;<>()$`'"\\{}*?[\]~#!]/.test(stripped)) return false
  const first = template.trim().split(/\s+/)[0]
  if (!first || first.startsWith("{")) return false
  return !PWSH_SHADOWED.has(first.toLowerCase())
}

// Real executables that Windows PowerShell 5.1 hides behind an alias of the
// same name; spelling out `.exe` reaches the binary on every version.
const PWSH_EXE = new Set(["curl", "wget"])

// The bash template as PowerShell must read it on this platform.
function forPwsh(bash: string, platform: NodeJS.Platform): string {
  const first = bash.trim().split(/\s+/)[0]
  if (platform !== "win32" || !PWSH_EXE.has(first)) return bash
  return bash.replace(first, `${first}.exe`)
}

export type Choice = {
  readonly backend: Backend
  readonly template: string
  readonly shell: string
}

// Backend for this machine: the caller's choice when it can run, else the
// platform order from hub/host.ts (bash → nu → pwsh on Linux and macOS,
// pwsh → Git Bash → nu on Windows). A plain bash template is finally offered
// to PowerShell when it is portable, so Windows without Git Bash still runs it.
export function choose(entry: Entry, preferred: Backend | undefined, host: Machine = machine()): Choice {
  const order = HubHost.order(host.platform)
  const ranked = preferred ? [preferred, ...order.filter((backend) => backend !== preferred)] : order
  for (const backend of ranked) {
    const template = entry.templates[backend]
    if (!template) continue
    const shell = host.shell(backend)
    if (shell) return { backend, template, shell }
  }
  const bash = entry.templates.bash
  if (portable(bash) && host.locate(bash.trim().split(/\s+/)[0])) {
    const shell = host.shell("pwsh")
    if (shell) return { backend: "pwsh", template: forPwsh(bash, host.platform), shell }
  }
  const declared = (["bash", "nu", "pwsh"] as const).filter((backend) => entry.templates[backend] !== undefined)
  throw new NoBackendError(entry.id, host.platform, declared)
}

// Kept for callers that only want the name.
export function chooseBackend(entry: Entry, preferred: Backend | undefined, bin?: string): Backend {
  return choose(entry, preferred, machine({ bin })).backend
}

// Substitutes {placeholders} from args, escaped for the backend that runs the
// command. Required slots fail fast with the full list of what is missing so
// the model can retry in one shot; optional `{name?}` and `{name*}` slots
// render as nothing when absent.
export function render(entry: Entry, backend: Backend, args: Record<string, string>, host?: Machine): string {
  const template =
    entry.templates[backend] ??
    (backend === "pwsh" && portable(entry.templates.bash)
      ? forPwsh(entry.templates.bash, host?.platform ?? process.platform)
      : undefined)
  if (!template) throw new Error(`Hub command ${entry.id} has no ${backend} template`)
  return fillChecked(entry, renamed(entry, template, host), args, backend)
}

function fillChecked(entry: Entry, template: string, args: Record<string, string>, backend: Backend): string {
  const slots = placeholders(template)
  const missing = slots.filter((slot) => !optionalSlot(slot) && !(slotKey(slot) in args))
  if (missing.length > 0) throw new MissingArgumentError(entry.id, missing)
  const unknown = Object.keys(args).filter((key) => !slots.some((slot) => slotKey(slot) === key))
  if (unknown.length > 0) throw new MissingArgumentError(entry.id, [`unknown: ${unknown.join(", ")}`])
  return fill(template, args, backend)
}

// Swaps a required tool for the name it has on this machine (`fd` → `fdfind`
// on Debian) wherever it stands in command position: start of the template,
// after a pipe or separator, or as the program xargs runs.
function renamed(entry: Entry, template: string, host?: Machine): string {
  if (!host) return template
  let out = template
  for (const tool of entry.requires ?? []) {
    const name = host.locate(tool)?.name
    if (!name || name === tool) continue
    const escaped = tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    out = out.replace(new RegExp(`(^|[|;&(]\\s*|\\bxargs(?:\\s+-\\S+)*\\s+)${escaped}(?=\\s|$)`, "g"), `$1${name}`)
  }
  return out
}

export function missingTools(entry: Entry, probe?: string | Machine): string[] {
  const host = typeof probe === "object" ? probe : machine({ bin: probe })
  return (entry.requires ?? []).filter((tool) => !host.locate(tool))
}

// Full pipeline: platform filter, tool availability, backend choice, render.
export function prepare(
  entry: Entry,
  args: Record<string, string>,
  options?: { backend?: Backend; bin?: string; platform?: NodeJS.Platform; machine?: Machine },
): Rendered {
  const host = options?.machine ?? machine({ bin: options?.bin, platform: options?.platform })
  if (!supportsPlatform(entry, host.platform))
    throw new Error(`Hub command ${entry.id} is not available on ${host.platform}`)
  const missing = missingTools(entry, host)
  if (missing.length > 0) throw new MissingToolError(entry.id, missing)
  const choice = choose(entry, options?.backend, host)
  return {
    entry,
    backend: choice.backend,
    shell: choice.shell,
    command: fillChecked(entry, renamed(entry, choice.template, host), args, choice.backend),
  }
}

// Optional tools of this platform's catalog entries, plus the alternative
// backends, that resolve right now. Used by the tool description, the prompt
// hints and the install planner.
export function available(bin?: string, platform: NodeJS.Platform = process.platform): string[] {
  const tools = new Set<string>(["nu", "pwsh"])
  for (const entry of all) {
    if (!supportsPlatform(entry, platform)) continue
    for (const tool of entry.requires ?? []) tools.add(tool)
  }
  return Array.from(tools)
    .sort()
    .filter((tool) => HubHost.has(tool, { bin, platform }))
}
