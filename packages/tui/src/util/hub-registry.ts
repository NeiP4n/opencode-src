import { Hub } from "@opencode/core/hub/index"
import { which } from "@opencode/core/util/which"

// One row of the Registry panel: a binary the catalog depends on, how many
// platform entries it gates, whether it is on PATH and whether the operator
// left it switched on for the model.
export type RegistryTool = {
  tool: string
  entries: number
  installed: boolean
  enabled: boolean
}

export type RegistryStatus = {
  // Catalog entries of the current platform that run with everything installed
  ready: number
  total: number
  // Unique `requires` that resolve on PATH, sorted for stable output
  installed: string[]
  // Absent tools with the number of entries each one blocks
  missing: { tool: string; entries: number }[]
  terminals: { name: Hub.Backend; present: boolean }[]
  categories: { name: string; ready: number; total: number }[]
  tools: RegistryTool[]
  install?: string
}

export type RegistryOptions = {
  probe?: (tool: string) => boolean
  platform?: NodeJS.Platform
  // `hub.json` as read by the caller. The hint block is opt-in: only a tool the
  // operator switched on is advertised to the model, so an absent key counts as
  // off and an empty state file shows every switch off.
  enabled?: Readonly<Record<string, boolean>>
}

const TERMINALS: readonly Hub.Backend[] = ["bash", "nu", "pwsh"]

export function hubRegistryStatus(options?: RegistryOptions): RegistryStatus {
  const probe = options?.probe ?? ((tool: string) => which(tool) != null)
  const platform = options?.platform ?? process.platform
  const enabled = options?.enabled ?? {}
  const entries = Hub.all.filter((entry) => Hub.supportsPlatform(entry, platform))
  const tools = Array.from(new Set(entries.flatMap((entry) => entry.requires ?? []))).sort()
  // Probe each distinct tool once: `which` walks PATH on every call
  const present = new Set(tools.filter((tool) => probe(tool)))
  const missing = blockedEntries(entries, present)
  const plan =
    missing.length > 0
      ? Hub.planFor(
          missing.map((entry) => entry.tool),
          platform,
        )
      : undefined
  return {
    ready: entries.filter((entry) => (entry.requires ?? []).every((tool) => present.has(tool))).length,
    total: entries.length,
    installed: tools.filter((tool) => present.has(tool)),
    missing,
    terminals: TERMINALS.map((name) => ({ name, present: probe(name) })),
    categories: categoryCounts(entries, present),
    tools: toolRows(entries, present, enabled),
    install: plan?.command,
  }
}

// Rows for the panel, most actionable first: absent tools ahead of installed
// ones, and within each group the tool that unblocks more entries comes first.
// Rows only move when the machine changes, so the list stays predictable while
// the operator toggles switches.
function toolRows(
  entries: readonly Hub.Entry[],
  present: ReadonlySet<string>,
  enabled: Readonly<Record<string, boolean>>,
): RegistryTool[] {
  // The switch shown here is the hint block's flag, so it reads the shared
  // predicate rather than re-deriving the rule and drifting from the prompt.
  const state: Hub.State = { version: 1, enabled: { ...enabled } }
  const counts = new Map<string, number>()
  for (const entry of entries) {
    for (const tool of entry.requires ?? []) counts.set(tool, (counts.get(tool) ?? 0) + 1)
  }
  return Array.from(counts, ([tool, count]) => ({
    tool,
    entries: count,
    installed: present.has(tool),
    enabled: Hub.hinted(state, tool),
  })).sort(
    (a, b) => Number(a.installed) - Number(b.installed) || b.entries - a.entries || a.tool.localeCompare(b.tool),
  )
}

// Absent tool with the number of platform entries it keeps from running.
function blockedEntries(
  entries: readonly Hub.Entry[],
  present: ReadonlySet<string>,
): { tool: string; entries: number }[] {
  const blocked = new Map<string, number>()
  for (const entry of entries) {
    for (const tool of entry.requires ?? []) {
      if (present.has(tool)) continue
      blocked.set(tool, (blocked.get(tool) ?? 0) + 1)
    }
  }
  return Array.from(blocked, ([tool, entries]) => ({ tool, entries })).sort(
    (a, b) => b.entries - a.entries || a.tool.localeCompare(b.tool),
  )
}

// Ready/total per catalog category so the panel can show its own fraction.
function categoryCounts(entries: readonly Hub.Entry[], present: ReadonlySet<string>) {
  const counts = new Map<string, { ready: number; total: number }>()
  for (const entry of entries) {
    const bucket = counts.get(entry.category) ?? { ready: 0, total: 0 }
    bucket.total += 1
    if ((entry.requires ?? []).every((tool) => present.has(tool))) bucket.ready += 1
    counts.set(entry.category, bucket)
  }
  return Array.from(counts, ([name, bucket]) => ({ name, ready: bucket.ready, total: bucket.total })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
}
