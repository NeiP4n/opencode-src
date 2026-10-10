import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const room = { id: "room_lab", sessionID: "ses_lab", name: "Lab", ai: "linked", guestApprovals: false, created: 0 }

function cell(frame: string, needle: string) {
  const lines = frame.split("\n")
  const y = lines.findLastIndex((line) => line.includes(needle))
  if (y < 0) throw new Error(`no ${needle} on screen`)
  return { x: lines[y].indexOf(needle), y }
}

async function render(state: string) {
  return createAppFixture({
    width: 130,
    height: 40,
    state,
    config: { animations: false, debug: { devtools: true } },
    fetch: (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/info")
        return json({
          version: "test",
          pid: 1,
          urls: [
            "http://127.0.0.1:4096",
            "http://192.168.1.5:4096",
            "http://172.17.0.1:4096",
            "http://198.18.0.1:4096",
            "http://26.10.0.2:4096",
          ],
          paths: { tmp: "/tmp" },
        })
      if (url.pathname === "/api/room") return json({ data: [room] })
      if (url.pathname === `/api/room/${room.id}/code` && request.method === "POST")
        return json({ code: "ABCD-EFGH", expires_in: 600 })
    },
  })
}

test("Host lists reachable addresses and hands out a join code", async () => {
  await using state = await tmpdir()
  await using setup = await render(state.path)
  const bar = await setup.waitForFrame((frame) => frame.includes("+ Host") && frame.includes("+ Connect"))
  const entry = cell(bar, "+ Host")
  await setup.mockMouse.click(entry.x, entry.y)
  const frame = await setup.waitForFrame((frame) => frame.includes("Get join code"))
  // only addresses other devices can reach, not loopback or container bridges
  expect(frame).toContain("192.168.1.5:4096")
  expect(frame).toContain("26.10.0.2:4096")
  expect(frame).not.toContain("172.17.0.1")
  expect(frame).not.toContain("198.18.0.1")
  expect(frame).not.toContain("Join by address")
  expect(frame).toContain("[ With a code ]")

  const button = cell(frame, "Get join code")
  await setup.mockMouse.click(button.x + 2, button.y)
  const issued = await setup.waitForFrame((frame) => frame.includes("ABCD-EFGH  expires in"))
  expect(issued).toContain("On the other device open Connect")
})

test("Connect searches the network in its own window and offers manual entry", async () => {
  await using state = await tmpdir()
  await using setup = await render(state.path)
  const bar = await setup.waitForFrame((frame) => frame.includes("+ Connect"))
  const entry = cell(bar, "+ Connect")
  await setup.mockMouse.click(entry.x, entry.y)
  const frame = await setup.waitForFrame((frame) => frame.includes("Join by address"))
  expect(frame).toContain("Rooms on this network")
  expect(frame).toContain("empty if not needed")
  expect(frame).toContain("[ Search again ]")
  expect(frame).toContain("Your name")
  expect(frame).not.toContain("VPN")
  expect(frame).not.toContain("Get join code")
})

const session = {
  id: room.sessionID,
  projectID: "proj_test",
  title: "Lab",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}

const guestPrompt = (id: string, name: string, text: string) => ({
  id,
  type: "user",
  text,
  time: { created: 1 },
  metadata: { room: { id: room.id, guest: { id: `guest_${id}`, name } } },
})

async function renderSession(state: string, input: { rooms: () => unknown[]; onCreate?: () => void }) {
  return createAppFixture({
    width: 170,
    height: 40,
    state,
    args: { sessionID: room.sessionID },
    config: { animations: false, debug: { devtools: true } },
    fetch: (url, request) => {
      if (url.pathname === "/api/info")
        return json({ version: "test", pid: 1, urls: ["http://192.168.1.5:4096"], paths: { tmp: "/tmp" } })
      if (url.pathname === "/api/room" && request.method === "POST") {
        input.onCreate?.()
        return json({ data: room })
      }
      if (url.pathname === "/api/room") return json({ data: input.rooms() })
      if (url.pathname === `/api/room/${room.id}/code` && request.method === "POST")
        return json({ code: "ABCD-EFGH", expires_in: 600 })
      if (url.pathname === `/api/session/${room.sessionID}`) return json({ data: session })
      if (url.pathname === `/api/session/${room.sessionID}/message`)
        return json({
          data: [
            guestPrompt("msg_1", "Alex", "Can you check the tests?"),
            guestPrompt("msg_2", "Sam", "And the docs please"),
            guestPrompt("msg_3", "Alex", "Thanks"),
            { id: "msg_4", type: "user", text: "Host speaking", time: { created: 2 } },
          ],
          cursor: {},
        })
      if (url.pathname === `/api/session/${room.sessionID}/inbox`) return json({ data: [] })
    },
  })
}

