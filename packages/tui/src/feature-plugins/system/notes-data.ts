import { Note } from "@opencode/schema/note"

/** Notes live in this folder of a project directory, one markdown file per note. */
export const NOTES_PATH = ".opencode/notes"

/** A note file as read from disk: its text plus the mtime observed when it was read. */
export type NoteFile = { readonly text: string; readonly mtimeMs: number }

/**
 * The file operations the notes screen needs. The TUI builds one from `context.client.file`;
 * keeping the screen behind this port lets the listing and the save check be exercised against
 * a plain folder.
 */
export interface NotesFiles {
  readonly list: () => Promise<readonly string[]>
  readonly read: (path: string) => Promise<NoteFile>
  readonly write: (path: string, text: string) => Promise<void>
}

export type NoteRow = {
  /** Location-relative path, the identity the save check and the write both use. */
  readonly path: string
  readonly slug: string
  readonly title: string
  readonly status: Note.Status
  readonly tags: readonly string[]
  readonly updated: number
  readonly body: string
  /** The file as it was read, kept so a save can prove nothing else touched it meanwhile. */
  readonly text: string
  readonly mtimeMs: number
  /** False for a file that is not a note: the core stamps `updated` on every note it writes. */
  readonly parsed: boolean
}

export type NotesListing = {
  readonly rows: readonly NoteRow[]
  /** Files the folder listed but that could not be read; reported apart so one bad file never hides the rest. */
  readonly unreadable: readonly string[]
}

export type SaveReason = "changed" | "missing" | "foreign" | "failed"
export type SaveResult = { readonly ok: true } | { readonly ok: false; readonly reason: SaveReason }

/**
 * Builds the listing of a notes folder. Files are read one by one and sorted newest first, and a
 * file that cannot be read is reported instead of failing the whole listing: the notes folder is
 * user-editable, so a foreign file or a vanished file is normal, not an error.
 */
export async function listNotes(files: NotesFiles): Promise<NotesListing> {
  const paths = (await files.list()).filter(isNotePath).sort()
  const rows = await Promise.all(
    paths.map((path) =>
      files.read(path).then(
        (file) => noteRow(path, file),
        () => undefined,
      ),
    ),
  )
  return {
    rows: rows.filter((row): row is NoteRow => row !== undefined).sort(byUpdated),
    unreadable: paths.filter((_, index) => rows[index] === undefined),
  }
}

export function noteRow(path: string, file: NoteFile): NoteRow {
  const parsed = Note.parse(file.text)
  const slug = slugOf(path)
  return {
    path,
    slug,
    // A note without a title still has to be nameable, and the file name is its identity.
    title: parsed.frontmatter.title || slug,
    status: parsed.frontmatter.status,
    tags: parsed.frontmatter.tags,
    updated: parsed.frontmatter.updated,
    body: parsed.body,
    text: file.text,
    mtimeMs: file.mtimeMs,
    parsed: parsed.frontmatter.updated > 0,
  }
}

export function isNotePath(path: string) {
  return path.endsWith(".md")
}

/** Newest first; the slug breaks ties so repeated listings keep the same order. */
function byUpdated(left: NoteRow, right: NoteRow) {
  return right.updated - left.updated || left.slug.localeCompare(right.slug)
}

/**
 * Rewrites one note whole, but only while the file still holds what the screen read: it is
 * re-read and compared against the snapshot, and a file that changed meanwhile is reported
 * instead of overwritten, so an edit made by the agent or another window is never lost silently.
 */
export async function saveNote(files: NotesFiles, snapshot: NoteRow, body: string): Promise<SaveResult> {
  if (!snapshot.parsed) return { ok: false, reason: "foreign" }
  const current = await files.read(snapshot.path).catch(() => undefined)
  if (!current) return { ok: false, reason: "missing" }
  if (current.text !== snapshot.text || current.mtimeMs !== snapshot.mtimeMs) return { ok: false, reason: "changed" }
  const written = await files.write(snapshot.path, serializeNote(snapshot, body)).then(
    () => true,
    () => false,
  )
  if (!written) return { ok: false, reason: "failed" }
  return { ok: true }
}

/**
 * Canonical text of a note with a new body. The frontmatter is the one read with the file:
 * `created` and `updated` belong to the core, so the screen never invents them.
 */
export function serializeNote(row: NoteRow, body: string) {
  return Note.serialize({ frontmatter: Note.parse(row.text).frontmatter, body })
}

export function saveWarning(reason: SaveReason, row: NoteRow) {
  const name = `${row.slug}.md`
  if (reason === "changed") return `${name} changed on disk. Reopen it to see the current text.`
  if (reason === "missing") return `${name} is gone.`
  if (reason === "foreign") return `${name} is not a note. Its frontmatter is written by the core.`
  return `Could not write ${name}.`
}

function slugOf(path: string) {
  return path.slice(path.lastIndexOf("/") + 1, -".md".length)
}
