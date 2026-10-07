import { describe, expect, test } from "bun:test"
import { Hub } from "@opencode/core/hub/index"

describe("Tool Hub", () => {
  test("catalog has unique ids across categories", () => {
    const ids = Hub.all.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThan(100)
  })

  test("categories cover the required backends", () => {
    const cats = Hub.categories()
    for (const expected of ["search", "files", "text", "json", "data", "git", "docker", "systemd", "process", "network", "system", "windows"]) {
      expect(cats).toContain(expected)
    }
  })

  test("prepare renders placeholders and picks bash fallback", () => {
    const entry = Hub.get("search.content")
    expect(entry).toBeDefined()
    const rendered = Hub.prepare(entry!, { pattern: "TODO", path: "." })
    expect(rendered.backend).toBe("bash")
    expect(rendered.command).toBe("rg --line-number --no-heading TODO .")
  })

  test("prepare fails fast on missing required args", () => {
    const entry = Hub.get("search.content")!
    expect(() => Hub.prepare(entry, { pattern: "TODO" })).toThrow()
  })

  test("optional placeholders render empty", () => {
    const entry = Hub.get("docker.compose-up")!
    const rendered = Hub.prepare(entry, {})
    expect(rendered.command).toBe("docker compose up -d ")
  })

  test("rewrite upgrades grep -r to rg when available", () => {
    const hit = Hub.rewrite("grep -r TODO .", (tool) => tool === "rg")
    expect(hit?.id).toBe("search.content")
    expect(hit?.command).toBe("rg --line-number --no-heading TODO .")
  })

  test("rewrite refuses when the target tool is missing", () => {
    expect(Hub.rewrite("grep -r TODO .", () => false)).toBeUndefined()
  })

  test("rewrite refuses compound commands", () => {
    expect(Hub.rewrite("grep -r TODO . && echo done", () => true)).toBeUndefined()
  })

  test("rewrite upgrades cat-file-jq to the pretty entry", () => {
    const hit = Hub.rewrite("cat data.json | jq .", (tool) => tool === "jq")
    expect(hit?.id).toBe("json.pretty")
  })

  test("danger entries never get silent allow", () => {
    const dangerous = Hub.all.filter((entry) => entry.danger === true).map((entry) => entry.id)
    expect(dangerous).toContain("files.remove")
    expect(dangerous).toContain("docker.prune")
    expect(dangerous).toContain("process.kill-force")
  })

  test("install planner returns undefined when no manager exists", () => {
    const plan = Hub.planFor(["rg"], "win32", "/nonexistent-bin-dir")
    expect(plan).toBeUndefined()
  })

  test("windows entries are platform-gated", () => {
    const entry = Hub.get("windows.processes")!
    expect(Hub.supportsPlatform(entry, "win32")).toBe(true)
    expect(Hub.supportsPlatform(entry, "linux")).toBe(false)
    expect(() => Hub.prepare(entry, { limit: "5" }, { platform: "linux" })).toThrow()
  })
})
