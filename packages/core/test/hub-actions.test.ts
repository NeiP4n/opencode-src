import { describe, expect, test } from "bun:test"
import { symlink, writeFile } from "node:fs/promises"
import path from "path"
import { failureReason, installTool, removeTool, type RunResult, type Runner } from "@opencode/core/hub/actions"
import { tmpdir } from "./fixture/tmpdir"
import { Hub, HubActions } from "@opencode/core/hub/index"

// A PATH holding only fake manager binaries: detection still sees the manager,
// but no real package manager can ever be executed from a test. Windows finds
// executables through PATHEXT, so each fake also gets a .cmd twin.
const fakeBin = async (scripts: Record<string, string>) => {
  const dir = await tmpdir()
  await Promise.all(
    Object.entries(scripts).flatMap(([name, body]) => [
      writeFile(path.join(dir.path, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 }),
      writeFile(path.join(dir.path, `${name}.cmd`), `@echo off\r\n${body.replace(/^exit /, "exit /b ")}\r\n`),
    ]),
  )
  return dir
}

// PATH is the only way to steer manager detection through the public options;
// restored in finally so a failing assertion cannot leak into other tests.
const withPath = async <T>(value: string, body: () => Promise<T>): Promise<T> => {
  const previous = process.env.PATH
  process.env.PATH = value
  try {
    return await body()
  } finally {
    process.env.PATH = previous
  }
}

const recorder = (result: RunResult): { runner: Runner; calls: string[] } => {
  const calls: string[] = []
  return {
    runner: async (command) => {
      calls.push(command)
      return result
    },
    calls,
  }
}

// Pinned so the expected sudo prefix does not depend on who runs the suite.
const user = { privileged: false } as const

describe("Hub install/remove actions", () => {
  test("linux install runs pacman through non-interactive sudo", async () => {
    await using bin = await fakeBin({ pacman: "exit 0" })
    const { runner, calls } = recorder({ exit: 0, stdout: "installed", stderr: "" })

    const result = await withPath(bin.path, () => installTool("rg", { platform: "linux", runner, ...user }))

    expect(result).toEqual({
      ok: true,
      exit: 0,
      output: "installed",
      command: "sudo -n pacman -S --needed --noconfirm ripgrep",
    })
    expect(calls).toEqual(["sudo -n pacman -S --needed --noconfirm ripgrep"])
  })

  test("linux remove targets the same package pacman installs", async () => {
    await using bin = await fakeBin({ pacman: "exit 0" })
    const { runner, calls } = recorder({ exit: 0, stdout: "removed", stderr: "" })

    const result = await withPath(bin.path, () => removeTool("rg", { platform: "linux", runner, ...user }))

    expect(result).toEqual({ ok: true, exit: 0, output: "removed", command: "sudo -n pacman -R --noconfirm ripgrep" })
    expect(calls).toEqual(["sudo -n pacman -R --noconfirm ripgrep"])
  })

  test("root runs system managers without sudo", async () => {
    await using bin = await fakeBin({ "apt-get": "exit 0" })
    const { runner, calls } = recorder({ exit: 0, stdout: "", stderr: "" })

    await withPath(bin.path, () => installTool("fd", { platform: "linux", runner, privileged: true }))

    expect(calls).toEqual(["apt-get install -y fd-find"])
  })

  test("win32 install and remove use exact winget package ids", async () => {
    await using bin = await fakeBin({ winget: "exit 0" })
    const { runner } = recorder({ exit: 0, stdout: "", stderr: "" })

    const install = await withPath(bin.path, () => installTool("mlr", { platform: "win32", runner, ...user }))
    const remove = await withPath(bin.path, () => removeTool("mlr", { platform: "win32", runner, ...user }))

    expect(install.command).toBe(
      "winget install --id Miller.Miller -e --silent --accept-package-agreements --accept-source-agreements",
    )
    expect(remove.command).toBe("winget uninstall --id Miller.Miller -e --silent --accept-source-agreements")
    expect(install.ok).toBe(true)
    expect(remove.ok).toBe(true)
  })

  test("winget skips tools it has no package id for instead of guessing", async () => {
    await using bin = await fakeBin({ winget: "exit 0" })
    const { runner, calls } = recorder({ exit: 0, stdout: "", stderr: "" })

    const result = await withPath(bin.path, () => installTool("rsync", { platform: "win32", runner, ...user }))

    expect(result.ok).toBe(false)
    expect(result.command).toBe("")
    expect(calls).toEqual([])
  })

  test("non-zero exit fails with the command and stderr instead of parsing text", async () => {
    await using bin = await fakeBin({ pacman: "exit 0" })
    const { runner, calls } = recorder({
      exit: 1,
      // success wording in stdout must not flip the verdict: only the exit code decides
      stdout: "rg is already the newest version",
      stderr: "sudo: a password is required",
    })

    const result = await withPath(bin.path, () => installTool("rg", { platform: "linux", runner, ...user }))

    expect(result.ok).toBe(false)
    expect(result.exit).toBe(1)
    expect(result.output).toContain(result.command)
    expect(result.output).toContain("sudo: a password is required")
    expect(calls).toEqual(["sudo -n pacman -S --needed --noconfirm ripgrep"])
  })

  test("missing package manager reports failure without running anything", async () => {
    await using empty = await fakeBin({})
    const { runner, calls } = recorder({ exit: 0, stdout: "", stderr: "" })

    const install = await withPath(empty.path, () => installTool("rg", { platform: "linux", runner, ...user }))
    const remove = await withPath(empty.path, () => removeTool("rg", { platform: "linux", runner, ...user }))

    expect(install).toEqual({
      ok: false,
      exit: 1,
      output: "no package manager with a package for rg detected on linux: nothing ran",
      command: "",
    })
    expect(remove.ok).toBe(false)
    expect(remove.command).toBe("")
    expect(calls).toEqual([])
  })

  test("a name outside the catalog never reaches the shell", async () => {
    await using bin = await fakeBin({ pacman: "exit 0" })
    const { runner, calls } = recorder({ exit: 0, stdout: "", stderr: "" })

    const install = await withPath(bin.path, () =>
      installTool("rg; touch pwned", { platform: "linux", runner, ...user }),
    )
    const remove = await withPath(bin.path, () => removeTool("$(id)", { platform: "linux", runner, ...user }))

    // the command is rejected before planFor, so no shell string exists to run
    expect(install).toEqual({
      ok: false,
      exit: 1,
      output: 'unknown tool "rg; touch pwned": not in the hub catalog',
      command: "",
    })
    expect(remove.ok).toBe(false)
    expect(remove.command).toBe("")
    expect(calls).toEqual([])
  })

  test("default runner on windows shells through cmd and reports its output", async () => {
    if (process.platform !== "win32") return
    await using bin = await fakeBin({ winget: "echo fake-winget ran" })

    const result = await withPath(bin.path, () => installTool("rg", { platform: "win32", ...user }))

    expect(result.ok).toBe(true)
    expect(result.output).toContain("fake-winget ran")
  })

  test("default runner shells the command and reports its output", async () => {
    if (process.platform === "win32") return
    await using bin = await fakeBin({ pacman: "exit 0", sudo: "echo fake-sudo ran" })
    // the shell itself must resolve inside the restricted PATH to start at all
    await symlink(Bun.which("sh") ?? "/bin/sh", path.join(bin.path, "sh"))

    const result = await withPath(bin.path, () => installTool("rg", { platform: "linux", ...user }))

    expect(result.command).toBe("sudo -n pacman -S --needed --noconfirm ripgrep")
    expect(result.ok).toBe(true)
    expect(result.exit).toBe(0)
    expect(result.output).toContain("fake-sudo ran")
  })
})

