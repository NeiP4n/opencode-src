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
  const bar = await setup.waitForFrame((frame) => frame.includes("Host") && frame.includes("Connect"))
  const entry = cell(bar, "Host")
  await setup.mockMouse.click(entry.x, entry.y)
  const frame = await setup.waitForFrame((frame) => frame.includes("Get join code"))
  // only addresses other devices can reach, not loopback or container bridges
  expect(frame).toContain("192.168.1.5:4096")
  expect(frame).toContain("26.10.0.2:4096")
  expect(frame).not.toContain("172.17.0.1")
  expect(frame).not.toContain("198.18.0.1")
  expect(frame).not.toContain("Join with address")

  const button = cell(frame, "Get join code")
  await setup.mockMouse.click(button.x + 2, button.y)
  const issued = await setup.waitForFrame((frame) => frame.includes("ABCD-EFGH  valid until"))
  expect(issued).toContain("On the other device open Connect")
})

test("Connect searches the network in its own window and offers manual entry", async () => {
  await using state = await tmpdir()
  await using setup = await render(state.path)
  const bar = await setup.waitForFrame((frame) => frame.includes("Connect"))
  const entry = cell(bar, "Connect")
  await setup.mockMouse.click(entry.x, entry.y)
  const frame = await setup.waitForFrame((frame) => frame.includes("Join with address and code"))
  expect(frame).toContain("Rooms on this network")
  expect(frame).toContain("[ Search again ]")
  expect(frame).toContain("Your name")
  expect(frame).not.toContain("VPN")
  expect(frame).not.toContain("Get join code")
})
