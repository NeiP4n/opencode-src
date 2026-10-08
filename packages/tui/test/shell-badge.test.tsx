import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test("each command block names the shell that ran it", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const session = {
    id: "ses_badges",
    title: "Shell badges",
    projectID: "project",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const tool = (id: string, name: string, input: Record<string, unknown>, metadata: Record<string, unknown>) => ({
    type: "tool",
    id,
    name,
    state: { status: "completed", input, content: [{ type: "text", text: "ok" }], metadata },
    time: { created: 1, completed: 2 },
  })
  const messages = [
    { id: "user-0", type: "user", text: "Run commands", time: { created: 0 } },
    {
      id: "assistant-0",
      type: "assistant",
      agent: "build",
      model: { providerID: "test", id: "test" },
      content: [
        tool("shell-1", "shell", { command: "echo plain" }, { shell: "zsh", exit: 0 }),
        tool("hub-1", "hub", { id: "search.content" }, { hubID: "search.content", backend: "nu", command: "rg x" }),
      ],
      time: { created: 1, completed: 2 },
    },
  ]
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages.toReversed(), cursor: {} })
    if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
    if (url.pathname === `/api/session/${session.id}/permission`) return json({ data: [] })
    return undefined
  }, createEventStream())
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({ animations: false, tabs: { mode: "off" } }),
        update: async () => ({}),
      },
      packages: { prepare: async () => ({ directory: "" }) },
      args: { sessionID: session.id },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    const frame = await setup.waitForFrame((frame) => frame.includes("echo plain") && frame.includes("rg x"))
    const lines = frame.split("\n")
    // the badge sits on the command block itself: the plain command shows the regular shell,
    // the hub command shows the terminal the operator picked
    const plain = lines.findIndex((line) => line.includes("echo plain"))
    const hub = lines.findIndex((line) => line.includes("rg x"))
    // on the command's own line, at its right edge
    expect(lines[plain].trimEnd()).toEndWith("zsh")
    expect(lines[hub].trimEnd()).toEndWith("HUB:search.content · nu")
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop()
  }
})