test("a hosted session names guest authors and shows a multiplayer indicator that opens Host", async () => {
  await using state = await tmpdir()
  await using setup = await renderSession(state.path, { rooms: () => [room] })
  const frame = await setup.waitForFrame((frame) => frame.includes("⇄ Multiplayer · Lab"))
  expect(frame).toContain("⇄ Multiplayer · Lab · 2 guests")
  expect(frame).toContain("Alex · via room")
  expect(frame).toContain("Sam · via room")

  const indicator = cell(frame, "⇄ Multiplayer · Lab")
  await setup.mockMouse.click(indicator.x + 2, indicator.y)
  const host = await setup.waitForFrame((frame) => frame.includes("Get join code"))
  expect(host).toContain("Only me")
  expect(host).toContain("Who may allow or deny the AI")
  expect(host).toContain("Linked rooms only")
})

test("hosting a session issues a join code at once and shows the indicator", async () => {
  await using state = await tmpdir()
  const rooms: unknown[] = []
  await using setup = await renderSession(state.path, { rooms: () => rooms, onCreate: () => rooms.push(room) })
  const bar = await setup.waitForFrame((frame) => frame.includes("+ Host") && frame.includes("+ Connect"))
  expect(bar).not.toContain("⇄ Multiplayer · Lab")
  const entry = cell(bar, "+ Host")
  await setup.mockMouse.click(entry.x, entry.y)
  const dialog = await setup.waitForFrame((frame) => frame.includes("Host this session"))
  const button = cell(dialog, "Host this session")
  await setup.mockMouse.click(button.x + 2, button.y)
  const issued = await setup.waitForFrame((frame) => /ABCD-EFGH {2}expires in (10:00|9:5\d)/.test(frame))
  expect(issued).toContain("New join code")
  setup.mockInput.pressEscape()
  const closed = await setup.waitForFrame((frame) => !frame.includes("New join code"))
  expect(closed).toContain("⇄ Multiplayer · Lab · 2 guests")
})

test("the Language bar item switches the bar and room windows to Russian and back", async () => {
  await using state = await tmpdir()
  await using setup = await render(state.path)
  const bar = await setup.waitForFrame((frame) => frame.includes("Language EN"))
  const entry = cell(bar, "Language EN")
  await setup.mockMouse.click(entry.x, entry.y)
  const translated = await setup.waitForFrame((frame) => frame.includes("+ Подключиться") && frame.includes("Язык RU"))
  expect(translated).toContain("Спроси что угодно…")
  expect(translated).toContain("команды")
  const connect = cell(translated, "+ Подключиться")
  await setup.mockMouse.click(connect.x, connect.y)
  const dialog = await setup.waitForFrame((frame) => frame.includes("Вход по адресу"))
  expect(dialog).toContain("Комнаты в этой сети")
})

test("a joined room opens in the main area and stays in the left panel under Multiplayer", async () => {
  await using state = await tmpdir()
  const remote = { ...room, id: "room_far", sessionID: "ses_far", name: "Far lab", open: true }
  const host = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/room/public") return json({ host: "studio", rooms: [remote] })
      if (url.pathname === "/api/room/join" && request.method === "POST")
        return json({ token: "token", guest: { id: "guest_1", name: "Bo" }, room: remote })
      if (url.pathname === `/api/room/${remote.id}/guest/message`)
        return json({
          data: [{ id: "msg_1", role: "user", author: "Ann", text: "Hello from far", created: 0 }],
          running: false,
        })
      return new Response(null, { status: 404 })
    },
  })
  try {
    await using setup = await render(state.path)
    const bar = await setup.waitForFrame((frame) => frame.includes("+ Connect"))
    const entry = cell(bar, "+ Connect")
    await setup.mockMouse.click(entry.x, entry.y)
    const dialog = await setup.waitForFrame((frame) => frame.includes("Join by address"))
    const address = cell(dialog, "e.g. 192.168.1.5")
    await setup.mockMouse.click(address.x, address.y)
    await setup.mockInput.typeText(`127.0.0.1:${host.port}`)
    setup.mockInput.pressEnter()

    const joined = await setup.waitForFrame(
      (frame) => frame.includes("Hello from far") && !frame.includes("Join by address"),
    )
    expect(joined).toContain("⇄ Multiplayer · Far lab · host studio")
    // A separate section below the projects: hosted sessions and joined rooms, each marked as multiplayer.
    expect(joined).toMatch(/⇄ Multiplayer +\+ Host \+ Connect/)
    expect(joined).toMatch(/⇄ Lab +hosting/)
    expect(joined).toContain(`⇄ Far lab · 127.0.0.1:${host.port}`)
  } finally {
    await host.stop()
  }
})

test("the classic Windows console gets drawable stand-ins for the panel's symbols", async () => {
  process.env.OPENCODE_BASIC_SYMBOLS = "1"
  try {
    await using state = await tmpdir()
    await using setup = await render(state.path)
    const frame = await setup.waitForFrame((frame) => frame.includes("+ Connect"))
    expect(frame).toContain("↔ Multiplayer")
    expect(frame).not.toContain("⇄")
    expect(frame).toContain("√ Server")
  } finally {
    delete process.env.OPENCODE_BASIC_SYMBOLS
  }
})
