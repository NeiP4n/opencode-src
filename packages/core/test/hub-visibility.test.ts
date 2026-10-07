import { describe, expect, test } from "bun:test"
import { Hub } from "@opencode/core/hub/index"
import type { State } from "@opencode/core/hub/state"

const stateOf = (enabled: Record<string, boolean>): State => ({ version: 1, enabled })

const entry = (id: string, requires?: readonly string[]): Hub.Entry => ({
  id,
  title: id,
  description: id,
  category: "search",
  ...(requires === undefined ? {} : { requires }),
  templates: { bash: "true" },
})

describe("hub visibility", () => {
  test("nothing is hinted until the operator switches a tool on", () => {
    const state = stateOf({})
    expect(Hub.hinted(state, "rg")).toBe(false)
    expect(Hub.hinted(stateOf({ rg: false }), "rg")).toBe(false)
    expect(Hub.hinted(stateOf({ rg: true }), "rg")).toBe(true)
    // a foreign key never leaks into the hint block
    expect(Hub.hinted(stateOf({ "search.content": true }), "rg")).toBe(false)
  })

  test("an untouched entry stays discoverable and an off switch withdraws it", () => {
    const entryWithRg = entry("search.content", ["rg"])
    expect(Hub.discoverable(stateOf({}), entryWithRg)).toBe(true)
    expect(Hub.discoverable(stateOf({ rg: true }), entryWithRg)).toBe(true)
    expect(Hub.discoverable(stateOf({ rg: false }), entryWithRg)).toBe(false)
  })

  test("an entry with no requirements is never withdrawn", () => {
    const coreutils = entry("files.remove")
    expect(Hub.discoverable(stateOf({ rg: false, fd: false }), coreutils)).toBe(true)
  })

  test("one off tool is enough to withdraw an entry that needs several", () => {
  const multi = entry("data.join", ["mlr", "jq"])
    expect(Hub.discoverable(stateOf({ mlr: true, jq: true }), multi)).toBe(true)
    expect(Hub.discoverable(stateOf({ mlr: true, jq: false }), multi)).toBe(false)
    expect(Hub.discoverable(stateOf({ mlr: true }), multi)).toBe(true)
  })

  test("the catalog default is plain `list` output for a fresh state file", () => {
    const state = stateOf({})
    expect(Hub.all.filter((item) => Hub.discoverable(state, item)).length).toBe(Hub.all.length)
    expect(Hub.all.filter((item) => (item.requires ?? []).some((tool) => Hub.hinted(state, tool))).length).toBe(0)
  })
})
