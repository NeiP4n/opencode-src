export * as HubText from "./text.js"

import type { Entry } from "../types.js"

// Text stream processing: sort/uniq/awk/sed alternatives and diffing.
export const entries: Entry[] = [
  {
    id: "text.sort-lines",
    title: "Sort lines",
    description: "Sort input lines, optionally numerically or uniquely",
    category: "text",
    templates: { bash: "sort {flags} {file}" },
  },
  {
    id: "text.unique-count",
    title: "Count duplicate lines",
    description: "Count occurrences of each distinct line, most frequent first",
    category: "text",
    templates: { bash: "sort {file} | uniq -c | sort -rn" },
  },
  {
    id: "text.top-frequency",
    title: "Most frequent values",
    description: "Show the N most common values from the first column",
    category: "text",
    requires: ["mlr"],
    templates: { bash: "mlr --opprint sort -f count then head -n {limit} {file}" },
  },
  {
    id: "text.replace",
    title: "In-place regex replace",
    description: "Replace regex matches in a file, writing the result back",
    category: "text",
    requires: ["sd"],
    templates: { bash: "sd {pattern} {replacement} {file}" },
  },
  {
    id: "text.diff-files",
    title: "Diff two files",
    description: "Unified diff between two files with context lines",
    category: "text",
    templates: { bash: "diff -u {left} {right}" },
  },
  {
    id: "text.diff-side-by-side",
    title: "Side-by-side diff",
    description: "Show two files side by side with differences highlighted",
    category: "text",
    requires: ["diff-so-fancy"],
    templates: { bash: "diff -u {left} {right} | diff-so-fancy" },
  },
  {
    id: "text.line-count",
    title: "Count lines, words, bytes",
    description: "wc summary for a file or stream",
    category: "text",
    templates: { bash: "wc {file}" },
  },
  {
    id: "text.long-lines",
    title: "Lines longer than N chars",
    description: "Find lines exceeding a length limit, with line numbers",
    category: "text",
    templates: { bash: "awk 'length > {max} {print FNR \":\" $0}' {file}" },
  },
  {
    id: "text.trim-whitespace",
    title: "Strip trailing whitespace",
    description: "Remove trailing spaces and tabs from every line",
    category: "text",
    templates: { bash: "sed 's/[[:space:]]*$//' {file}" },
  },
  {
    id: "text.extract-column",
    title: "Extract a column",
    description: "Print a single whitespace-separated column",
    category: "text",
    templates: { bash: "awk '{print ${column}}' {file}" },
  },
  {
    id: "text.fold-wrap",
    title: "Wrap long lines",
    description: "Fold lines at a fixed width for terminal-friendly output",
    category: "text",
    templates: { bash: "fold -s -w {width} {file}" },
  },
  {
    id: "text.hexdump",
    title: "Hex dump a file",
    description: "Offset, hex bytes and ASCII view of binary content",
    category: "text",
    templates: { bash: "xxd {file} | head -{limit}" },
  },
]