describe("failureReason", () => {
  test("explains a held pacman lock instead of echoing the advice line", () => {
    const output =
      "sudo pacman -S --noconfirm go-yq\nошибка: не удалось заблокировать базу данных: Файл существует\n  можно удалить '/var/lib/pacman/db.lck'"
    expect(failureReason(output)).toContain("pacman database is locked")
  })

  test("prefers the first error line over trailing hints", () => {
    expect(failureReason("cmd\nerror: target not found: foo\nhint: try again")).toBe("error: target not found: foo")
  })
})

describe("terminal installs", () => {
  test("nushell installs through pacman under its package name", async () => {
    await using bin = await fakeBin({ pacman: "exit 0" })
    const { runner, calls } = recorder({ exit: 0, stdout: "", stderr: "" })
    await withPath(bin.path, () => installTool("nu", { platform: "linux", runner, privileged: false }))
    expect(calls).toEqual(["sudo -n pacman -S --needed --noconfirm nushell"])
  })

  test("PowerShell on Arch is pointed at the AUR instead of a pacman install", () => {
    expect(Hub.installable("pwsh", "pacman")).toBe(false)
    expect(Hub.manualInstall("pwsh", "pacman")).toContain("powershell-bin")
    expect(Hub.installable("pwsh", "apt")).toBe(true)
  })
})

describe("stale package databases", () => {
  test("a mirror 404 is recognised and explained", () => {
    const output =
      "sudo pacman -S --noconfirm nushell\nошибка: не удалось получить файл 'nushell-0.115.1-1.1-x86_64_v4.pkg.tar.zst' из cdn77.cachyos.org : The requested URL returned error: 404"
    expect(HubActions.staleDatabase(output)).toBe(true)
    expect(failureReason(output)).toBe("the package databases are outdated: update the system, then install again")
    expect(HubActions.staleDatabase("error: target not found: foo")).toBe(false)
  })

  test("updating the system on Arch is a full upgrade, never a bare database sync", async () => {
    await using bin = await fakeBin({ pacman: "exit 0" })
    const { runner, calls } = recorder({ exit: 0, stdout: "", stderr: "" })
    await withPath(bin.path, () => HubActions.updateSystem({ platform: "linux", runner, privileged: false }))
    expect(calls).toEqual(["sudo -n pacman -Syu --noconfirm"])
  })
})
