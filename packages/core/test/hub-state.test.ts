import { describe, expect, test } from "bun:test"
import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "path"
import { Hub } from "@opencode/core/hub/index"
import { tmpdir } from "./fixture/tmpdir"

describe("Hub tool enable state", () => {
  test("missing file defaults to version 1 with nothing enabled", async () => {
    await using tmp = await tmpdir()

    const state = await Hub.read({ directory: tmp.path })

    expect(state.version).toBe(1)
    expect(state.enabled["search.content"] ?? false).toBe(false)
  })

  test("setEnabled reads back both directions and touches only one id", async () => {
    await using tmp = await tmpdir()

    await Hub.setEnabled("search.content", true, { directory: tmp.path })
    expect((await Hub.read({ directory: tmp.path })).enabled["search.content"]).toBe(true)

    await Hub.setEnabled("search.content", false, { directory: tmp.path })
    expect((await Hub.read({ directory: tmp.path })).enabled["search.content"]).toBe(false)

    await Hub.setEnabled("docker.compose-up", true, { directory: tmp.path })
    const state = await Hub.read({ directory: tmp.path })
    expect(state.enabled["docker.compose-up"]).toBe(true)
    expect(state.enabled["search.content"]).toBe(false)

    // temp+rename: nothing but the state file is left behind
    expect(await readdir(tmp.path)).toEqual(["hub.json"])
    expect(JSON.parse(await readFile(path.join(tmp.path, "hub.json"), "utf8")).version).toBe(1)
  })

  test("corrupt JSON falls back to the default instead of throwing", async () => {
    await using tmp = await tmpdir()
    await writeFile(path.join(tmp.path, "hub.json"), "{ not json ]")

    expect(await Hub.read({ directory: tmp.path })).toEqual({ version: 1, enabled: {} })
  })

  test("foreign shape and stale version fall back to the default", async () => {
    await using tmp = await tmpdir()
    await writeFile(path.join(tmp.path, "hub.json"), JSON.stringify({ version: 2, enabled: { a: "yes" } }))

    expect(await Hub.read({ directory: tmp.path })).toEqual({ version: 1, enabled: {} })
  })
})
