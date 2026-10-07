export * as Hub from "./types.js"

// Backends that can execute a rendered catalog command. `bash` is the
// guaranteed fallback; `nu` and `pwsh` are only chosen when the entry ships a
// template for them and the binary is present on PATH.
export type Backend = "bash" | "nu" | "pwsh"

export type Platform = "linux" | "darwin" | "win32"

export type Category =
  | "search"
  | "files"
  | "text"
  | "json"
  | "data"
  | "git"
  | "docker"
  | "systemd"
  | "process"
  | "network"
  | "system"
  | "windows"

// One ready-made fast command. Templates are keyed by backend and may declare
// `{placeholder}` slots filled from user args at run time.
export type Entry = {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly category: Category
  // Executables that must resolve on PATH before the entry may run. Omitted
  // means shell builtins / coreutils assumed present on every platform.
  readonly requires?: readonly string[]
  // Destructive or system-changing entries: never offered a saved "always
  // allow" permission and always flagged in listings.
  readonly danger?: boolean
  // Platforms this entry applies to; omitted means all.
  readonly platforms?: readonly Platform[]
  readonly templates: {
    readonly bash?: string
    readonly nu?: string
    readonly pwsh?: string
  }
}

// Placeholder names declared by a template, in order of appearance. A `?`
// suffix marks the slot optional: `{service?}` renders as "" when no arg is
// given, a plain `{path}` is required and fails the run when missing.
export function placeholders(template: string): string[] {
  const found = template.match(/\{([a-zA-Z][a-zA-Z0-9_]*\??)\}/g)
  if (!found) return []
  return Array.from(new Set(found.map((raw) => raw.slice(1, -1))))
}