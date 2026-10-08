export * as ServerRoomDiscovery from "./room-discovery"

import { createSocket } from "node:dgram"
import { hostname } from "node:os"
import { Effect } from "effect"
import { PORT, QUERY, encodeReply } from "@opencode/protocol/room-discovery"

// Answers guests looking for rooms on the local network with this machine's
// name and HTTP port. Several servers on one machine share the UDP port, and a
// port already taken by something else only costs discovery, never the server.
export const respond = (httpPort: number) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const socket = createSocket({ type: "udp4", reuseAddr: true })
      socket.on("message", (message, peer) => {
        if (message.toString() !== QUERY) return
        socket.send(encodeReply({ name: hostname(), port: httpPort }), peer.port, peer.address)
      })
      socket.on("error", () => socket.close())
      socket.bind(PORT)
      return socket
    }),
    (socket) => Effect.sync(() => socket.close()),
  )
