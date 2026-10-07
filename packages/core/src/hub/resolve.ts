export * as HubResolve from "./resolve.js"

import type { Backend, Entry, Platform } from "./types.js"
import { placeholders } from "./types.js"
import { which } from "../util/which.js"

export type Rendered = {
  readonly entry: Entry
  readonly backend: Backend
  readonly command: string
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

export function supportsPlatform(entry: Entry, platform: NodeJS.Platform = process.platform): boolean {
  if (!entry.platforms) return true
  return entry.platforms.includes(platform as Platform)
}

// Backend preference: what the caller asked for, then nushell, then pwsh,
// then bash. A backend is only eligible when the entry ships a template for
// it and, for nu/pwsh, the binary resolves on PATH.
export function chooseBackend(
  entry: Entry,
  preferred: Backend | undefined,
  bin?: string,
): Backend {
  const order: Backend[] = preferred ? [preferred, ...(["nu", "pwsh", "bash"] as Backend[]).filter((b) => b !== preferred)] : ["nu", "pwsh", "bash"]
  for (const backend of order) {
    if (!entry.templates[backend]) continue
    if (backend !== "bash" && !which(backend, undefined, bin)) continue
    return backend
  }
  /* istanbul ignore next -- every entry declares at least a bash template */
  throw new Error(`Hub command ${entry.id} has no usable backend`)
}

// Substitutes {placeholders} from args. Required slots fail fast with the
// full list of what is missing so the model can retry in one shot; optional
// `{name?}` slots render as an empty string.
export function render(entry: Entry, backend: Backend, args: Record<string, string>): string {
  const template = entry.templates[backend]
  if (!template) throw new Error(`Hub command ${entry.id} has no ${backend} template`)
  const slots = placeholders(template)
  const missing = slots.filter((slot) => !slot.endsWith("?") && !(slot.slice(0, -1) in args) && !(slot in args))
  if (missing.length > 0) throw new MissingArgumentError(entry.id, missing)
  const unknown = Object.keys(args).filter((key) => !slots.some((slot) => slot.replace(/\?$/, "") === key))
  if (unknown.length > 0) throw new MissingArgumentError(entry.id, [`unknown: ${unknown.join(", ")}`])
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*\??)\}/g, (_, slot: string) => {
    const optional = slot.endsWith("?")
    const key = optional ? slot.slice(0, -1) : slot
    return args[key] ?? ""
  })
}

export function missingTools(entry: Entry, bin?: string): string[] {
  return (entry.requires ?? []).filter((tool) => !which(tool, undefined, bin))
}

// Full pipeline: platform filter, tool availability, backend choice, render.
export function prepare(
  entry: Entry,
  args: Record<string, string>,
  options?: { backend?: Backend; bin?: string; platform?: NodeJS.Platform },
): Rendered {
  const platform = options?.platform ?? process.platform
  if (!supportsPlatform(entry, platform))
    throw new Error(`Hub command ${entry.id} is not available on ${platform}`)
  const missing = missingTools(entry, options?.bin)
  if (missing.length > 0) throw new MissingToolError(entry.id, missing)
  const backend = chooseBackend(entry, options?.backend, options?.bin)
  return { entry, backend, command: render(entry, backend, args) }
}

// Availability probe used by the install planner and the tool description:
// which of the catalog's optional tools are on PATH right now.
export function available(bin?: string): string[] {
  return [
    "rg",
    "fd",
    "jq",
    "yq",
    "mlr",
    "sqlite3",
    "rsync",
    "tree",
    "watchexec",
    "sd",
    "lsof",
    "pgrep",
    "pstree",
    "nc",
    "dig",
    "traceroute",
    "lsd",
    "diff-so-fancy",
    "docker",
    "systemctl",
    "journalctl",
    "pwsh",
    "nu",
    "winget",
  ].filter((tool) => which(tool, undefined, bin))
}
