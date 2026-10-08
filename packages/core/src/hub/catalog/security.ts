export * as HubSecurity from "./security.js"

import type { Entry } from "../types.js"

// Static analysis through the semgrep CLI: the same scans the separate semgrep MCP server
// offered, without a server to keep running. Every entry is read-only.
export const entries: Entry[] = [
  {
    id: "security.scan",
    title: "Security and bug scan",
    description: "Scan a path with semgrep's recommended rules and print findings with file and line",
    category: "security",
    requires: ["semgrep"],
    templates: { bash: "semgrep scan --config auto --quiet --metrics off {path}" },
  },
  {
    id: "security.scan-rules",
    title: "Scan with a rule pack",
    description: "Scan a path with one semgrep rule pack or rule file, e.g. p/owasp-top-ten or rules.yml",
    category: "security",
    requires: ["semgrep"],
    templates: { bash: "semgrep scan --config {rules} --quiet --metrics off {path}" },
  },
  {
    id: "security.scan-json",
    title: "Scan findings as JSON",
    description: "Scan a path and print the findings as JSON for further filtering",
    category: "security",
    requires: ["semgrep"],
    templates: { bash: "semgrep scan --config auto --json --quiet --metrics off {path}" },
  },
]
