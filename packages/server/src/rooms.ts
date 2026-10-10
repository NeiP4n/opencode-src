export * as ServerRooms from "./rooms"

import { Cache, Context, Duration, Effect, Layer, Option } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Room } from "@opencode/schema/room"
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto"
import type { ServerAuth } from "./auth"

// Join codes stay valid until they expire so several devices can join with the
// one code the host reads out; the host issues a new code to stop admissions.
const CODE_TTL = Duration.minutes(10)
// Unambiguous characters only, so a code read aloud or typed on a phone survives.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const CODE_LENGTH = 8
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

export interface Interface {
  readonly issueCode: (roomID: Room.ID) => Effect.Effect<Room.JoinCode>
  readonly redeemCode: (code: string) => Effect.Effect<Room.ID | undefined>
  // Presence lives in memory: every guest request marks its guest as seen.
  readonly touch: (guestID: string) => void
  readonly seen: (guestID: string) => number | undefined
}

// Guests poll every couple of seconds, so a longer silence means they left.
export const ONLINE_MS = 15_000

export class Service extends Context.Service<Service, Interface>()("@opencode/ServerRooms") {}

const noLookup = () => Effect.die(new Error("ServerRooms cache must be used via set/getOption, never get"))

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const codes = yield* Cache.make<string, Room.ID>({ capacity: 1_000, lookup: noLookup, timeToLive: CODE_TTL })
    const presence = new Map<string, number>()
    return Service.of({
      touch: (guestID) => void presence.set(guestID, Date.now()),
      seen: (guestID) => presence.get(guestID),
      issueCode: Effect.fn("ServerRooms.issueCode")(function* (roomID) {
        const code = Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")
        yield* Cache.set(codes, code, roomID)
        return { code: `${code.slice(0, 4)}-${code.slice(4)}`, expires_in: Duration.toSeconds(CODE_TTL) }
      }),
      redeemCode: Effect.fn("ServerRooms.redeemCode")(function* (code) {
        return Option.getOrUndefined(yield* Cache.getOption(codes, code.toUpperCase().replace(/[^A-Z0-9]/g, "")))
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

export type GuestToken = {
  readonly roomID: Room.ID
  readonly guest: Room.Guest
}

// Guest tokens are signed with a key derived from the server password, so
// rotating the password revokes every guest. A server without a password is
// loopback-only; it signs with a per-process key and guests rejoin after a restart.
const fallbackKey = randomBytes(32).toString("hex")

export function issueToken(config: ServerAuth.Info, roomID: Room.ID, name: string, now = Date.now()) {
  const expires = String(Math.floor(now / 1000) + TOKEN_TTL_SECONDS)
  const guest = randomBytes(9).toString("base64url")
  const payload = [roomID, guest, expires, Buffer.from(name).toString("base64url")].join(".")
  return {
    token: `${payload}.${sign(config, payload)}`,
    guest: { id: guest, name },
  }
}

export function verifyToken(config: ServerAuth.Info, token: string, now = Date.now()): GuestToken | undefined {
  const parts = token.split(".")
  if (parts.length !== 5) return
  const expected = Buffer.from(sign(config, parts.slice(0, 4).join(".")))
  const actual = Buffer.from(parts[4])
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return
  const expires = Number(parts[2])
  if (!Number.isSafeInteger(expires) || expires * 1000 <= now) return
  return {
    roomID: Room.ID.make(parts[0]),
    guest: { id: parts[1], name: Buffer.from(parts[3], "base64url").toString() },
  }
}

function sign(config: ServerAuth.Info, payload: string) {
  const secret = Option.getOrElse(config.password, () => fallbackKey)
  const key = createHmac("sha256", secret).update("opencode-room-v1").digest()
  return createHmac("sha256", key).update(payload).digest("base64url")
}
