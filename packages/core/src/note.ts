/**
 * Notes are markdown files in `.opencode/notes` inside the location directory. The
 * note format itself lives in `@opencode/schema/note`, so the TUI and the tool read
 * exactly what this service writes; only storage and the write guard are here.
 *
 * The `Note` namespace name is taken by that contract, hence `NoteStore`.
 */
export * as NoteStore from "./note.js"

import { FSUtil } from "@opencode/util/fs-util"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Note } from "@opencode/schema/note"
import { SessionID } from "@opencode/schema/session-id"
import { Context, Effect, Exit, Layer, Option, Result, Schema } from "effect"
import path from "path"
import { optional, RelativePath } from "@opencode/schema/schema"
import { FileAccess } from "./file-access.js"
import { FileSystem } from "./filesystem.js"

const DIRECTORY = ".opencode/notes"
const EXTENSION = ".md"

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("NoteStore.NotFoundError", {
  name: Note.Slug,
}) {
  override get message() {
    return `Note not found: ${this.name}`
  }
}

export class ConflictError extends Schema.TaggedError<ConflictError>()("NoteStore.ConflictError", {
  name: Note.Slug,
  expected: Schema.Number,
  actual: Schema.Number,
}) {
  override get message() {
    return `Note ${this.name} changed on disk, read it again before writing`
  }
}

export class InvalidNameError extends Schema.TaggedError<InvalidNameError>()("NoteStore.InvalidNameError", {
  input: Schema.String,
  reason: Note.Rejection.fields.reason,
}) {
  override get message() {
    return `Note name must be 2 to 60 lowercase latin letters, digits and hyphens, got: ${this.input}`
  }
}

export class StorageError extends Schema.TaggedError<StorageError>()("NoteStore.StorageError", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message() {
    return `Notes folder is not readable: ${this.path}`
  }
}

export type Failure = NotFoundError | InvalidNameError | ConflictError | StorageError

export interface Info {
  readonly name: Note.Slug
  readonly frontmatter: Note.Frontmatter
  readonly body: string
  /** File mtime in epoch ms, the value a writer has to echo back as `expectedMtime`. */
  readonly mtime: number
}

export const CreateInput = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
  body: optional(Schema.String),
  status: optional(Note.Status),
  tags: optional(Schema.Array(Note.Tag)),
  session: optional(SessionID),
})
export type CreateInput = typeof CreateInput.Type

export const EditInput = Schema.Struct({
  name: Schema.String,
  body: Schema.String,
  mode: optional(Schema.Literals(["replace", "append"])),
  expectedMtime: Schema.Number,
})
export type EditInput = typeof EditInput.Type

export const UpdateInput = Schema.Struct({
  name: Schema.String,
  title: optional(Schema.String),
  status: optional(Note.Status),
  tags: optional(Schema.Array(Note.Tag)),
  expectedMtime: Schema.Number,
})
export type UpdateInput = typeof UpdateInput.Type

export const LinkInput = Schema.Struct({
  name: Schema.String,
  session: optional(SessionID),
  expectedMtime: Schema.Number,
})
export type LinkInput = typeof LinkInput.Type

export interface Interface {
  readonly list: () => Effect.Effect<readonly Info[], Failure>
  readonly get: (name: string) => Effect.Effect<Info, Failure>
  readonly create: (input: CreateInput) => Effect.Effect<Info, Failure>
  readonly edit: (input: EditInput) => Effect.Effect<Info, Failure>
  readonly update: (input: UpdateInput) => Effect.Effect<Info, Failure>
  readonly link: (input: LinkInput) => Effect.Effect<Info, Failure>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/NoteStore") {}

const isSlug = Schema.is(Note.Slug)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const access = yield* FileAccess.Service
    const filesystem = yield* FileSystem.Service

    // The slug is validated before it gets here and resolve() refuses targets outside
    // the location, so a note can never leave `.opencode/notes`.
    const target = (name: Note.Slug) =>
      access
        .resolve({ path: path.join(DIRECTORY, name + EXTENSION) })
        .pipe(Effect.catch(storage(DIRECTORY)))

    const read = Effect.fn("NoteStore.read")(function* (name: Note.Slug) {
      const resolved = yield* target(name)
      const content = yield* fs.readFileStringSafe(resolved.absolute).pipe(Effect.catch(storage(resolved.absolute)))
      if (content === undefined) return yield* new NotFoundError({ name })
      const stamp = yield* filesystem
        .read({ path: RelativePath.make(resolved.resource) })
        .pipe(Effect.catch(storage(resolved.absolute)))
      return { name, ...Note.parse(content), mtime: modified(stamp.mtime) } satisfies Info
    })

