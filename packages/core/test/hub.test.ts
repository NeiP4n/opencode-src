import { describe, expect, test } from "bun:test"
import { Hub } from "@opencode/core/hub/index"

// A fixed machine: which tools resolve (and under which local name) and which
// backends have a shell. Keeps every case independent of the host running it.
const machine = (input: {
  platform: NodeJS.Platform
  tools?: Record<string, string>
  shells?: Partial<Record<Hub.Backend, string>>
}): Hub.Machine => ({
  platform: input.platform,
  locate: (tool) => {
    const name = input.tools?.[tool]
    return name ? { name, path: `/bin/${name}` } : undefined
  },
  shell: (backend) => input.shells?.[backend],
})

const linux = machine({
  platform: "linux",
  tools: { rg: "rg", fd: "fd", jq: "jq", docker: "docker", curl: "curl", git: "git" },
  shells: { bash: "/bin/bash" },
})
const windows = machine({
  platform: "win32",
  tools: { rg: "rg", fd: "fd", jq: "jq", curl: "curl", git: "git", pwsh: "powershell" },
  shells: { pwsh: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", bash: "C:\\Program Files\\Git\\bin\\bash.exe" },
})

describe("Tool Hub", () => {
  test("catalog has unique ids across categories", () => {
    const ids = Hub.all.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThan(100)
  })

  test("categories cover the required backends", () => {
    const cats = Hub.categories()
    for (const expected of ["search", "files", "text", "json", "data", "git", "docker", "systemd", "process", "network", "system", "windows"]) {
      expect(cats).toContain(expected)
    }
  })

  test("prepare renders placeholders and runs bash templates in bash on linux", () => {
    const entry = Hub.get("search.content")
    expect(entry).toBeDefined()
    const rendered = Hub.prepare(entry!, { pattern: "TODO", path: "." }, { machine: linux })
    expect(rendered.backend).toBe("bash")
    expect(rendered.shell).toBe("/bin/bash")
    expect(rendered.command).toBe("rg --line-number --no-heading TODO .")
  })

  test("prepare fails fast on missing required args", () => {
    const entry = Hub.get("search.content")!
    expect(() => Hub.prepare(entry, { pattern: "TODO" }, { machine: linux })).toThrow(Hub.MissingArgumentError)
  })

  test("optional placeholders render empty", () => {
    const entry = Hub.get("docker.compose-up")!
    const rendered = Hub.prepare(entry, {}, { machine: linux })
    expect(rendered.command).toBe("docker compose up -d ")
  })

  test("danger entries never get silent allow", () => {
    const dangerous = Hub.all.filter((entry) => entry.danger === true).map((entry) => entry.id)
    expect(dangerous).toContain("files.remove")
    expect(dangerous).toContain("docker.prune")
    expect(dangerous).toContain("process.kill-force")
  })

  test("windows entries are platform-gated", () => {
    const entry = Hub.get("windows.processes")!
    expect(Hub.supportsPlatform(entry, "win32")).toBe(true)
    expect(Hub.supportsPlatform(entry, "linux")).toBe(false)
    expect(() => Hub.prepare(entry, { limit: "5" }, { machine: linux })).toThrow()
  })

  test("linux-only entries are gated the other way and have a windows counterpart", () => {
    for (const [unix, win] of [
      ["process.list", "windows.processes"],
      ["network.ping", "windows.ping"],
      ["system.memory", "windows.memory"],
      ["process.port", "windows.port-owner"],
    ]) {
      expect(Hub.supportsPlatform(Hub.get(unix)!, "win32")).toBe(false)
      expect(Hub.supportsPlatform(Hub.get(win)!, "win32")).toBe(true)
    }
  })
})

describe("backend choice per platform", () => {
  test("windows prefers PowerShell for entries that ship a pwsh template", () => {
    const rendered = Hub.prepare(Hub.get("windows.ping")!, { count: "2", host: "example.com" }, { machine: windows })
    expect(rendered.backend).toBe("pwsh")
    expect(rendered.shell).toEndWith("powershell.exe")
    expect(rendered.command).toBe("Test-Connection -Count 2 example.com")
  })

  test("windows runs bash-only templates in Git Bash, never in PowerShell", () => {
    const rendered = Hub.prepare(Hub.get("search.largest")!, { path: ".", limit: "5" }, { machine: windows })
    expect(rendered.backend).toBe("bash")
    expect(rendered.shell).toEndWith("Git\\bin\\bash.exe")
  })

  test("windows without Git Bash runs a portable bash template in PowerShell", () => {
    const noBash = machine({ platform: "win32", tools: { rg: "rg", curl: "curl" }, shells: { pwsh: "powershell.exe" } })
    const rendered = Hub.prepare(Hub.get("search.content")!, { pattern: "it's", path: "src dir" }, { machine: noBash })
    expect(rendered.backend).toBe("pwsh")
    // PowerShell quoting, not bash quoting
    expect(rendered.command).toBe("rg --line-number --no-heading 'it''s' 'src dir'")
    // curl is an alias of Invoke-WebRequest in Windows PowerShell: call the exe
    expect(Hub.prepare(Hub.get("network.headers")!, { url: "https://x.dev" }, { machine: noBash }).command).toBe(
      "curl.exe -sS -I https://x.dev",
    )
  })

  test("windows without Git Bash refuses a template that needs bash syntax", () => {
    const noBash = machine({ platform: "win32", tools: {}, shells: { pwsh: "powershell.exe" } })
    expect(() => Hub.prepare(Hub.get("search.largest")!, { path: ".", limit: "5" }, { machine: noBash })).toThrow(
      Hub.NoBackendError,
    )
  })

  test("nu is not picked over bash on linux even when installed", () => {
    const withNu = machine({ platform: "linux", shells: { bash: "/bin/bash", nu: "/usr/bin/nu" } })
    const rendered = Hub.prepare(Hub.get("system.env")!, {}, { machine: withNu })
    expect(rendered.backend).toBe("bash")
    expect(rendered.shell).toBe("/bin/bash")
    const asked = Hub.prepare(Hub.get("system.env")!, {}, { machine: withNu, backend: "nu" })
    expect(asked.backend).toBe("nu")
    expect(asked.shell).toBe("/usr/bin/nu")
  })

  test("the template follows the backend's shell, never another backend's", () => {
    const withNu = machine({ platform: "win32", shells: { pwsh: "pwsh.exe", nu: "nu.exe" } })
    const rendered = Hub.prepare(Hub.get("system.kernel")!, {}, { machine: withNu, backend: "nu" })
    expect(rendered.shell).toBe("nu.exe")
    expect(rendered.command).toBe(Hub.get("system.kernel")!.templates.nu!)
  })

  test("a renamed binary is called by its local name", () => {
    const debian = machine({ platform: "linux", tools: { fd: "fdfind" }, shells: { bash: "/bin/bash" } })
    const rendered = Hub.prepare(Hub.get("search.glob")!, { pattern: "x", path: "." }, { machine: debian })
    expect(rendered.command).toBe("fdfind --type f x .")
    // only command positions: a value that happens to be "fd" is left alone
    expect(Hub.prepare(Hub.get("search.glob")!, { pattern: "fd", path: "." }, { machine: debian }).command).toBe(
      "fdfind --type f fd .",
    )
  })
})

describe("argument quoting", () => {
  test("bare bash args are single-quoted when they need it", () => {
    const command = Hub.prepare(Hub.get("search.content")!, { pattern: "a b; rm -rf ~", path: "it's" }, { machine: linux })
      .command
    expect(command).toBe("rg --line-number --no-heading 'a b; rm -rf ~' 'it'\\''s'")
  })

  test("args inside a quoted template literal stay inside it", () => {
    const jq = Hub.prepare(Hub.get("json.filter-array")!, { condition: ".name == \"x'y\"", file: "a.json" }, { machine: linux })
    expect(jq.command).toBe("jq '[.[] | select(.name == \"x'\\''y\")]' a.json")
  })

  test("word lists split into separate arguments", () => {
    const sort = Hub.prepare(Hub.get("text.sort-lines")!, { flags: "-n -r", file: "my file" }, { machine: linux })
    expect(sort.command).toBe("sort -n -r 'my file'")
    expect(Hub.prepare(Hub.get("text.sort-lines")!, { file: "f" }, { machine: linux }).command).toBe("sort  f")
  })

  test("pwsh quoting doubles single quotes and escapes double-quoted context", () => {
    expect(Hub.quote("C:\\Users\\me", "pwsh")).toBe("C:\\Users\\me")
    expect(Hub.quote("a b", "pwsh")).toBe("'a b'")
    expect(Hub.quote("it's", "pwsh")).toBe("'it''s'")
    expect(Hub.quote("-x", "pwsh")).toBe("'-x'")
    expect(Hub.quote("$env:HOME", "pwsh")).toBe("'$env:HOME'")
  })

  test("NUL bytes are rejected", () => {
    expect(() => Hub.prepare(Hub.get("search.content")!, { pattern: "a\0b", path: "." }, { machine: linux })).toThrow(
      Hub.InvalidArgumentError,
    )
  })
})

describe("shell rewrite", () => {
  test("grep -r keeps grep's file set and output shape", () => {
    const hit = Hub.rewrite("grep -r TODO .", (tool) => tool === "rg")
    expect(hit?.id).toBe("search.content")
    expect(hit?.command).toBe("rg --no-heading --with-filename --no-line-number --hidden --no-ignore --no-messages TODO .")
  })

  test("quoted tokens are copied verbatim", () => {
    const hit = Hub.rewrite("grep -r 'foo bar' src", (tool) => tool === "rg")
    expect(hit?.command).toEndWith(" 'foo bar' src")
  })

  test("patterns whose regex meaning differs between grep and rg are left alone", () => {
    for (const pattern of ["'a|b'", "'a+'", "'x\\(y\\)'", "'{1}'"]) {
      expect(Hub.rewrite(`grep -r ${pattern} .`, () => true)).toBeUndefined()
    }
  })

  test("rewrite refuses when the target tool is missing", () => {
    expect(Hub.rewrite("grep -r TODO .", () => false)).toBeUndefined()
  })

  test("rewrite refuses compound commands", () => {
    expect(Hub.rewrite("grep -r TODO . && echo done", () => true)).toBeUndefined()
    expect(Hub.rewrite("grep -r $(whoami) .", () => true)).toBeUndefined()
  })

  test("find -name uses the local fd name and find's case and file set", () => {
    const hit = Hub.rewrite("find src -name '*.ts'", (tool) => (tool === "fd" ? "fdfind" : undefined))
    expect(hit?.id).toBe("search.glob-extension")
    expect(hit?.command).toBe("fdfind --hidden --no-ignore --case-sensitive --glob '*.ts' src")
  })

  test("rewrite upgrades cat-file-jq to the pretty entry", () => {
    const hit = Hub.rewrite("cat data.json | jq .", (tool) => tool === "jq")
    expect(hit?.id).toBe("json.pretty")
    expect(hit?.command).toBe("jq . data.json")
  })
})

describe("install planner", () => {
  test("returns undefined when no manager exists", () => {
    const previous = process.env.PATH
    process.env.PATH = ""
    try {
      expect(Hub.planFor(["rg"], "win32", "/nonexistent-bin-dir")).toBeUndefined()
      expect(Hub.planFor(["rg"], "linux", "/nonexistent-bin-dir")).toBeUndefined()
    } finally {
      process.env.PATH = previous
    }
  })
})

describe("host", () => {
  test("platform order leads with the native shell", () => {
    expect(Hub.HubHost.order("linux")).toEqual(["bash", "nu", "pwsh"])
    expect(Hub.HubHost.order("darwin")).toEqual(["bash", "nu", "pwsh"])
    expect(Hub.HubHost.order("win32")).toEqual(["pwsh", "bash", "nu"])
  })

  test("spawn PATH keeps the inherited entries first and the env's own key", () => {
    const env = { Path: ["A", "B"].join(process.platform === "win32" ? ";" : ":") }
    const result = Hub.HubHost.spawnPath(env)
    expect(result.key).toBe("Path")
    expect(result.value.startsWith(env.Path)).toBe(true)
  })

  test("on windows bash never resolves to the WSL launcher", () => {
    if (process.platform !== "win32") return
    const bash = Hub.HubHost.shellFor("bash")
    if (bash) expect(bash.toLowerCase()).not.toContain("system32")
  })
})
