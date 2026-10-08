import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const room = { id: "room_lab", sessionID: "ses_lab", name: "Lab", ai: "linked", guestApprovals: false, created: 0 }

function cell(frame: string, needle: string) {
  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes(needle))
  if (y < 0) throw new Error(`no ${needle} on screen`)
  return { x: lines[y].indexOf(needle), y }
}

test("the rooms dialog separates sharing from joining and shows where to enter a code", async () => {
  await using state = await tmpdir()
  await using setup = await createAppFixture({
    width: 130,
    height: 40,
    state: state.path,
    config: { animations: false, debug: { devtools: true } },
    fetch: (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/info")
        return json({ version: "test", pid: 1, urls: ["http://192.168.1.5:4096"], paths: { tmp: "/tmp" } })
      if (url.pathname === "/api/room") return json({ data: [room] })
      if (url.pathname === `/api/room/${room.id}/code` && request.method === "POST")
        return json({ code: "ABCD-EFGH", expires_in: 600 })
    },
  })

  const bar = await setup.waitForFrame((frame) => frame.includes("Rooms"))
  const entry = cell(bar.split("\n").slice(-3).join("\n"), "Rooms")
  await setup.mockMouse.click(entry.x, bar.split("\n").length - 3 + entry.y)
  const frame = await setup.waitForFrame(
    (frame) => frame.includes("Join a room on another computer") && frame.includes("[ Get join code ]"),
  )
  expect(frame).toContain("Shared from this computer")
  expect(frame).toContain("192.168.1.5:4096")
  expect(frame).toContain("[ Get join code ]")
  expect(frame).toContain("[ Join ]")
  expect(frame).toContain("Rooms you join appear here.")

  const button = cell(frame, "[ Get join code ]")
  await setup.mockMouse.click(button.x + 2, button.y)
  const issued = await setup.waitForFrame((frame) => frame.includes("ABCD-EFGH"))
  expect(issued).toContain("Join code: ABCD-EFGH")
  expect(issued).toContain("On the other device: Rooms, Join a room, then this address and code.")
})
