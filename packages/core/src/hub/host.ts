export * as HubHost from "./host.js"

import os from "os"
import path from "path"
import { lstatSync, statSync } from "fs"
import type { Backend } from "./types.js"
import { which } from "../util/which.js"

// Everything the hub needs to know about the machine it runs on lives here:
// which binary answers to a catalog tool name, where package managers drop
// binaries that the current process PATH has not picked up yet, and which
// shell executable runs a given backend. Linux, macOS and Windows differ in
// all three, and every caller goes through these helpers instead of `which`.

export type Probe = {
  readonly platform?: NodeJS.Platform
  // Extra directory (or path.delimiter-joined list) searched after PATH.
  readonly bin?: string
  // false limits the search to PATH (+ bin): the shell tool's rewrite must only
  // fire for binaries the user's own shell can already resolve.
  readonly extras?: boolean
}

export type Located = {
  // The word to put in a command: `fdfind` on Debian, `powershell` on a
  // Windows box without PowerShell 7, the catalog name everywhere else.
  readonly name: string
  readonly path: string
}

// Distro and OS renames of a catalog tool, tried in order after the canonical
// name. Debian/Ubuntu ship fd as `fdfind`; Windows always has PowerShell 5.1
// as `powershell.exe` even when PowerShell 7 (`pwsh`) is absent.
function names(tool: string, platform: NodeJS.Platform): string[] {
  if (tool === "fd") return ["fd", "fdfind"]
  if (tool === "pwsh" && platform === "win32") return ["pwsh", "powershell"]
  return [tool]
}

// Install targets of user-level package managers. A fresh `winget install`
// puts its shim into WinGet\Links and only the registry PATH learns about it,
// so a running opencode would keep reporting the tool as missing until a
// restart. Only directories that exist are returned.
export function extraDirs(platform: NodeJS.Platform = process.platform): string[] {
  const home = os.homedir()
  const dirs =
    platform === "win32"
      ? [
          process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links"),
          path.join(process.env.SCOOP ?? path.join(home, "scoop"), "shims"),
          path.join(process.env.ChocolateyInstall ?? path.join(process.env.ProgramData ?? "C:\\ProgramData", "chocolatey"), "bin"),
          path.join(home, ".cargo", "bin"),
        ]
      : [
          path.join(home, ".local", "bin"),
          path.join(home, ".cargo", "bin"),
          "/home/linuxbrew/.linuxbrew/bin",
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/sbin",
          "/sbin",
        ]
  return dirs.filter((dir): dir is string => typeof dir === "string" && isDirectory(dir))
}

// `which` plus the one case it misses: Windows app execution aliases in
// WindowsApps (winget, Store-installed pwsh) are reparse points that refuse
// `stat` with EACCES, so `which` skips them although the shell runs them fine.
export function find(cmd: string, bin?: string): string | undefined {
  const found = which(cmd, undefined, bin)
  if (found) return found
  if (process.platform !== "win32") return undefined
  const dirs = [...(process.env.PATH ?? "").split(path.delimiter), ...(bin ? bin.split(path.delimiter) : [])]
  const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
  for (const dir of dirs.filter(Boolean)) {
    for (const ext of exts) {
      const file = path.join(dir, cmd + ext.toLowerCase())
      if (lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) return file
    }
  }
  return undefined
}

function searchPath(probe: Probe): string | undefined {
  const dirs = [...(probe.bin ? [probe.bin] : []), ...(probe.extras === false ? [] : extraDirs(probe.platform))]
  return dirs.length > 0 ? dirs.join(path.delimiter) : undefined
}

export function locate(tool: string, probe: Probe = {}): Located | undefined {
  const platform = probe.platform ?? process.platform
  const bin = searchPath(probe)
  for (const name of names(tool, platform)) {
    const found = find(name, bin)
    if (found) return { name, path: found }
  }
  return undefined
}

export function has(tool: string, probe: Probe = {}): boolean {
  return locate(tool, probe) !== undefined
}

// Value for the PATH of a process the hub spawns: the inherited PATH plus the
// user-level install directories, so a tool installed after startup resolves.
export function spawnPath(env: Record<string, string | undefined> = process.env, platform = process.platform) {
  const key = pathKey(env)
  const current = env[key] ?? ""
  const parts = current.split(path.delimiter).filter(Boolean)
  const seen = new Set(parts.map((part) => (platform === "win32" ? part.toLowerCase() : part)))
  for (const dir of extraDirs(platform)) {
    if (!seen.has(platform === "win32" ? dir.toLowerCase() : dir)) parts.push(dir)
  }
  return { key, value: parts.join(path.delimiter) }
}

// Windows keeps the variable as `Path`; a copied env object loses the
// case-insensitive lookup process.env has there.
export function pathKey(env: Record<string, string | undefined>): string {
  return Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH"
}

// Git for Windows' bash. Never the System32 `bash.exe`, which is the WSL
// launcher and runs the command inside a Linux VM with a different filesystem.
export function gitBash(probe: Probe = {}): string | undefined {
  const git = find("git", searchPath(probe))
  const candidates = [
    ...(git ? [path.join(git, "..", "..", "bin", "bash.exe"), path.join(git, "..", "..", "..", "bin", "bash.exe")] : []),
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe"),
    ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe")] : []),
  ]
  return candidates.find((file) => isFile(file))
}

// Executable that runs a backend's template, or undefined when the backend is
// unusable on this machine.
export function shellFor(backend: Backend, probe: Probe = {}): string | undefined {
  const platform = probe.platform ?? process.platform
  if (backend === "bash") {
    if (platform === "win32") return gitBash(probe)
    return locate("bash", probe)?.path ?? locate("sh", probe)?.path
  }
  if (backend === "pwsh") return locate("pwsh", probe)?.path
  return locate("nu", probe)?.path
}

// Backend preference when the caller does not ask for one. Each OS leads with
// its native shell; the others follow only when the entry ships a template.
export function order(platform: NodeJS.Platform = process.platform): Backend[] {
  return platform === "win32" ? ["pwsh", "bash", "nu"] : ["bash", "nu", "pwsh"]
}

// Backends with a working shell right now, in this platform's order.
export function backends(probe: Probe = {}): Backend[] {
  return order(probe.platform).filter((backend) => shellFor(backend, probe) !== undefined)
}

// The command line actually handed to the backend's shell. Windows
// PowerShell writes to a pipe in the OEM code page (cp866 on a Russian
// system), which arrives as mojibake once read as UTF-8; switching the console
// output encoding first makes every Windows locale come through intact.
export function executable(command: string, backend: Backend, platform: NodeJS.Platform = process.platform): string {
  if (backend !== "pwsh" || platform !== "win32") return command
  return `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`
}

// True when the current process may change system packages without sudo.
export function privileged(platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "win32") return false
  return typeof process.getuid === "function" && process.getuid() === 0
}

function isFile(file: string) {
  return statSync(file, { throwIfNoEntry: false })?.isFile() === true
}

function isDirectory(dir: string) {
  return statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true
}
