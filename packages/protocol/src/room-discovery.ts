// Finding rooms on the local network. A guest broadcasts QUERY over UDP to PORT;
// every opencode server that listens beyond loopback answers with its machine
// name and HTTP port. The guest then reads the room names from /api/room/public
// on each answering address. Joining still needs the code the host hands out.

import { Option, Schema } from "effect"

export const PORT = 41499
export const QUERY = "opencode-rooms?"

const ReplySchema = Schema.Struct({ name: Schema.String, port: Schema.Int })
export type Reply = typeof ReplySchema.Type

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(ReplySchema))

export function encodeReply(reply: Reply) {
  return JSON.stringify({ v: 1, ...reply })
}

export function decodeReply(text: string) {
  return Option.getOrUndefined(decode(text))
}
