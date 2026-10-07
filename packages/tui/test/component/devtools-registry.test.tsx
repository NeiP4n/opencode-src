/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { Hub } from "@opencode/core/hub/index"
import { HubState } from "@opencode/core/hub/state"
import { RegistryPanel, type RegistryPanelOptions } from "../../src/component/devtools-registry"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { Toast, ToastProvider } from "../../src/ui/toast"
import { hubRegistryStatus } from "../../src/util/hub-registry"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

// rg is absent so the first row carries an install button; every other catalog
// tool resolves, so the rest of the page carries remove buttons.
const probe = (tool: string) => tool !== "rg"

async function render(options: RegistryPanelOptions) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Keymap.Provider>
              <ToastProvider>
                {/* the bar sits on the bottom row in production, so the panel grows upward from there */}
                <box width="100%" height="100%" flexDirection="column">
                  <box flexGrow={1} />
                  <box position="relative" height={1}>
                    <RegistryPanel options={options} />
                  </box>
                </box>
                <Toast />
              </ToastProvider>
            </Keymap.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 90, height: 44, kittyKeyboard: true },
  )
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Registry") && frame.includes("Tools"))
  return app
}

// The click handler persists in the background while the switch updates
// optimistically, so assertions wait for the durable value to catch up.
async function untilEnabled(directory: string, tool: string, expected: boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await HubState.read({ directory })).enabled[tool] === expected) return true
    await Bun.sleep(10)
  }
  return false
}

// Value of a label/value row. Rows stretch their value to the right edge, so
// the rendered text between label and value is padding and cannot be matched.
function rowValue(frame: string, label: string) {
  const line = frame.split("\n").find((candidate) => candidate.includes(label))
  return line?.trim().slice(label.length).trim()
}

// Cell of `needle` on the row naming `tool`: the tool's own row carries both —
// a category line or a header may contain the name too, so one line must match.
function cell(app: Awaited<ReturnType<typeof render>>, tool: string, needle: string) {
  const lines = app.captureCharFrame().split("\n")
  const row = lines.findIndex((line) => line.includes(tool) && line.includes(needle))
  if (row < 0) throw new Error(`no row for ${tool} with ${needle}`)
  const column = lines[row].indexOf(needle)
  if (column < 0) throw new Error(`no ${needle} on the ${tool} row`)
  return { x: column, y: row }
}

test("registry panel shows readiness, terminals and a paged tool list", async () => {
  await using tmp = await tmpdir()
  const status = hubRegistryStatus({ probe })
  const app = await render({ probe, directory: tmp.path })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Registry")
    expect(frame).toContain("Ready")
    expect(frame).toContain(`${status.ready}/${status.total}`)
    expect(frame).toContain("Terminals")
    expect(frame).toContain("bash")
    // stage-8 sections survive the button rework
    expect(frame).toContain("Categories")
    expect(frame).toContain(`${status.categories[0].name} `)
    expect(frame).toContain("Tools")
    // the hint block is opt-in: a fresh state file advertises nothing
    expect(rowValue(frame, "For the model")).toBe(`0/${status.tools.length}`)
    expect(status.tools.length).toBeGreaterThan(10)
    expect(frame).toContain("1/")
    // first page is the ten most actionable rows, absent tools first
    expect(frame).toContain(status.tools[0].tool)
    expect(app.captureCharFrame()).toContain("Install")
    expect(app.captureCharFrame()).toContain("Rm")
  } finally {
    app.renderer.destroy()
  }
})

test("install button runs the action and refreshes the row", async () => {
  await using tmp = await tmpdir()
  const calls: string[] = []
  const app = await render({
    probe,
    directory: tmp.path,
    install: async (tool) => {
      calls.push(tool)
      return { ok: true, exit: 0, output: "", command: `install ${tool}` }
    },
  })
  try {
    const target = hubRegistryStatus({ probe }).tools.find((row) => !row.installed)
    expect(target?.tool).toBe("rg")
    const { x, y } = cell(app, target!.tool, "Install")
    await app.mockMouse.click(x, y)
    await app.waitForFrame((frame) => frame.includes("rg installed"))
    expect(calls).toEqual(["rg"])
    // the row stays actionable after the refresh rather than freezing on a spinner
    expect(app.captureCharFrame()).not.toContain("…")
  } finally {
    app.renderer.destroy()
  }
})

