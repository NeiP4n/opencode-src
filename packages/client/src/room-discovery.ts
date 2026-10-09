import { createSocket } from "node:dgram"
import { networkInterfaces } from "node:os"
import { OpenCode } from "./promise/index.js"
import { PORT, QUERY, REPLY_PORT, decodeReply } from "@opencode/protocol/room-discovery"

export type FoundRoom = {
  readonly id: string
  readonly name: string
  readonly host: string
  readonly url: string
  // Joined without a code.
  readonly open: boolean
}

// UDP ports a firewall must open for discovery: hosts listen on the first, guests on the second.
export const DISCOVERY_PORTS = [PORT, REPLY_PORT] as const

const LISTEN_MS = 1200
const LIST_TIMEOUT_MS = 2000

// Rooms shared by other computers on the local network. Broadcasts reach the
// same Wi-Fi or LAN only; rooms over a VPN such as Radmin are joined by address.
export async function scanRooms(): Promise<FoundRoom[]> {
  const servers = await findServers()
  const lists = await Promise.all(servers.map((server) => listRooms(server.url).catch(() => [])))
  return lists.flat()
}

// Rooms one host shares, for an address typed by hand when broadcasts do not get through.
export async function listRooms(url: string): Promise<FoundRoom[]> {
  const list = await OpenCode.make({ baseUrl: url }).room.public({ signal: AbortSignal.timeout(LIST_TIMEOUT_MS) })
  return list.rooms.map((room) => ({ id: room.id, name: room.name, host: list.host, url, open: room.open }))
}

function findServers() {
  const own = new Set(addresses().map((item) => item.address))
  return new Promise<{ url: string }[]>((resolve) => {
    const found = new Set<string>()
    const socket = createSocket({ type: "udp4", reuseAddr: true })
    const finish = () => {
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.close()
      resolve([...found].map((url) => ({ url })))
    }
    const timer = setTimeout(finish, LISTEN_MS)
    socket.on("message", (message, peer) => {
      const reply = decodeReply(message.toString())
      if (reply && !own.has(peer.address)) found.add(`http://${peer.address}:${reply.port}`)
    })
    // A socket error ends the scan early with whatever answered so far.
    socket.once("error", finish)
    socket.bind(REPLY_PORT, () => {
      socket.setBroadcast(true)
      // Every subnet separately: Windows sends 255.255.255.255 out of one adapter only,
      // often a VPN or virtual switch rather than the LAN.
      for (const target of new Set(["255.255.255.255", ...addresses().map((item) => item.broadcast)]))
        socket.send(QUERY, PORT, target, () => {})
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
