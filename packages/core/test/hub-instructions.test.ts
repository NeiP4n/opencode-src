import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { HubInstructions } from "@opencode/core/hub/instructions"
import { HubState } from "@opencode/core/hub/state"
import { Instructions } from "@opencode/core/instructions/index"
import { tmpdir } from "./fixture/tmpdir"

// Assembles the prompt text exactly the way request assembly does: read →
// values → renderInitial. Keys whose value observed an absence are skipped,
// so a source with nothing to say must render an empty string.
const rendered = async (list: Instructions.List): Promise<string> => {
  const observed = await Effect.runPromise(Instructions.read(list))
  const values: Record<string, Schema.Json> = {}
  for (const entry of observed) {
    if (typeof entry.value === "string") values[entry.key] = entry.value
  }
  return Instructions.renderInitial(list, values)
}

describe("hub hint instructions source", () => {
  test("enabled and available tool reaches the rendered prompt text", async () => {
    const dir = await tmpdir()
    await HubState.setEnabled("mlr", true, { directory: dir.path })
    const list = HubInstructions.make({ directory: dir.path, availability: ["mlr"], terminals: ["bash"] })
    const text = await rendered(list)
    expect(text).toContain("- mlr —")
    expect(text).toContain("the hub tool")
    expect(text).toContain("Terminals: bash")
  })

  test("empty state contributes nothing — prompt stays byte-identical", async () => {
    const dir = await tmpdir()
    const list = HubInstructions.make({ directory: dir.path, availability: ["mlr"], terminals: ["bash"] })
    expect(await rendered(list)).toBe("")
  })

  test("disabled tool contributes nothing", async () => {
    const dir = await tmpdir()
    await HubState.setEnabled("mlr", false, { directory: dir.path })
    const list = HubInstructions.make({ directory: dir.path, availability: ["mlr"] })
    expect(await rendered(list)).toBe("")
  })

  test("enabled but unavailable tool contributes nothing", async () => {
    const dir = await tmpdir()
    await HubState.setEnabled("mlr", true, { directory: dir.path })
    const list = HubInstructions.make({ directory: dir.path, availability: [] })
    expect(await rendered(list)).toBe("")
  })

  test("changed supersedes the previous list and carries the new block", () => {
    const [source] = HubInstructions.make({ directory: "/nonexistent", availability: [] })
    const text = source.changed("old inventory", "new inventory")
    expect(text).toContain("this list replaces the previous one")
    expect(text).toContain("new inventory")
  })

  test("removed message is non-empty — requireText must not throw", () => {
    const [source] = HubInstructions.make({ directory: "/nonexistent", availability: [] })
    const text = source.removed("old inventory")
    expect((text ?? "").length).toBeGreaterThan(0)
  })
})
