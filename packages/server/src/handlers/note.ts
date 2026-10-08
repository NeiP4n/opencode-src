import { NoteStore } from "@opencode/core/note"
import {
  InvalidRequestError,
  NoteConflictError,
  NoteNotFoundError,
  ServiceUnavailableError,
} from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const NoteHandler = HttpApiBuilder.group(Api, "server.note", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "note.list",
        Effect.fn(function* () {
          const notes = yield* NoteStore.Service
          return yield* response(notes.list().pipe(Effect.mapError(noteError)))
        }),
      )
      .handle(
        "note.get",
        Effect.fn(function* (ctx) {
          const notes = yield* NoteStore.Service
          return yield* response(notes.get(ctx.params.name).pipe(Effect.mapError(noteError)))
        }),
      )
      .handle(
        "note.bound",
        Effect.fn(function* (ctx) {
          const notes = yield* NoteStore.Service
          return yield* response(
            notes.bound(ctx.params.sessionID).pipe(
              Effect.map((note) => note ?? null),
              Effect.mapError(noteError),
            ),
          )
        }),
      )
      .handle(
        "note.create",
        Effect.fn(function* (ctx) {
          const notes = yield* NoteStore.Service
          return yield* response(notes.create(ctx.payload).pipe(Effect.mapError(noteError)))
        }),
      )
      .handle(
        "note.edit",
        Effect.fn(function* (ctx) {
          const notes = yield* NoteStore.Service
          return yield* response(
            notes.edit({ ...ctx.payload, name: ctx.params.name }).pipe(Effect.mapError(noteError)),
          )
        }),
      )
      .handle(
        "note.update",
        Effect.fn(function* (ctx) {
          const notes = yield* NoteStore.Service
          return yield* response(
            notes.update({ ...ctx.payload, name: ctx.params.name }).pipe(Effect.mapError(noteError)),
          )
        }),
      )
      .handle(
        "note.link",
        Effect.fn(function* (ctx) {
          const notes = yield* NoteStore.Service
          return yield* response(
            notes.link({ ...ctx.payload, name: ctx.params.name }).pipe(Effect.mapError(noteError)),
          )
        }),
      )
      .handle(
        "note.remove",
        Effect.fn(function* (ctx) {
          const notes = yield* NoteStore.Service
          yield* notes
            .remove({ name: ctx.params.name, expectedMtime: ctx.query.expectedMtime })
            .pipe(Effect.mapError(noteError))
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)

export function noteError(error: NoteStore.Failure) {
  switch (error._tag) {
    case "NoteStore.NotFoundError":
      return new NoteNotFoundError({ name: error.name, message: error.message })
    case "NoteStore.ConflictError":
      return new NoteConflictError({
        name: error.name,
        expected: error.expected,
        actual: error.actual,
        message: error.message,
      })
    case "NoteStore.InvalidNameError":
      return new InvalidRequestError({ message: error.message, kind: error.reason, field: "name" })
    case "NoteStore.StorageError":
      return new ServiceUnavailableError({ service: "notes", message: error.message })
  }
}
