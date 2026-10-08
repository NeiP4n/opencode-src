import { createSocket } from "node:dgram"
import { networkInterfaces } from "node:os"
import { OpenCode } from "./promise/index.js"
import { PORT, QUERY, decodeReply } from "@opencode/protocol/room-discovery"

export type FoundRoom = {
  readonly id: string
  readonly name: string
  readonly host: string
  readonly url: string
}

const LISTEN_MS = 1200
const LIST_TIMEOUT_MS = 2000

// Rooms shared by other computers on the local network. Broadcasts reach the
// same Wi-Fi or LAN only; rooms over a VPN such as Radmin are joined by address.
export async function scanRooms(): Promise<FoundRoom[]> {
  const servers = await findServers()
  const lists = await Promise.all(
    servers.map((server) =>
      OpenCode.make({ baseUrl: server.url })
        .room.public({ signal: AbortSignal.timeout(LIST_TIMEOUT_MS) })
        .then((list) => list.rooms.map((room) => ({ id: room.id, name: room.name, host: list.host, url: server.url })))
        .catch(() => []),
    ),
  )
  return lists.flat()
}

function findServers() {
  const own = new Set(addresses().map((item) => item.address))
  return new Promise<{ url: string }[]>((resolve) => {
    const found = new Set<string>()
    const socket = createSocket("udp4")
    const finish = () => {
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.close()
      resolve([...found].map((url) => ({ url })))
    }
    // A socket error ends the scan early with whatever answered so far.
    const timer = setTimeout(finish, LISTEN_MS)
    socket.once("error", finish)
    socket.on("message", (message, peer) => {
      const reply = decodeReply(message.toString())
      if (reply && !own.has(peer.address)) found.add(`http://${peer.address}:${reply.port}`)
    })
    socket.bind(0, () => {
      socket.setBroadcast(true)
      for (const target of new Set(["255.255.255.255", ...addresses().map((item) => item.broadcast)]))
        socket.send(QUERY, PORT, target)
    })
  })
}

// IPv4 addresses of this machine with the broadcast address of their subnet.
function addresses() {
  return Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => {
      const address = item.address.split(".").map(Number)
      const mask = item.netmask.split(".").map(Number)
      return {
        address: item.address,
        broadcast: address.map((part, index) => (part | (~mask[index] & 255)) & 255).join("."),
      }
    })
}
