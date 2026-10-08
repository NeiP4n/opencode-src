export * as HubMatch from "./match.js"

// Thin matcher: upgrades a shell string the model wrote by hand to the fast
// tool, but only when the result is the same answer. Flags restore what the
// modern tools change by default (rg and fd skip hidden and .gitignored
// files, fd matches case-insensitively), and patterns whose meaning differs
// between grep's BRE and rg's regex are left alone. Anything not fully
// recognized passes through untouched, which is the bash fallback.
//
// Captured tokens are copied verbatim, quotes included, so the rewrite stays
// valid in whatever shell the command was written for — bash, sh, Git Bash or
// PowerShell all read `rg … 'TODO' src` the same way.

// One shell word without expansions, pipes or redirections: bare, '…' or "…".
const WORD = String.raw`(?:'[^']*'|"[^"\\$\x60]*"|[^\s'"\\$\x60|&;<>()]+)`

type Rule = {
  // Anchored on purpose: partial rewrites of compound commands are refused.
  readonly pattern: RegExp
  readonly id: string
  readonly tool: string
  readonly build: (match: RegExpMatchArray, name: string) => string | undefined
}

const unquote = (word: string) => (/^(['"]).*\1$/.test(word) ? word.slice(1, -1) : word)

// Metacharacters whose meaning differs between grep's basic regex and rg:
// literal in BRE, operators in rg (and backslash escapes flip both ways).
const DIALECT = /[+?|{}()\\]/

const RULES: Rule[] = [
  {
    // grep -r PATTERN PATH  ->  rg with grep's own output and file set
    pattern: new RegExp(`^grep\\s+-r\\s+(${WORD})\\s+(${WORD})$`),
    id: "search.content",
    tool: "rg",
    build: (m, name) => {
      if (DIALECT.test(unquote(m[1])) || unquote(m[1]).startsWith("-")) return undefined
      return `${name} --no-heading --with-filename --no-line-number --hidden --no-ignore --no-messages ${m[1]} ${m[2]}`
    },
  },
  {
    // find PATH -name '*.ext'  ->  fd over the same files, case-sensitive like find
    pattern: new RegExp(`^find\\s+(${WORD})\\s+-name\\s+(['"])\\*\\.(\\w+)\\2$`),
    id: "search.glob-extension",
    tool: "fd",
    build: (m, name) => `${name} --hidden --no-ignore --case-sensitive --glob '*.${m[3]}' ${m[1]}`,
  },
  {
    // cat file | jq .  ->  jq . file
    pattern: new RegExp(`^cat\\s+(${WORD})\\s*\\|\\s*jq\\s+\\.$`),
    id: "json.pretty",
    tool: "jq",
    build: (m, name) => `${name} . ${m[1]}`,
  },
]

// Returns a rewritten command plus its entry id, or undefined when nothing
// safe matched. `available` answers whether a tool resolves, optionally with
// the name it has on this machine (`fdfind` on Debian). The rewritten command
// is still permission-checked by the shell tool itself — this only swaps the
// string before the scan.
export function rewrite(
  command: string,
  available: (tool: string) => boolean | string | undefined,
): { command: string; id: string } | undefined {
  const trimmed = command.trim()
  for (const rule of RULES) {
    const match = trimmed.match(rule.pattern)
    if (!match) continue
    const found = available(rule.tool)
    if (!found) continue
    const built = rule.build(match, typeof found === "string" ? found : rule.tool)
    if (built) return { command: built, id: rule.id }
  }
  return undefined
}
