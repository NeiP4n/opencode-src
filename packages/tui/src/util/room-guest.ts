import { OpenCode, type OpenCodeClient } from "@opencode/client"
import type { JoinedRoom } from "./room"

export function roomClient(room: Pick<JoinedRoom, "url" | "token">) {
  return OpenCode.make({ baseUrl: room.url, headers: { authorization: `Bearer ${room.token}` } })
}

// The shared session as a guest reaches it: the slice of the client API the
// session transcript and the data layer use, answered by the room's guest
// routes. Everything else belongs to the host and rejects, so a component that
// reaches past the slice fails loudly instead of touching this computer's server.
export function guestApi(room: JoinedRoom): OpenCodeClient {
  const remote = roomClient(room)
  const roomID = room.roomID
  const slice = {
    session: {
      get: () => remote.room.guest.get({ roomID }).then((result) => result.session),
      inbox: { list: async () => [] },
      form: { list: async () => [] },
    },
    message: {
      list: (input: { limit?: number; order?: "asc" | "desc"; cursor?: string; type?: string }) =>
        remote.room.guest.session.messages({
          roomID,
          limit: input.limit,
          order: input.order,
          cursor: input.cursor,
          type: input.type as Parameters<typeof remote.room.guest.session.messages>[0]["type"],
        }),
    },
    permission: {
      list: () => remote.room.guest.permission.list({ roomID }),
      reply: (input: { requestID: string; decision: "once" | "always" | "reject"; message?: string }) =>
        remote.room.guest.permission.reply({
          roomID,
          requestID: input.requestID,
          decision: input.decision,
          message: input.message,
        }),
    },
    form: { list: async () => [] },
    event: {
      subscribe: (options?: { signal?: AbortSignal; onActivity?: () => void }) => events(remote, roomID, options),
    },
  }
  // A typed client cannot be assembled from a slice; the proxy stands in for the rest of it.
  return host(slice, "") as unknown as OpenCodeClient
}

// The room log replays the session's history before following it. The data layer
// loads that history itself, so only events after the replay pass through, led by
// the server.connected the connection expects first.
async function* events(
  remote: ReturnType<typeof roomClient>,
  roomID: string,
  options?: { signal?: AbortSignal; onActivity?: () => void },
) {
  const log = remote.room.guest.log({ roomID, follow: true }, options)[Symbol.asyncIterator]()
  for (let item = await log.next(); !item.done; item = await log.next()) {
    if (item.value.type === "log.synced") break
  }
  yield { id: "room", type: "server.connected" as const, data: {} }
  for (let item = await log.next(); !item.done; item = await log.next()) {
    if (item.value.type !== "log.synced") yield item.value
  }
}

function host(target: object, path: string): unknown {
  return new Proxy(target, {
    get(object, key) {
      // Promise resolution probes `then`; the client is not a promise.
      if (typeof key !== "string" || key === "then") return undefined
      const next = path ? `${path}.${key}` : key
      if (key in object) {
        // oxlint-disable-next-line no-restricted-globals -- Proxy forwarding reads the slice by key.
        const value: unknown = Reflect.get(object, key)
        return typeof value === "object" && value !== null ? host(value, next) : value
      }
      return host(missing(next), next)
    },
  })
}

function missing(path: string) {
  return () => Promise.reject(new GuestUnavailable(path))
}

// The data layer refreshes host-wide state such as projects on its own; a guest skips it.
export class GuestUnavailable extends Error {
  constructor(path: string) {
    super(`${path} is not available to room guests`)
  }
}

export function ignoreGuestUnavailable(error: unknown) {
  if (error instanceof GuestUnavailable) return
  console.error("Failed to refresh room data", error)
}
