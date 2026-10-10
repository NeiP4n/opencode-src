import { SessionMessage } from "@opencode/core/session/message"
import { Session } from "@opencode/core/session"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { InvalidCursorError } from "@opencode/protocol/errors"
import type { SessionMessagesQuery } from "@opencode/protocol/groups/message"
import { failedMessageDecode, missingSession } from "./session-error"

const DefaultMessagesLimit = 50

const Cursor = Schema.Struct({
  id: SessionMessage.ID,
  order: Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")]),
  direction: Schema.Union([Schema.Literal("previous"), Schema.Literal("next")]),
})

const decodeCursor = Schema.decodeUnknownSync(Cursor)

const cursor = {
  encode(message: SessionMessage.Info, order: "asc" | "desc", direction: "previous" | "next") {
    return Buffer.from(JSON.stringify({ id: message.id, order, direction })).toString("base64url")
  },
  decode(input: string) {
    return decodeCursor(JSON.parse(Buffer.from(input, "base64url").toString("utf8")))
  },
}

export const MessageHandler = HttpApiBuilder.group(Api, "server.message", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service

    return handlers.handle("session.messages", (ctx) => messagePage(session, ctx.params.sessionID, ctx.query))
  }),
)

// One page of a session's messages; room guests read their shared session through it too.
export const messagePage = Effect.fnUntraced(function* (
  session: Session.Interface,
  sessionID: Session.ID,
  query: typeof SessionMessagesQuery.Type,
) {
  if (query.cursor && query.order !== undefined)
    return yield* new InvalidCursorError({ message: "Cursor cannot be combined with order" })
  const decoded = yield* Effect.try({
    try: () => (query.cursor ? cursor.decode(query.cursor) : undefined),
    catch: () => new InvalidCursorError({ message: "Invalid cursor" }),
  })
  const order = decoded?.order ?? query.order ?? "desc"
  const messages = yield* session
    .messages({
      sessionID,
      limit: query.limit ?? DefaultMessagesLimit,
      order,
      type: query.type,
      cursor: decoded ? { id: decoded.id, direction: decoded.direction } : undefined,
    })
    .pipe(
      Effect.catchTag("Session.NotFoundError", missingSession),
      Effect.catchTag("Session.MessageDecodeError", failedMessageDecode),
    )
  const first = messages[0]
  const last = messages.at(-1)
  return {
    data: messages,
    cursor: {
      previous: first ? cursor.encode(first, order, "previous") : undefined,
      next: last ? cursor.encode(last, order, "next") : undefined,
    },
  }
})
