export * as NoteTool from "./note.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { Note } from "@opencode/schema/note"
import { SessionID } from "@opencode/schema/session-id"
import { optional } from "@opencode/schema/schema"
import { Effect, Schema } from "effect"
import { NoteStore } from "../../note.js"
import { Permission } from "../../permission.js"

export const name = "note"

/** Notes folder relative to the working directory, and what the permission ask names. */
const FOLDER = ".opencode/notes"

export const Input = Schema.Struct({
  action: Schema.Literals(["list", "read", "create", "edit", "update", "link"]).annotate({
    description:
      "List notes, read one, create one, rewrite or append its body, change its metadata, or bind it to this chat",
  }),
  name: optional(
    Schema.String.annotate({
      description: "File name of the note without .md: 2 to 60 lowercase latin letters, digits and hyphens",
    }),
  ),
  title: optional(Schema.String.annotate({ description: "Human readable title, any language" })),
  body: optional(Schema.String.annotate({ description: "Markdown body of the note" })),
  mode: optional(
    Schema.Literals(["replace", "append"]).annotate({ description: "How edit writes the body, replace by default" }),
  ),
  status: optional(Note.Status.annotate({ description: "Note status" })),
  tags: optional(Schema.Array(Note.Tag).annotate({ description: "Lowercase latin tags" })),
  expectedMtime: optional(
    Schema.Number.annotate({
      description: "File mtime in epoch ms from an earlier read; required by edit, update and link",
    }),
  ),
})
export type Input = typeof Input.Type

export const Output = Schema.Struct({
  output: Schema.String,
  name: optional(Schema.String),
  updated: optional(Schema.Number),
})
export type Output = typeof Output.Type

export const description = [
  "Read and write the project notes: markdown files in .opencode/notes/, one file per note, and the file name is the note id.",
  "",
  "Actions:",
  "  list — every note with status, tags and last update, newest first.",
  "  read — one note with its full body; the updated value it reports is the file mtime to pass back as expectedMtime.",
  "  create — a new note from title and body; pass a short latin name.",
  "  edit — rewrite or append the body; pass name, body, optional mode and expectedMtime from a read.",
  "  update — change title, status or tags without touching the body; pass name and expectedMtime.",
  "  link — bind the note to this chat, so the session can open it later.",
  "",
  "Writing rules: edit, update and link refuse to write when expectedMtime does not match the file, which is what happens when the user or another agent changed the note. On that refusal read the note again and re-apply the change, never invent a fresh mtime.",
  "",
  "When to write a note: a plan, a decision, a spec or a summary that will still matter after this chat ends. Do not write a note that only restates the chat, and do not create one for a trivial answer.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.note",
  effect: Effect.fn("NoteTool.Plugin")(function* (ctx: Context) {
    const notes = yield* NoteStore.Service
    const permission = yield* Permission.Service

    const listing = Effect.fn("NoteTool.listing")(function* () {
      const found = yield* notes.list()
      if (found.length === 0) return `No notes yet in ${FOLDER}.`
      return found
        .map((note) => `- ${note.name} [${note.frontmatter.status}] ${note.frontmatter.title || "(без заголовка)"}`)
        .join("\n")
    })

    const reading = Effect.fn("NoteTool.reading")(function* (input: Input) {
      const note = yield* notes.get(yield* needName(input))
      return reported(note)
    })

    const run = Effect.fn("NoteTool.run")(function* (input: Input, sessionID: SessionID) {
      switch (input.action) {
        case "list":
          return { output: yield* listing(), name: undefined, updated: undefined }
        case "read":
          return yield* reading(input)
        case "create":
          return reported(
            yield* notes.create({
              name: yield* needName(input),
              title: input.title ?? "",
              body: input.body,
              status: input.status,
              tags: input.tags,
            }),
          )
        case "edit":
          return reported(
            yield* notes.edit({
              name: yield* needName(input),
              body: input.body ?? "",
              mode: input.mode,
              expectedMtime: yield* needStamp(input),
            }),
          )
        case "update":
          return reported(
            yield* notes.update({
              name: yield* needName(input),
              title: input.title,
              status: input.status,
              tags: input.tags,
              expectedMtime: yield* needStamp(input),
            }),
          )
        case "link":
          return reported(
            yield* notes.link({
              name: yield* needName(input),
              session: sessionID,
              expectedMtime: yield* needStamp(input),
            }),
          )
      }
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              if (writes(input.action)) {
                yield* permission.assert({
                  action: name,
                  resources: [FOLDER],
                  save: [FOLDER],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.messageID, id: context.id },
                })
              }
              const result = yield* run(input, SessionID.make(context.sessionID))
              return { output: result, content: result.output, metadata: { name: result.name } }
              // A blocked permission and a stale mtime both belong in the model output as text,
              // not as a crash: the model can react to either by reading and trying again.
            }).pipe(Effect.mapError(failed)),
        }),
      )
      .pipe(Effect.orDie)
  }),
}

function writes(action: Input["action"]) {
  return action === "create" || action === "edit" || action === "update" || action === "link"
}

const needName = (input: Input) =>
  input.name === undefined
    ? Effect.fail(new ToolFailure({ message: `note ${input.action} needs a name` }))
    : Effect.succeed(input.name)

/** The store refuses a write it did not read, so the caller has to hand back what it saw. */
const needStamp = (input: Input) =>
  input.expectedMtime === undefined
    ? Effect.fail(new ToolFailure({ message: `note ${input.action} needs expectedMtime from an earlier read` }))
    : Effect.succeed(input.expectedMtime)

/**
 * The reported `updated` is the file mtime, because that is the value the store
 * checks; the frontmatter timestamp is shown in the text so the model can see both.
 */
function reported(note: NoteStore.Info) {
  const meta = [note.frontmatter.status, note.frontmatter.tags.join(", "), `written ${note.frontmatter.updated}`]
    .filter((part) => part !== "")
    .join(" · ")
  return {
    output: [`# ${note.frontmatter.title || note.name}`, meta, "", note.body].join("\n"),
    name: note.name,
    updated: note.mtime,
  }
}

function failed(error: unknown) {
  if (error instanceof ToolFailure) return error
  const message = error instanceof Error ? error.message : String(error)
  return new ToolFailure({ message: `Note action failed: ${message}`, error })
}
