export * as HubQuote from "./quote.js"

import type { Backend } from "./types.js"
import { slotKey } from "./types.js"

// Fills `{placeholders}` with values escaped for the shell that will run the
// template. The escape depends on where the slot sits: a bare `{path}` gets
// quoted as one argument, while a slot inside a quoted literal such as
// `jq '[.[] | select({condition})]'` or `--since '{minutes} min ago'` is part
// of that literal and only has its closing quote neutralized. Values never
// leave the argument they were given for, on any backend.

export class InvalidArgumentError extends Error {
  constructor(
    readonly slot: string,
    reason: string,
  ) {
    super(`Hub argument ${slot} ${reason}`)
  }
}

type Context = "bare" | "single" | "double"

const SLOT = /\{([a-zA-Z][a-zA-Z0-9_]*[?*]?)\}/y

// Characters that need no quoting as a bare word. Kept conservative so the
// common case (paths, numbers, simple patterns) renders readable.
const SAFE: Record<Backend, RegExp> = {
  bash: /^[A-Za-z0-9_@%+=:,./-]+$/,
  pwsh: /^[A-Za-z0-9_.:/\\][A-Za-z0-9_.:/\\-]*$/,
  nu: /^[A-Za-z0-9_./][A-Za-z0-9_./-]*$/,
}

// PowerShell treats the typographic quotes as quote characters too.
const PS_SINGLE = /['\u2018\u2019\u201A\u201B]/g
const PS_DOUBLE = /["`$\u201C\u201D\u201E]/g

export function fill(template: string, args: Readonly<Record<string, string>>, syntax: Backend): string {
  let out = ""
  let context: Context = "bare"
  let i = 0
  while (i < template.length) {
    SLOT.lastIndex = i
    const slot = SLOT.exec(template)
    if (slot) {
      out += value(slot[1], args, syntax, context)
      i = SLOT.lastIndex
      continue
    }
    const char = template[i]
    const next = template[i + 1]
    out += char
    i++
    if (context === "bare") {
      if (escapes(syntax, char, "bare") && next !== undefined) {
        out += next
        i++
      } else if (char === "'") context = "single"
      else if (char === '"') context = "double"
      continue
    }
    if (context === "single") {
      // PowerShell doubles a quote to keep it inside a single-quoted string.
      if (char === "'" && syntax === "pwsh" && next === "'") {
        out += next
        i++
      } else if (char === "'") context = "bare"
      continue
    }
    if (escapes(syntax, char, "double") && next !== undefined) {
      out += next
      i++
    } else if (char === '"') context = "bare"
  }
  return out
}

function escapes(syntax: Backend, char: string, context: "bare" | "double") {
  if (syntax === "pwsh") return char === "`"
  if (syntax === "nu") return context === "double" && char === "\\"
  return char === "\\"
}

function value(slot: string, args: Readonly<Record<string, string>>, syntax: Backend, context: Context): string {
  const key = slotKey(slot)
  const raw = args[key]
  if (raw === undefined) return ""
  if (raw.includes("\0")) throw new InvalidArgumentError(key, "contains a NUL byte")
  // A word list only splits where it stands as bare arguments; inside a
  // quoted literal it is one piece of text like any other value.
  if (slot.endsWith("*") && context === "bare")
    return raw
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => quote(word, syntax))
      .join(" ")
  if (context === "bare") return quote(raw, syntax)
  if (context === "single") return insideSingle(raw, syntax, key)
  return insideDouble(raw, syntax)
}

// One self-contained argument.
export function quote(raw: string, syntax: Backend): string {
  if (raw !== "" && SAFE[syntax].test(raw)) return raw
  if (syntax === "pwsh") return `'${raw.replace(PS_SINGLE, "$&$&")}'`
  if (syntax === "nu") return `"${raw.replace(/["\\]/g, "\\$&")}"`
  return `'${raw.replace(/'/g, "'\\''")}'`
}

function insideSingle(raw: string, syntax: Backend, key: string): string {
  if (syntax === "pwsh") return raw.replace(PS_SINGLE, "$&$&")
  // nu single quotes are raw strings with no escape at all.
  if (syntax === "nu") {
    if (raw.includes("'")) throw new InvalidArgumentError(key, "cannot contain ' inside this nu template")
    return raw
  }
  // Close, emit an escaped quote, reopen: the bash idiom for ' inside '...'.
  return raw.replace(/'/g, "'\\''")
}

function insideDouble(raw: string, syntax: Backend): string {
  if (syntax === "pwsh") return raw.replace(PS_DOUBLE, "`$&")
  if (syntax === "nu") return raw.replace(/["\\]/g, "\\$&")
  return raw.replace(/[\\"$`]/g, "\\$&")
}
