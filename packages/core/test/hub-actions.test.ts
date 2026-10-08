import { describe, expect, test } from "bun:test"
import { symlink, writeFile } from "node:fs/promises"
import path from "path"
import { failureReason, installTool, removeTool, type RunResult, type Runner } from "@opencode/core/hub/actions"
import { tmpdir } from "./fixture/tmpdir"
import { Hub } from "@opencode/core/hub/index"

// A PATH holding only fake manager binaries: detection still sees the manager,
// but no real package manager can ever be executed from a test.
const fakeBin = async (scripts: Record<string, string>) => {
  const dir = await tmpdir()
  await Promise.all(
    Object.entries(scripts).map(([name, body]) =>
      writeFile(path.join(dir.path, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 }),
    ),
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

describe("Hub install/remove actions", () => {
  test("linux install runs the pacman command through the injected runner", async () => {
    await using bin = await fakeBin({ pacman: "exit 0" })
    const { runner, calls } = recorder({ exit: 0, stdout: "installed", stderr: "" })

    const result = await withPath(bin.path, () => installTool("rg", { platform: "linux", runner }))

    expect(result).toEqual({ ok: true, exit: 0, output: "installed", command: "sudo pacman -S --noconfirm ripgrep" })
    expect(calls).toEqual(["sudo pacman -S --noconfirm ripgrep"])
  })

  test("linux remove targets the same package pacman installs", async () => {
    await using bin = await fakeBin({ pacman: "exit 0" })
    const { runner, calls } = recorder({ exit: 0, stdout: "removed", stderr: "" })

    const result = await withPath(bin.path, () => removeTool("rg", { platform: "linux", runner }))

    expect(result).toEqual({ ok: true, exit: 0, output: "removed", command: "sudo pacman -R --noconfirm ripgrep" })
    expect(calls).toEqual(["sudo pacman -R --noconfirm ripgrep"])
  })

  test("win32 install and remove use winget syntax", async () => {
    await using bin = await fakeBin({ winget: "exit 0" })
    const { runner } = recorder({ exit: 0, stdout: "", stderr: "" })

    const install = await withPath(bin.path, () => installTool("mlr", { platform: "win32", runner }))
    const remove = await withPath(bin.path, () => removeTool("mlr", { platform: "win32", runner }))

    expect(install.command).toBe("winget install --accept-package-agreements johnkerl.miller")
    expect(remove.command).toBe("winget uninstall johnkerl.miller")
    expect(install.ok).toBe(true)
    expect(remove.ok).toBe(true)
  })

  test("non-zero exit fails with the command and stderr instead of parsing text", async () => {
    await using bin = await fakeBin({ pacman: "exit 0" })
    const { runner, calls } = recorder({
      exit: 1,
      // success wording in stdout must not flip the verdict: only the exit code decides
      stdout: "rg is already the newest version",
      stderr: "sudo: a password is required",
    })

    const result = await withPath(bin.path, () => installTool("rg", { platform: "linux", runner }))

    expect(result.ok).toBe(false)
    expect(result.exit).toBe(1)
    expect(result.output).toContain(result.command)
    expect(result.output).toContain("sudo: a password is required")
    expect(calls).toEqual(["sudo pacman -S --noconfirm ripgrep"])
  })

  test("missing package manager reports failure without running anything", async () => {
    await using empty = await fakeBin({})
    const { runner, calls } = recorder({ exit: 0, stdout: "", stderr: "" })

    const install = await withPath(empty.path, () => installTool("rg", { platform: "linux", runner }))
    const remove = await withPath(empty.path, () => removeTool("rg", { platform: "linux", runner }))

    expect(install).toEqual({
      ok: false,
      exit: 1,
      output: "no package manager detected on linux: nothing ran for rg",
      command: "",
    })
    expect(remove.ok).toBe(false)
    expect(remove.command).toBe("")
    expect(calls).toEqual([])
  })

  test("a name outside the catalog never reaches the shell", async () => {
    await using bin = await fakeBin({ pacman: "exit 0" })
    const { runner, calls } = recorder({ exit: 0, stdout: "", stderr: "" })

    const install = await withPath(bin.path, () => installTool("rg; touch pwned", { platform: "linux", runner }))
    const remove = await withPath(bin.path, () => removeTool("$(id)", { platform: "linux", runner }))

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

  test("default runner shells the command and reports its output", async () => {
    await using bin = await fakeBin({ pacman: "exit 0", sudo: "echo fake-sudo ran" })
    // the shell itself must resolve inside the restricted PATH to start at all
    await symlink(Bun.which("sh") ?? "/bin/sh", path.join(bin.path, "sh"))

    const result = await withPath(bin.path, () => installTool("rg", { platform: "linux" }))

    expect(result.command).toBe("sudo pacman -S --noconfirm ripgrep")
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
    await withPath(bin.path, () => installTool("nu", { platform: "linux", runner }))
    expect(calls).toEqual(["sudo pacman -S --noconfirm nushell"])
  })

  test("PowerShell on Arch is pointed at the AUR instead of a pacman install", () => {
    expect(Hub.installable("pwsh", "pacman")).toBe(false)
    expect(Hub.manualInstall("pwsh", "pacman")).toContain("powershell-bin")
    expect(Hub.installable("pwsh", "apt")).toBe(true)
  })
})
