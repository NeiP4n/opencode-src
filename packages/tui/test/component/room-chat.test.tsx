/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { RoomChat } from "../../src/component/room-chat"
import { emptyThemeSource } from "../fixture/fixture"
import { json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const note = {
  name: "release-plan",
  frontmatter: { title: "Release plan", status: "active", tags: [], created: 0, updated: 0 },
  body: "Ship the notes canvas.",
  mtime: 1,
}

test("a guest sees the note the room writes into and reads it without leaving the room", async () => {
  const state = { body: note.body }
  const host = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/room/public") return json({ host: "studio", rooms: [] })
      if (url.pathname === "/api/room/room_lab/guest/message")
        return json({
          data: [{ id: "msg_1", role: "user", author: "Ann", text: "Add the goals", created: 0 }],
          running: false,
          note: { name: note.name, title: "Release plan" },
        })
      if (url.pathname === "/api/room/room_lab/guest/note") return json({ data: { ...note, body: state.body } })
      return new Response(null, { status: 404 })
    },
  })
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Keymap.Provider>
              <RoomChat
                room={{ url: host.url.toString(), roomID: "room_lab", name: "Lab", token: "token", guest: "Bo" }}
              />
            </Keymap.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30 },
  )
  app.renderer.start()
  try {
    const frame = await app.waitForFrame(
      (frame) => frame.includes("Note: Release plan") && frame.includes("Add the goals"),
    )
    expect(frame).toContain("Read note")

    const lines = frame.split("\n")
    const y = lines.findIndex((line) => line.includes("Read note"))
    await app.mockMouse.click(lines[y].indexOf("Read note") + 1, y)
    await app.waitForFrame((frame) => frame.includes("Ship the notes canvas.") && frame.includes("Back to chat"))
    expect(app.captureCharFrame()).not.toContain("Add the goals")

    // Each poll re-reads the open note, so the host AI's edits reach the guest.
    state.body = "Goals written by the host AI."
    await Bun.sleep(1800)
    await app.waitForFrame((frame) => frame.includes("Goals written by the host AI."))
  } finally {
    app.renderer.destroy()
    await host.stop()
  }
})
