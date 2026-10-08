import { expect, test } from "bun:test"
import { Hub } from "@opencode/core/hub/index"
import { hubRegistryStatus } from "../../src/util/hub-registry"

// Entries that apply to the machine running the tests: the same filter the
// status function applies internally, recomputed here from the catalog only.
const platformEntries = () => Hub.all.filter((entry) => Hub.supportsPlatform(entry, process.platform))
const requiredTools = () => new Set(platformEntries().flatMap((entry) => entry.requires ?? []))

test("probe that finds every tool reports the whole catalog ready", () => {
  const status = hubRegistryStatus({ probe: () => true })
  expect(status.total).toBe(platformEntries().length)
  expect(status.ready).toBe(status.total)
  expect(status.missing).toEqual([])
  expect(status.install).toBeUndefined()
  expect(status.terminals.every((terminal) => terminal.present)).toBe(true)
  expect(status.installed).toContain("rg")
  expect(status.installed).toContain("jq")
})

test("one absent tool blocks its entries and produces an install command", () => {
  const status = hubRegistryStatus({ probe: (tool) => tool !== "jq" })
  const jq = status.missing.find((entry) => entry.tool === "jq")
  expect(jq?.entries).toBeGreaterThan(0)
  expect(status.ready).toBeLessThan(status.total)
  expect(status.installed).not.toContain("jq")
  expect(typeof status.install).toBe("string")
  expect(status.install).toContain("jq")
  expect(status.terminals.every((terminal) => terminal.present)).toBe(true)
})

test("installed and missing partition every requirement for any probe", () => {
  const probes = [(tool: string) => true, (tool: string) => tool !== "jq", (tool: string) => tool === "rg"]
  for (const probe of probes) {
    const status = hubRegistryStatus({ probe, manager: "apt" })
    const accounted = new Set([...status.installed, ...status.missing.map((entry) => entry.tool)])
    expect([...accounted].sort()).toEqual([...requiredTools()].sort())
    expect(status.installed.filter((tool) => status.missing.some((entry) => entry.tool === tool))).toEqual([])
    expect(status.categories.reduce((sum, category) => sum + category.ready, 0)).toBe(status.ready)
    expect(status.categories.reduce((sum, category) => sum + category.total, 0)).toBe(status.total)
    const expectedBlocked = new Map<string, number>()
    for (const entry of platformEntries()) {
      for (const tool of entry.requires ?? []) {
        if (!probe(tool)) expectedBlocked.set(tool, (expectedBlocked.get(tool) ?? 0) + 1)
      }
    }
    expect(status.missing).toEqual(
      [...expectedBlocked]
        .map(([tool, entries]) => ({ tool, entries }))
        .sort((a, b) => b.entries - a.entries || a.tool.localeCompare(b.tool)),
    )
  }
})

test("default probe mirrors which() on PATH", () => {
  const status = hubRegistryStatus({ manager: "apt" })
  expect(status.total).toBe(platformEntries().length)
  const missing = new Set(status.missing.map((entry) => entry.tool))
  const required = requiredTools()
  expect(status.installed.length + status.missing.length).toBe(required.size)
  for (const tool of required) {
    expect(status.installed.includes(tool) !== missing.has(tool)).toBe(true)
  }
  expect(status.installed).toEqual([...status.installed].sort())
  expect(status.terminals.map((terminal) => terminal.name)).toEqual(["bash", "nu", "pwsh"])
})

test("tool rows default to off, stay unique and lead with the most actionable tool", () => {
  const status = hubRegistryStatus({ probe: (tool) => tool !== "jq" })
  const names = status.tools.map((row) => row.tool)
  expect(new Set(names).size).toBe(names.length)
  // the absent tool sorts ahead of every installed one
  expect(status.tools[0].tool).toBe("jq")
  expect(status.tools[0].installed).toBe(false)
  expect(status.tools[0].entries).toBeGreaterThan(0)
  expect(status.tools.slice(1).every((row) => row.installed)).toBe(true)
  // opt-in: nothing is advertised until the operator switches it on
  expect(status.tools.every((row) => !row.enabled)).toBe(true)
})

test("an enabled map turns rows on and an explicit false keeps everything else off", () => {
  const probe = (tool: string) => tool !== "jq"
  const rows = hubRegistryStatus({ probe, enabled: { rg: true, jq: false } }).tools
  expect(rows.find((row) => row.tool === "rg")!.enabled).toBe(true)
  expect(rows.find((row) => row.tool === "jq")!.enabled).toBe(false)
  expect(rows.filter((row) => row.enabled).map((row) => row.tool)).toEqual(["rg"])
  // rows are the same set and order regardless of the switch state
  expect(rows.map((row) => row.tool)).toEqual(hubRegistryStatus({ probe }).tools.map((row) => row.tool))
})

test("tool rows account for every required tool with its blocked entry count", () => {
  for (const probe of [(tool: string) => true, (tool: string) => tool !== "rg"]) {
    const status = hubRegistryStatus({ probe })
    const expected = new Map<string, number>()
    for (const entry of platformEntries()) {
      for (const tool of entry.requires ?? []) expected.set(tool, (expected.get(tool) ?? 0) + 1)
    }
    expect(new Map(status.tools.map((row) => [row.tool, row.entries]))).toEqual(expected)
    for (const row of status.tools) {
      if (!probe(row.tool)) continue
      expect(status.installed).toContain(row.tool)
    }
  }
})

test("win32 platform filter stays fully ready and only drops the entries another platform owns", () => {
  const win32 = hubRegistryStatus({ platform: "win32", probe: () => true })
  const linux = hubRegistryStatus({ platform: "linux", probe: () => true })
  expect(win32.ready).toBe(win32.total)
  expect(win32.missing).toEqual([])
  expect(win32.install).toBeUndefined()
  // Filtering comes from the catalog's platforms fields alone, never from PATH
  const onlyWin32 = Hub.all.filter(
    (entry) => Hub.supportsPlatform(entry, "win32") && !Hub.supportsPlatform(entry, "linux"),
  )
  expect(onlyWin32.length).toBeGreaterThan(0)
  expect(win32.total - linux.total).toBe(onlyWin32.length)
  expect(linux.total).toBe(Hub.all.length - onlyWin32.length)
})

test("absent tools with no package manager for the platform leave install undefined", () => {
  // Deterministic on this Linux box: planFor("win32") probes winget, scoop and
  // choco through the real which(), and none of those binaries exist on PATH.
  const status = hubRegistryStatus({ platform: "win32", probe: () => false })
  expect(status.missing.length).toBeGreaterThan(0)
  expect(status.missing.some((entry) => entry.tool === "rg")).toBe(true)
  expect(status.ready).toBeLessThan(status.total)
  expect(status.install).toBeUndefined()
  expect(status.terminals.every((terminal) => terminal.present)).toBe(false)
})

test("tools the package manager cannot provide are not offered", () => {
  const probe = (tool: string) => tool !== "apt-cache" && tool !== "dpkg-query"
  const pacman = hubRegistryStatus({ platform: "linux", probe, manager: "pacman" })
  expect(pacman.tools.map((row) => row.tool)).not.toContain("apt-cache")
  expect(pacman.missing).toEqual([])
  expect(pacman.ready).toBe(pacman.total)
  // on Debian the same tools stay installable
  const apt = hubRegistryStatus({ platform: "linux", probe, manager: "apt" })
  expect(apt.missing.map((entry) => entry.tool).sort()).toEqual(["apt-cache", "dpkg-query"])
})
