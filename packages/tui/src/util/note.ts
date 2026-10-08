import type { NoteInfo, NoteLength, NoteStatus } from "@opencode/client"

// How much the AI writes into a note bound to its chat, in the order the control shows them.
export const NOTE_LENGTHS: readonly { readonly value: NoteLength; readonly label: string }[] = [
  { value: "brief", label: "Brief & useful" },
  { value: "balanced", label: "Balanced" },
  { value: "detailed", label: "Detailed & useful" },
]

export const NOTE_STATUSES: readonly NoteStatus[] = ["inbox", "active", "done", "archived"]

export const NOTE_STATUS_MARKER: Record<NoteStatus, string> = {
  inbox: "○",
  active: "●",
  done: "✓",
  archived: "▪",
}

const TAG = /^[a-z0-9][a-z0-9-]{0,31}$/

export function noteTitle(note: NoteInfo) {
  return note.frontmatter.title || note.name
}

export function noteLength(note: NoteInfo) {
  return note.frontmatter.length ?? "balanced"
}

export function nextStatus(status: NoteStatus) {
  return NOTE_STATUSES[(NOTE_STATUSES.indexOf(status) + 1) % NOTE_STATUSES.length]
}

// Tags typed by hand: `#` and commas are forgiven, case is folded, anything else
// that is not a valid tag is reported back instead of silently dropped.
export function parseTags(input: string) {
  const words = input
    .split(/[\s,]+/)
    .map((word) => word.replace(/^#/, "").toLowerCase())
    .filter((word) => word.length > 0)
  return {
    tags: [...new Set(words.filter((word) => TAG.test(word)))],
    invalid: words.filter((word) => !TAG.test(word)),
  }
}

// A filter matches the title, or a tag when written as `#tag`, case-insensitively.
export function matchesNote(note: NoteInfo, filter: string) {
  const query = filter.trim().toLowerCase()
  if (!query) return true
  if (query.startsWith("#")) return note.frontmatter.tags.some((tag) => tag.includes(query.slice(1)))
  return (
    noteTitle(note).toLowerCase().includes(query) || note.frontmatter.tags.some((tag) => tag.includes(query))
  )
}

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

// Compact age for list rows: `now`, `5m`, `3h`, `2d`, then the date.
export function ago(time: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - time) / 1000))
  if (seconds < 60) return "now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`
  return dateFormat.format(new Date(time))
}
