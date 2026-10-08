export * as HubSearch from "./search.js"

import type { Entry } from "../types.js"

// Fast replacements for grep/find/locate-style lookups. Every entry leans on
// a single focused binary so the model never hand-rolls find|grep pipelines.
export const entries: Entry[] = [
  {
    id: "search.content",
    title: "Recursive content search",
    description: "Search file contents recursively with regex support, honoring .gitignore",
    category: "search",
    requires: ["rg"],
    templates: { bash: "rg --line-number --no-heading {pattern} {path}" },
  },
  {
    id: "search.content-files",
    title: "List files containing a match",
    description: "Return only file paths whose contents match the pattern",
    category: "search",
    requires: ["rg"],
    templates: { bash: "rg --files-with-matches {pattern} {path}" },
  },
  {
    id: "search.content-count",
    title: "Count matches per file",
    description: "Show how many matches each file contains",
    category: "search",
    requires: ["rg"],
    templates: { bash: "rg --count {pattern} {path}" },
  },
  {
    id: "search.content-fixed",
    title: "Fixed-string search",
    description: "Search for a literal string without regex interpretation",
    category: "search",
    requires: ["rg"],
    templates: { bash: "rg --fixed-strings {text} {path}" },
  },
  {
    id: "search.glob",
    title: "Find files by name pattern",
    description: "Fast file name search with gitignore awareness and glob patterns",
    category: "search",
    requires: ["fd"],
    templates: { bash: "fd --type f {pattern} {path}" },
  },
  {
    id: "search.glob-dir",
    title: "Find directories by name",
    description: "Search for directories matching a name pattern",
    category: "search",
    requires: ["fd"],
    templates: { bash: "fd --type d {pattern} {path}" },
  },
  {
    id: "search.glob-extension",
    title: "Find files by extension",
    description: "List all files with a given extension under a path",
    category: "search",
    requires: ["fd"],
    templates: { bash: "fd --type f --extension {extension} {path}" },
  },
  {
    id: "search.glob-older",
    title: "Find files older than N days",
    description: "Locate files whose modification time is older than the given days",
    category: "search",
    requires: ["fd"],
    templates: { bash: "fd --type f --changed-before {days}d {path}" },
  },
  {
    id: "search.duplicate-names",
    title: "Find duplicate file names",
    description: "Group files that share the same basename to spot duplicates",
    category: "search",
    requires: ["fd"],
    templates: { bash: "fd --type f --absolute-path {path} | xargs -n1 basename | sort | uniq -d" },
  },
  {
    id: "search.largest",
    title: "Largest files under a path",
    description: "Show the biggest files recursively, sorted by size",
    category: "search",
    platforms: ["linux", "win32"],
    templates: { bash: "find {path} -type f -printf '%s %p\\n' | sort -rn | head -{limit}" },
  },
  {
    id: "search.recent",
    title: "Most recently modified files",
    description: "List files modified in the last N days, newest first",
    category: "search",
    platforms: ["linux", "win32"],
    templates: { bash: "find {path} -type f -mtime -{days} -printf '%T@ %p\\n' | sort -rn | head -{limit}" },
  },
  {
    id: "search.empty-dirs",
    title: "Find empty directories",
    description: "List directories that contain no entries",
    category: "search",
    templates: { bash: "find {path} -type d -empty" },
  },
]
