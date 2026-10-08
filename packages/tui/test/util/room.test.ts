import { expect, test } from "bun:test"
import { roomAuthor, roomGuests } from "../../src/util/room"

const stamp = (roomID: string, name: string) => ({ room: { id: roomID, guest: { id: `guest_${name}`, name } } })

test("roomAuthor reads the guest the host server stamped on a prompt", () => {
  expect(roomAuthor(stamp("room_lab", "Alex"))).toEqual({ id: "room_lab", guest: { id: "guest_Alex", name: "Alex" } })
})

test("roomAuthor ignores host prompts and malformed room metadata", () => {
  expect(roomAuthor(undefined)).toBeUndefined()
  expect(roomAuthor({ agent: "build" })).toBeUndefined()
  expect(roomAuthor({ room: "room_lab" })).toBeUndefined()
  expect(roomAuthor({ room: { id: "room_lab", guest: { id: "g", name: 42 } } })).toBeUndefined()
})

test("roomGuests counts distinct guest names that posted into the room", () => {
  const messages = [
    { type: "user", metadata: stamp("room_lab", "Alex") },
    { type: "user", metadata: stamp("room_lab", "Sam") },
    { type: "user", metadata: stamp("room_lab", "Alex") },
    // a previous room for the same session, and the host's own prompt
    { type: "user", metadata: stamp("room_old", "Kim") },
    { type: "user" },
    { type: "assistant", metadata: stamp("room_lab", "Robot") },
  ]
  expect(roomGuests(messages, "room_lab")).toBe(2)
  expect(roomGuests(messages, "room_none")).toBe(0)
})
