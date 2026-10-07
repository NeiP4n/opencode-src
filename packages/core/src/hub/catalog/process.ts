export * as HubProcess from "./process.js"

import type { Entry } from "../types.js"

// Process inspection and signal handling.
export const entries: Entry[] = [
  {
    id: "process.list",
    title: "Process snapshot",
    description: "Processes sorted by CPU with PID, command and usage",
    category: "process",
    requires: ["ps"],
    templates: { bash: "ps aux --sort=-%cpu | head -{limit}" },
  },
  {
    id: "process.memory",
    title: "Top memory consumers",
    description: "Processes sorted by resident memory",
    category: "process",
    requires: ["ps"],
    templates: { bash: "ps aux --sort=-%mem | head -{limit}" },
  },
  {
    id: "process.find",
    title: "Find a process by name",
    description: "Match running processes against a pattern",
    category: "process",
    requires: ["pgrep"],
    templates: { bash: "pgrep -af {pattern}" },
  },
  {
    id: "process.kill",
    title: "Terminate a process",
    description: "Send SIGTERM to a PID",
    category: "process",
    requires: ["kill"],
    danger: true,
    templates: { bash: "kill {pid}" },
  },
  {
    id: "process.kill-force",
    title: "Force-kill a process",
    description: "Send SIGKILL to a PID",
    category: "process",
    requires: ["kill"],
    danger: true,
    templates: { bash: "kill -9 {pid}" },
  },
  {
    id: "process.tree",
    title: "Process tree",
    description: "Parent-child tree for one PID or the whole system",
    category: "process",
    requires: ["pstree"],
    templates: { bash: "pstree -p {pid?}" },
  },
  {
    id: "process.open-files",
    title: "Open files of a process",
    description: "Files and sockets a PID holds open",
    category: "process",
    requires: ["lsof"],
    templates: { bash: "lsof -p {pid}" },
  },
  {
    id: "process.port",
    title: "Process listening on a port",
    description: "Which process owns a TCP/UDP port",
    category: "process",
    requires: ["lsof"],
    templates: { bash: "lsof -iTCP:{port} -sTCP:LISTEN" },
  },
  {
    id: "process.uptime",
    title: "System uptime and load",
    description: "Uptime, load averages and online users",
    category: "process",
    templates: { bash: "uptime" },
  },
  {
    id: "process.limit",
    title: "Process limits",
    description: "Resource limits of the current shell",
    category: "process",
    templates: { bash: "ulimit -a" },
  },
]
