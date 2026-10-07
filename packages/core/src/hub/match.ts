export * as HubMatch from "./match.js"

import { get } from "./catalog/index.js"
import { render } from "./resolve.js"

// Thin matcher: proposes a catalog command for a shell string the model
// wrote by hand. It only fires on fully recognized shapes, and only when the
// target tool is installed — otherwise the original command passes through
// untouched, which is the bash fallback.

type Rule = {
  // Anchored on purpose: partial rewrites of compound commands are refused.
  readonly pattern: RegExp
  readonly id: string
  readonly args: (match: RegExpMatchArray) => Record<string, string>
}

const RULES: Rule[] = [
  {
    // grep -r pattern path  ->  rg pattern path
    pattern: /^grep\s+-r\s+(\S+)\s+(\S+)$/,
    id: "search.content",
    args: (m) => ({ pattern: m[1], path: m[2] }),
  },
  {
    // find path -name '*.ext'  ->  fd --type f --extension ext path
    pattern: /^find\s+(\S+)\s+-name\s+['"]\*\.(\w+)['"]$/,
    id: "search.glob-extension",
    args: (m) => ({ path: m[1], extension: m[2] }),
  },
  {
    // cat file | jq .  ->  jq . file (pretty-print via the dedicated entry)
    pattern: /^cat\s+(\S+)\s*\|\s*jq\s+\.$/,
    id: "json.pretty",
    args: (m) => ({ file: m[1] }),
  },
  {
    // cat file | sort | uniq -c | sort -rn  ->  catalog duplicate counter
    pattern: /^cat\s+(\S+)\s*\|\s*sort\s*\|\s*uniq\s+-c\s*\|\s*sort\s+-rn$/,
    id: "text.unique-count",
    args: (m) => ({ file: m[1] }),
  },
]

// Returns a rewritten command plus its entry id, or undefined when nothing
// safe matched. The rewritten command is still permission-checked by the
// shell tool itself — this only swaps the string before the scan.
export function rewrite(
  command: string,
  available: (tool: string) => boolean,
): { command: string; id: string } | undefined {
  const trimmed = command.trim()
  for (const rule of RULES) {
    const match = trimmed.match(rule.pattern)
    if (!match) continue
    const entry = get(rule.id)
    if (!entry) continue
    const tool = (entry.requires ?? [])[0]
    if (!tool || !available(tool)) continue
    try {
      return { command: render(entry, "bash", rule.args(match)), id: rule.id }
    } catch {
      // Args do not fit the template — refuse rather than guess.
      continue
    }
  }
  return undefined
}