    const write = Effect.fn("NoteStore.write")(function* (name: Note.Slug, file: Note.File) {
      const resolved = yield* target(name)
      yield* fs.writeWithDirs(resolved.absolute, Note.serialize(file)).pipe(Effect.catch(storage(resolved.absolute)))
      return yield* read(name)
    })

    const names = Effect.fn("NoteStore.names")(function* () {
      const resolved = yield* access.resolve({ path: DIRECTORY }).pipe(Effect.catch(storage(DIRECTORY)))
      const present = yield* fs.existsSafe(resolved.absolute).pipe(Effect.catch(storage(resolved.absolute)))
      if (!present) return new Set<Note.Slug>()
      const entries = yield* fs.readDirectoryEntries(resolved.absolute).pipe(Effect.catch(storage(resolved.absolute)))
      const slugs = entries
        .filter((entry) => entry.type === "file" && entry.name.endsWith(EXTENSION))
        .map((entry) => entry.name.slice(0, -EXTENSION.length))
        .filter(isSlug)
      return new Set(slugs)
    })

    const guard = Effect.fn("NoteStore.guard")(function* (name: Note.Slug, expected: number, current: number) {
      if (expected !== current) return yield* new ConflictError({ name, expected, actual: current })
    })

    const slug = (input: string) => fromResult(Note.name(input))

    const free = Effect.fn("NoteStore.free")(function* (input: string) {
      const taken = yield* names()
      return yield* fromResult(Note.unique(yield* slug(input), taken))
    })

    const list = Effect.fn("NoteStore.list")(function* () {
      const settled = yield* Effect.forEach(yield* names(), (name) => read(name).pipe(Effect.exit))
      return settled
        .flatMap((entry) => (Exit.isSuccess(entry) ? [entry.value] : []))
        .toSorted((a, b) => b.frontmatter.updated - a.frontmatter.updated)
    })

    const get = Effect.fn("NoteStore.get")(function* (input: string) {
      return yield* read(yield* slug(input))
    })

    const create = Effect.fn("NoteStore.create")(function* (input: CreateInput) {
      const name = yield* free(input.name)
      const now = Date.now()
      return yield* write(name, {
        frontmatter: {
          title: input.title,
          status: input.status ?? Note.FallbackStatus,
          tags: input.tags ?? [],
          session: input.session,
          created: now,
          updated: now,
        },
        body: input.body ?? "",
      })
    })

    const edit = Effect.fn("NoteStore.edit")(function* (input: EditInput) {
      const name = yield* slug(input.name)
      const current = yield* read(name)
      yield* guard(name, input.expectedMtime, current.mtime)
      const body = input.mode === "append" ? [current.body, input.body].join("\n") : input.body
      return yield* write(name, { frontmatter: stamp_frontmatter(current, { updated: Date.now() }), body })
    })

    const update = Effect.fn("NoteStore.update")(function* (input: UpdateInput) {
      const name = yield* slug(input.name)
      const current = yield* read(name)
      yield* guard(name, input.expectedMtime, current.mtime)
      return yield* write(name, {
        frontmatter: stamp_frontmatter(current, {
          title: input.title,
          status: input.status,
          tags: input.tags,
          updated: Date.now(),
        }),
        body: current.body,
      })
    })

    const link = Effect.fn("NoteStore.link")(function* (input: LinkInput) {
      const name = yield* slug(input.name)
      const current = yield* read(name)
      yield* guard(name, input.expectedMtime, current.mtime)
      return yield* write(name, {
        frontmatter: stamp_frontmatter(current, { session: input.session, updated: Date.now() }),
        body: current.body,
      })
    })

    return Service.of({ list, get, create, edit, update, link })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, FileAccess.node, FileSystem.node],
})

/** Only defined fields of a metadata patch replace the current ones. */
function stamp_frontmatter(current: Info, patch: Partial<Note.Frontmatter>): Note.Frontmatter {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
  return { ...current.frontmatter, ...defined, created: current.frontmatter.created }
}

function modified(mtime: Option.Option<Date>) {
  return Option.isSome(mtime) ? mtime.value.getTime() : 0
}

function fromResult(result: Result.Result<Note.Slug, Note.Rejection>) {
  return Result.match(result, {
    onFailure: (rejection) => Effect.fail(new InvalidNameError(rejection)),
    onSuccess: (value) => Effect.succeed(value),
  })
}

function storage(path: string) {
  return (cause: unknown) => new StorageError({ path, cause })
}
