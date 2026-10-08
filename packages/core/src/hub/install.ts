export * as HubInstall from "./install.js"

import { which } from "../util/which.js"

// Package name per tool per manager. Tools absent here fall back to their
// binary name, which is the right package on most managers anyway.
const PACKAGE: Record<string, Partial<Record<Manager, string>>> = {
  rg: { apt: "ripgrep", dnf: "ripgrep", pacman: "ripgrep", brew: "ripgrep", winget: "BurntSushi.ripgrep.MSVC" },
  fd: { apt: "fd-find", dnf: "fd-find", pacman: "fd", brew: "fd", winget: "sharkdp.fd" },
  jq: { winget: "jqlang.jq" },
  // The catalog uses mikefarah's yq syntax; Arch ships it as go-yq, while its `yq` is the Python wrapper.
  yq: { apt: "yq", dnf: "yq", pacman: "go-yq", brew: "yq", winget: "mikefarah.yq" },
  mlr: { apt: "miller", dnf: "miller", pacman: "miller", brew: "miller", winget: "johnkerl.miller" },
  nu: { apt: "nushell", dnf: "nushell", pacman: "nushell", brew: "nushell", winget: "nushell.nushell" },
  pwsh: {
    apt: "powershell",
    dnf: "powershell",
    brew: "powershell",
    winget: "Microsoft.PowerShell",
    scoop: "pwsh",
    choco: "powershell-core",
  },
  lsd: { apt: "lsd", brew: "lsd", winget: "Chemadic.lsd" },
  sd: { apt: "sd", brew: "sd" },
  watchexec: { apt: "watchexec", brew: "watchexec" },
  "diff-so-fancy": { brew: "diff-so-fancy" },
  pstree: { apt: "psmisc", dnf: "psmisc", pacman: "psmisc" },
  nc: { apt: "netcat-openbsd", dnf: "nmap-ncat", pacman: "gnu-netcat" },
  traceroute: { apt: "traceroute", dnf: "traceroute", pacman: "traceroute" },
}

// Tools that only exist on some managers' systems: Debian's package tooling
// cannot be installed through pacman or dnf, so offering it there only fails.
const ONLY: Record<string, readonly Manager[]> = {
  "apt-cache": ["apt"],
  "dpkg-query": ["apt"],
  // Arch ships PowerShell only through the AUR, which pacman cannot install.
  pwsh: ["apt", "dnf", "brew", "winget", "choco", "scoop"],
}

// What to tell the operator when the manager cannot install a tool itself.
const MANUAL: Record<string, Partial<Record<Manager, string>>> = {
  pwsh: { pacman: "from the AUR: yay -S powershell-bin" },
}

export function manualInstall(tool: string, manager: Manager | undefined) {
  return manager ? MANUAL[tool]?.[manager] : undefined
}

export function installable(tool: string, manager: Manager | undefined) {
  const only = ONLY[tool]
  if (!only) return true
  return manager !== undefined && only.includes(manager)
}

export type Manager = "apt" | "dnf" | "pacman" | "brew" | "winget" | "choco" | "scoop"

// Detection order mirrors what a given platform is most likely to carry;
// win32 never gets unix managers and vice versa.
function candidates(platform: NodeJS.Platform): Manager[] {
  if (platform === "win32") return ["winget", "scoop", "choco"]
  if (platform === "darwin") return ["brew"]
  return ["apt", "dnf", "pacman"]
}

export function detectManager(platform: NodeJS.Platform = process.platform, bin?: string): Manager | undefined {
  const names: Record<Manager, string> = {
    apt: "apt-get",
    dnf: "dnf",
    pacman: "pacman",
    brew: "brew",
    winget: "winget",
    choco: "choco",
    scoop: "scoop",
  }
  return candidates(platform).find((manager) => which(names[manager], undefined, bin))
}

function installCommand(manager: Manager, packages: string[]): string {
  const joined = packages.join(" ")
  switch (manager) {
    case "apt":
      return `sudo apt-get install -y ${joined}`
    case "dnf":
      return `sudo dnf install -y ${joined}`
    case "pacman":
      return `sudo pacman -S --noconfirm ${joined}`
    case "brew":
      return `brew install ${joined}`
    case "winget":
      return `winget install --accept-package-agreements ${joined}`
    case "choco":
      return `choco install -y ${joined}`
    case "scoop":
      return `scoop install ${joined}`
  }
}

// Maps tool names to the package names this manager knows them by, so install
// and remove address the same package for a given tool.
function packagesFor(manager: Manager, tools: readonly string[]): string[] {
  return Array.from(new Set(tools.map((tool) => PACKAGE[tool]?.[manager] ?? tool)))
}

// Removal counterpart of installCommand: same package mapping, manager-specific
// uninstall syntax. Mirrors installCommand's shape for easy side-by-side reading.
export function removeCommand(manager: Manager, tools: readonly string[]): string {
  const joined = packagesFor(manager, tools).join(" ")
  switch (manager) {
    case "apt":
      return `sudo apt-get remove -y ${joined}`
    case "dnf":
      return `sudo dnf remove -y ${joined}`
    case "pacman":
      return `sudo pacman -R --noconfirm ${joined}`
    case "brew":
      return `brew uninstall ${joined}`
    case "winget":
      return `winget uninstall ${joined}`
    case "choco":
      return `choco uninstall -y ${joined}`
    case "scoop":
      return `scoop uninstall ${joined}`
  }
}

export type Plan = {
  readonly manager: Manager
  readonly command: string
  readonly tools: readonly string[]
}

// Builds the install command for tools an entry is missing. Returns undefined
// when no manager is detected: the caller then falls back to plain bash.
export function planFor(
  tools: readonly string[],
  platform: NodeJS.Platform = process.platform,
  bin?: string,
): Plan | undefined {
  if (tools.length === 0) return undefined
  const manager = detectManager(platform, bin)
  if (!manager) return undefined
  return { manager, command: installCommand(manager, packagesFor(manager, tools)), tools }
}
