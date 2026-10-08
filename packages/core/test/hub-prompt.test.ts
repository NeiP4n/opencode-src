import { describe, expect, test } from "bun:test"
import { renderHubHints } from "@opencode/core/hub/prompt"
import type { State } from "@opencode/core/hub/state"
import { Hub } from "@opencode/core/hub/index"

const stateOf = (enabled: Record<string, boolean>): State => ({ version: 1, enabled })

describe("renderHubHints", () => {
  test("enabled and available tool shows purpose, template, header and terminals", () => {
    const text = renderHubHints({
      state: stateOf({ mlr: true }),
      availability: ["mlr"],
      terminals: ["bash"],
    })
    expect(text).toContain("- mlr —")
    expect(text).toContain("Show the first N rows with headers aligned")
    expect(text).toContain("mlr --icsv --opprint")
    expect(text).toContain("инструмент hub")
    expect(text).toContain("Терминалы: bash")
  })

  test("disabled tool produces nothing at all", () => {
    const text = renderHubHints({ state: stateOf({ mlr: false }), availability: ["mlr"] })
    expect(text).toBe("")
  })

  test("enabled but unavailable tool produces nothing", () => {
    const text = renderHubHints({ state: stateOf({ mlr: true }), availability: ["jq"] })
    expect(text).toBe("")
  })

  test("empty state produces nothing — prompt stays byte-identical", () => {
    expect(renderHubHints({ state: stateOf({}), availability: ["mlr"] })).toBe("")
  })

  test("block stays within 40 lines and 2000 characters with an explicit marker", () => {
    const enabled: Record<string, boolean> = {}
    const availability: string[] = []
    for (let i = 0; i < 200; i++) {
      enabled[`tool${i}`] = true
      availability.push(`tool${i}`)
    }
    const text = renderHubHints({ state: stateOf(enabled), availability })
    expect(text.length).toBeLessThanOrEqual(2000)
    expect(text.split("\n").length).toBeLessThanOrEqual(40)
    expect(text).toContain("инструментов — подробности")
  })

  test("terminals line appears only when terminals are given", () => {
    const without = renderHubHints({ state: stateOf({ mlr: true }), availability: ["mlr"] })
    expect(without).not.toContain("Терминалы:")
    const withTerminals = renderHubHints({
      state: stateOf({ mlr: true }),
      availability: ["mlr"],
      terminals: ["bash", "nu"],
    })
    expect(withTerminals).toContain("Терминалы: bash, nu")
  })

  test("eligible tools are listed in sorted order", () => {
    const text = renderHubHints({
      state: stateOf({ mlr: true, rg: true, jq: true }),
      availability: ["mlr", "rg", "jq"],
    })
    const order = text.split("\n").filter((line) => line.startsWith("- "))
    expect(order[0]?.startsWith("- jq")).toBe(true)
    expect(order[1]?.startsWith("- mlr")).toBe(true)
    expect(order[2]?.startsWith("- rg")).toBe(true)
  })

  test.skipIf(process.platform === "win32")("entries for another OS stay out of the hints", () => {
    const windows = Hub.get("windows.processes")!
    const text = renderHubHints({ state: stateOf({ pwsh: true }), availability: ["pwsh"] })
    expect(text).not.toContain(windows.description)
  })
})
