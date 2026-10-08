export * as Note from "./note.js"

import { Result, Schema } from "effect"
import { NonNegativeInt, optional } from "./schema.js"
import { SessionID } from "./session-id.js"

export const Status = Schema.Literals(["inbox", "active", "done", "archived"]).annotate({
  identifier: "Note.Status",
})
export type Status = typeof Status.Type

/** Status a note falls back to when its frontmatter is missing or unreadable. */
export const FallbackStatus: Status = "inbox"

export const Tag = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,31}$/)).annotate({
  identifier: "Note.Tag",
  description: "Note tag (1 to 32 lowercase latin alphanumerics and hyphens, starting with an alphanumeric)",
})
export type Tag = typeof Tag.Type

const SlugLength = { min: 2, max: 60 } as const
const SLUG = new RegExp(`^[a-z][a-z0-9-]{${SlugLength.min - 1},${SlugLength.max - 1}}$`)

/**
 * File name of a note without the `.md` extension. It is the whole identity of a
 * note: there is no `id` field, so the name is restricted to characters that are
 * safe both as a path segment and as a stable cross-platform key.
 */
export const Slug = Schema.String.check(Schema.isPattern(SLUG)).annotate({
  identifier: "Note.Slug",
  description: `Note file name without extension (${SlugLength.min} to ${SlugLength.max} lowercase latin letters, digits and hyphens, starting with a letter)`,
})
export type Slug = typeof Slug.Type

export const Frontmatter = Schema.Struct({
  title: Schema.String,
  status: Status,
  tags: Schema.Array(Tag),
  session: optional(SessionID),
  created: NonNegativeInt,
  updated: NonNegativeInt,
}).annotate({ identifier: "Note.Frontmatter" })
export interface Frontmatter extends Schema.Schema.Type<typeof Frontmatter> {}

export const File = Schema.Struct({
  frontmatter: Frontmatter,
  body: Schema.String,
}).annotate({ identifier: "Note.File" })
export interface File extends Schema.Schema.Type<typeof File> {}

export const Rejection = Schema.Struct({
  input: Schema.String,
  reason: Schema.Literals(["empty", "too_short", "too_long", "not_slug", "no_free_name"]),
}).annotate({ identifier: "Note.Rejection" })
export type Rejection = typeof Rejection.Type

const FENCE = "---"
const isSlug = Schema.is(Slug)
const isTag = Schema.is(Tag)
const isStatus = Schema.is(Status)
const isSession = Schema.is(SessionID)
const isMillis = Schema.is(NonNegativeInt)

/**
 * Reads a note file into its frontmatter and body. Reading never fails: a file
 * that is not a note, or whose frontmatter is malformed, degrades to the
 * fallback frontmatter and keeps its text as the body, so one broken file in the
 * notes folder can never take down a listing.
 */
export function parse(content: string): File {
  const lines = normalize(content).split("\n")
  if (lines[0] !== FENCE) return { frontmatter: fallback(), body: lines.join("\n") }
  const end = lines.indexOf(FENCE, 1)
  if (end === -1) return { frontmatter: fallback(), body: lines.join("\n") }
  return {
    frontmatter: read(lines.slice(1, end)),
    body: lines
      .slice(end + 1)
      .join("\n")
      .replace(/^\n/, ""),
  }
}

/**
 * Writes the canonical note file: one field per line, in a fixed order, then a
 * blank line and the body. Field order is fixed so that a note written twice in
 * a row does not produce a diff.
 */
export function serialize(file: File) {
  const info = file.frontmatter
  const lines = [`title: ${oneLine(info.title)}`, `status: ${info.status}`, `tags: [${info.tags.join(", ")}]`]
  if (info.session) lines.push(`session: ${info.session}`)
  lines.push(`created: ${info.created}`, `updated: ${info.updated}`)
  return [FENCE, ...lines, FENCE, "", file.body].join("\n")
}

/**
 * Turns a name asked for by the agent into a note file name. Case and the outer
 * whitespace are folded because both are unambiguous; anything else is refused
 * rather than repaired, so a name can never resolve to a path the caller did not
 * ask for.
 */
export function name(input: string): Result.Result<Slug, Rejection> {
  const candidate = input.trim().toLowerCase()
  if (candidate === "") return Result.fail({ input, reason: "empty" })
  if (candidate.length < SlugLength.min) return Result.fail({ input, reason: "too_short" })
  if (candidate.length > SlugLength.max) return Result.fail({ input, reason: "too_long" })
  if (!isSlug(candidate)) return Result.fail({ input, reason: "not_slug" })
  return Result.succeed(Slug.make(candidate))
}

/**
 * Picks the file name a new note gets: the asked name when it is free, otherwise
 * the first free `-2`, `-3` suffix. A note is its file name, so creating one must
 * never land on an existing file.
 */
export function unique(base: Slug, taken: ReadonlySet<string>): Result.Result<Slug, Rejection> {
  if (!taken.has(base)) return Result.succeed(base)
  for (let attempt = 2; attempt <= MaxAttempts; attempt++) {
    const suffix = `-${attempt}`
    const stem = base.slice(0, Math.max(1, SlugLength.max - suffix.length))
    const candidate = `${stem}${suffix}`
    if (!taken.has(candidate)) return Result.succeed(Slug.make(candidate))
  }
  return Result.fail({ input: base, reason: "no_free_name" })
}

/** Notes per base name that `unique` tries before giving up. */
const MaxAttempts = 1000

function fallback(): Frontmatter {
  return { title: "", status: FallbackStatus, tags: [], session: undefined, created: 0, updated: 0 }
}

function normalize(content: string) {
  return content.replace(/\r\n/g, "\n").replace(/^﻿/, "")
}

function read(lines: ReadonlyArray<string>): Frontmatter {
  const fields = new Map<string, string>()
  for (const line of lines) {
    const separator = line.indexOf(":")
    // A line without a separator is not a field: skip it and keep the rest of the block.
    if (separator === -1) continue
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  return {
    title: fields.get("title") ?? "",
    status: status(fields.get("status")),
    tags: tags(fields.get("tags")),
    session: session(fields.get("session")),
    created: millis(fields.get("created")),
    updated: millis(fields.get("updated")),
  }
}

function status(value: string | undefined) {
  if (value === undefined) return FallbackStatus
  if (!isStatus(value)) return FallbackStatus
  return value
}

function tags(value: string | undefined) {
  if (value === undefined) return []
  return value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(isTag)
}

function session(value: string | undefined) {
  if (value === undefined) return undefined
  if (!isSession(value)) return undefined
  return value
}

function millis(value: string | undefined) {
  if (value === undefined) return 0
  const parsed = Number(value)
  if (!isMillis(parsed)) return 0
  return parsed
}

/**
 * The frontmatter is line based, so a title holding a line break would be read
 * back as a second broken line and silently dropped.
 */
function oneLine(value: string) {
  return value.replace(/\s*[\r\n]+\s*/g, " ").trim()
}
