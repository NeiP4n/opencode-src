export * as HubSystem from "./system.js"

import type { Entry } from "../types.js"

// Host information and package management. nushell templates for the same
// lookups are provided where they differ meaningfully from POSIX output.
export const entries: Entry[] = [
  {
    id: "system.kernel",
    title: "Kernel and architecture",
    description: "OS release, kernel version and CPU architecture",
    category: "system",
    templates: {
      bash: "uname -a",
      nu: "sys | into record | first | format-list",
    },
  },
  {
    id: "system.memory",
    title: "Memory usage",
    description: "Total, free and available RAM",
    category: "system",
    templates: {
      bash: "free -h",
      nu: "sys mem | format-list",
    },
  },
  {
    id: "system.cpu",
    title: "CPU model and cores",
    description: "Processor model, core count and current frequency",
    category: "system",
    templates: { bash: "lscpu | head -{limit}" },
  },
  {
    id: "system.block-devices",
    title: "Block devices",
    description: "Disks, partitions, filesystems and mount points",
    category: "system",
    templates: { bash: "lsblk -f" },
  },
  {
    id: "system.env",
    title: "Sorted environment",
    description: "Environment variables sorted by name",
    category: "system",
    templates: {
      bash: "env | sort",
      nu: "env | sort-by name | transpose k v | each {|r| $'($r.k)=($r.v)'} | str join (char nl)",
    },
  },
  {
    id: "system.groups",
    title: "User groups",
    description: "Groups of the current user",
    category: "system",
    templates: { bash: "id" },
  },
  {
    id: "system.logged-in",
    title: "Logged-in users",
    description: "Who is signed in and since when",
    category: "system",
    templates: { bash: "who" },
  },
  {
    id: "system.log",
    title: "System log tail",
    description: "Last lines of the system log",
    category: "system",
    templates: { bash: "journalctl -n {lines} --no-pager" },
  },
  {
    id: "system.pkg-list",
    title: "Installed packages",
    description: "Installed packages for the detected package manager",
    category: "system",
    requires: ["dpkg-query"],
    templates: { bash: "dpkg-query -W | sort" },
  },
  {
    id: "system.pkg-search",
    title: "Search a package",
    description: "Find an available package by name substring",
    category: "system",
    requires: ["apt-cache"],
    templates: { bash: "apt-cache search {query}" },
  },
  {
    id: "system.clock",
    title: "Current time and timezone",
    description: "Date, time and timezone in ISO format",
    category: "system",
    templates: {
      bash: "date --iso-8601=seconds",
      nu: "date now | format date '%Y-%m-%dT%H:%M:%S%z'",
    },
  },
  {
    id: "system.timer-list",
    title: "Scheduled timers",
    description: "systemd timers with next run time",
    category: "system",
    requires: ["systemctl"],
    templates: { bash: "systemctl list-timers --no-pager" },
  },
]