test("a pending install shows the pending marker until the result arrives", async () => {
  await using tmp = await tmpdir()
  let release!: (value: Hub.ActionResult) => void
  const gate = new Promise<Hub.ActionResult>((resolve) => {
    release = resolve
  })
  const app = await render({ probe, directory: tmp.path, install: () => gate })
  try {
    const { x, y } = cell(app, "rg", "Install")
    await app.mockMouse.click(x, y)
    await app.waitForFrame((frame) => frame.includes("…"))
    release({ ok: true, exit: 0, output: "", command: "install rg" })
    await app.waitForFrame((frame) => frame.includes("rg installed"))
    expect(app.captureCharFrame()).not.toContain("…")
  } finally {
    app.renderer.destroy()
  }
})

test("failed install shows the command in the note and the reason in a toast", async () => {
  await using tmp = await tmpdir()
  const app = await render({
    probe,
    directory: tmp.path,
    install: async () => ({
      ok: false,
      exit: 100,
      output: "sudo apt-get install -y ripgrep\nE: Could not open lock file",
      command: "sudo apt-get install -y ripgrep",
    }),
  })
  try {
    const { x, y } = cell(app, "rg", "Install")
    await app.mockMouse.click(x, y)
    // the toast carries the manager's own reason for the failure
    await app.waitForFrame((frame) => frame.includes("E: Could not open lock file"))
    const frame = app.captureCharFrame()
    // the persistent note pins the exact command to rerun by hand
    expect(frame).toContain("rg: sudo apt-get install -y ripgrep")
    expect(frame).not.toContain("rg installed")
  } finally {
    app.renderer.destroy()
  }
})

test("remove needs a second click on the same button before it runs", async () => {
  await using tmp = await tmpdir()
  const calls: string[] = []
  const app = await render({
    probe,
    directory: tmp.path,
    remove: async (tool) => {
      calls.push(tool)
      return { ok: true, exit: 0, output: "", command: `remove ${tool}` }
    },
  })
  try {
    const target = hubRegistryStatus({ probe }).tools.find((row) => row.installed)
    expect(target).toBeDefined()
    const { x, y } = cell(app, target!.tool, "Rm")
    await app.mockMouse.click(x, y)
    await app.waitForFrame((frame) => frame.includes("Remove?"))
    // the first click only armed the button
    expect(calls).toEqual([])
    // the pointer never left the button, so the second click executes
    await app.mockMouse.click(x, y)
    await app.waitForFrame((frame) => frame.includes(`${target!.tool} removed`))
    expect(calls).toEqual([target!.tool])
  } finally {
    app.renderer.destroy()
  }
})

test("the switch turns a tool on for the model and writes it to hub.json", async () => {
  await using tmp = await tmpdir()
  const app = await render({ probe, directory: tmp.path })
  try {
    const tools = hubRegistryStatus({ probe }).tools
    const first = tools[0].tool
    const { x, y } = cell(app, first, "[off]")
    await app.mockMouse.click(x, y)
    await app.waitForFrame((frame) => rowValue(frame, "For the model") === `1/${tools.length}`)
    expect(cell(app, first, "[on]").y).toBe(y)
    expect(await untilEnabled(tmp.path, first, true)).toBe(true)

    // switching it off again withdraws it from the hint block and the listing
    const off = cell(app, first, "[on]")
    await app.mockMouse.click(off.x, off.y)
    await app.waitForFrame((frame) => rowValue(frame, "For the model") === `0/${tools.length}`)
    expect(await untilEnabled(tmp.path, first, false)).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

test("pager moves to the second page of tools", async () => {
  await using tmp = await tmpdir()
  const app = await render({ probe, directory: tmp.path })
  try {
    const status = hubRegistryStatus({ probe })
    const secondPage = status.tools[10].tool
    await app.waitForFrame((frame) => !frame.includes(secondPage))
    const { x, y } = cell(app, "Tools", "›")
    await app.mockMouse.click(x, y)
    await app.waitForFrame((frame) => frame.includes(secondPage))
    expect(app.captureCharFrame()).toContain("2/")
  } finally {
    app.renderer.destroy()
  }
})

test("every catalog tool gets exactly one row", async () => {
  await using tmp = await tmpdir()
  const status = hubRegistryStatus({ probe })
  const required = new Set(Hub.all.filter((entry) => Hub.supportsPlatform(entry)).flatMap((entry) => entry.requires ?? []))
  expect(status.tools.map((row) => row.tool).sort()).toEqual([...required].sort())
  expect(new Set(status.tools.map((row) => row.tool)).size).toBe(status.tools.length)
  // installed/missing stays a partition of the same set
  expect(new Set([...status.installed, ...status.missing.map((entry) => entry.tool)])).toEqual(required)
})
