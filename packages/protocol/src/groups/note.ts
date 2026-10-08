import { Location } from "@opencode/schema/location"
import { Note } from "@opencode/schema/note"
import { optional } from "@opencode/schema/schema"
import { SessionID } from "@opencode/schema/session-id"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, NoteConflictError, NoteNotFoundError, ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

const NameParams = {
  name: Schema.String.annotate({
    description: "Note file name without .md: 2 to 60 lowercase latin letters, digits and hyphens",
  }),
}

const ExpectedMtime = Schema.Number.annotate({
  description: "The mtime of the note as last read; the write is refused with 409 when the file changed since",
})

const errors = [NoteNotFoundError, NoteConflictError, InvalidRequestError, ServiceUnavailableError]

export const NoteGroup = HttpApiGroup.make("server.note")
  .add(
    HttpApiEndpoint.get("note.list", "/api/note", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Note.Info)),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "note.list",
          summary: "List notes",
          description: "Every note in .opencode/notes of the requested location, most recently updated first.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("note.get", "/api/note/:name", {
      params: NameParams,
      query: LocationQuery,
      success: Location.response(Note.Info),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "note.get",
          summary: "Get note",
          description: "Read one note with its frontmatter, body and the mtime later writes must echo back.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("note.bound", "/api/note/session/:sessionID", {
      params: { sessionID: SessionID },
      query: LocationQuery,
      success: Location.response(Schema.NullOr(Note.Info)),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "note.bound",
          summary: "Get the note bound to a session",
          description:
            "The note whose frontmatter binds it to the session, the most recently updated one when several do, or null.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("note.create", "/api/note", {
      query: LocationQuery,
      payload: Schema.Struct({
        name: optional(NameParams.name),
        title: Schema.String,
        body: optional(Schema.String),
        status: optional(Note.Status),
        tags: optional(Schema.Array(Note.Tag)),
        length: optional(Note.Length),
        session: optional(SessionID),
      }),
      success: Location.response(Note.Info),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "note.create",
          summary: "Create note",
          description:
            "Create a note. Without a name, one is derived from the title (Cyrillic is transliterated). A taken name gets a numeric suffix.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("note.edit", "/api/note/:name/edit", {
      params: NameParams,
      query: LocationQuery,
      payload: Schema.Struct({
        body: Schema.String,
        mode: optional(Schema.Literals(["replace", "append"])),
        expectedMtime: ExpectedMtime,
      }),
      success: Location.response(Note.Info),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "note.edit",
          summary: "Edit note body",
          description: "Replace the body of a note, or append to it, keeping its frontmatter.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("note.update", "/api/note/:name", {
      params: NameParams,
      query: LocationQuery,
      payload: Schema.Struct({
        title: optional(Schema.String),
        status: optional(Note.Status),
        tags: optional(Schema.Array(Note.Tag)),
        length: optional(Note.Length),
        expectedMtime: ExpectedMtime,
      }),
      success: Location.response(Note.Info),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "note.update",
          summary: "Update note metadata",
          description: "Change the title, status, tags or length of a note without touching its body.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("note.link", "/api/note/:name/link", {
      params: NameParams,
      query: LocationQuery,
      payload: Schema.Struct({
        session: optional(SessionID),
        expectedMtime: ExpectedMtime,
      }),
      success: Location.response(Note.Info),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "note.link",
          summary: "Bind note to a session",
          description:
            "Bind the note to a session, so the agent of that session writes into it; omit session to unbind it.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("note.remove", "/api/note/:name", {
      params: NameParams,
      query: Schema.Struct({
        ...LocationQuery.fields,
        expectedMtime: Schema.NumberFromString.annotate({
          description: "The mtime of the note as last read; removal is refused with 409 when the file changed since",
        }),
      }),
      success: HttpApiSchema.NoContent,
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "note.remove",
          summary: "Remove note",
          description: "Delete the note file.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "note",
      description:
        "Location-scoped notes in .opencode/notes. Every write and removal emits a note.updated event on the event stream.",
    }),
  )
