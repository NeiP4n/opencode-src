# Universal Tool Hub

## Purpose
A library of ready-made fast commands on top of modern CLI tools (rg, fd, jq, yq, mlr, git, docker, systemctl). The model first looks for a ready catalog entry via the `hub` tool, and `shell` stays the fallback for everything else. Hand-written `grep -r` / `find -name` / `cat | jq` are transparently rewritten into a fast tool when it is installed and the answer does not change (flags that return hidden and .gitignore files, regexes that mean different things in BRE and in rg, are left alone). Works the same on Linux, macOS and Windows: the OS is detected automatically (`hub/host.ts`).

## Structure
Catalog: `packages/core/src/hub/catalog/` — 12 category files, 144 entries: search (12, rg/fd), files (14, lsd/tree/rsync), text (12, sd/mlr), json (14, jq/yq), data (12, mlr/sqlite3), git (14), docker (12), systemd (10), process (10), network (10), system (12), windows (10, pwsh only + `platforms: ["win32"]`).

Core: `hub/types.ts` (Entry, Backend `bash | nu | pwsh`, `placeholders`, slots `{x}`, `{x?}`, `{x*}`), `hub/host.ts` (everything platform-specific: backend order, the backend shell — on Windows bash = Git Bash, never the WSL `System32\bash.exe`; binary aliases `fd`→`fdfind`, `pwsh`→`powershell`; winget/scoop/choco/cargo/~/.local/bin directories that are not yet in the process PATH; `privileged` for root), `hub/quote.ts` (escaping values for the shell and for the quoting context in a template), `hub/resolve.ts` (choose/prepare/render/missingTools/available + MissingToolError/MissingArgumentError/NoBackendError; `Machine` is an injectable machine model for tests), `hub/install.ts` (planFor/detectManager: apt, dnf, pacman, zypper, apk, brew, winget, scoop, choco; `sudo -n` for running from the panel, no sudo under root; winget only by exact id), `hub/match.ts` (3 rewrite rules), `hub/catalog/index.ts` (a flat `all` plus an id-uniqueness assert when the module loads).

Tool: `tool/plugin/hub.ts` — list/query/install/run through the same Shell+Job+Permission pipeline as shell. The call metadata carries `hubID`, `backend`, `command` — the TUI badge shows them.

Integration: `tool/plugin/shell.ts` (prepare rewrites recognized forms before the permission scan), `plugin/internal.ts` (HubTool before ShellTool), `skill/instructions.ts` (HUB_GUIDANCE: hub-first, shell-fallback), `tui/.../index.tsx` (the Hub component on top of ShellDisplay + the `HUB:<id> · <backend>` badge), `message-parts.tsx` (`"hub"` in toolDisplays).

## Entry Points
- `Hub.all`, `Hub.get(id)`, `Hub.categories()` — the catalog.
- `Hub.prepare(entry, args, { backend })` — platform, tools, render.
- `Hub.rewrite(command, available)` — the matcher for hand-written forms.
- `Hub.planFor(tools)` — the install command for the detected manager.
- The `hub` tool: `{list}`, `{query, category}`, `{id, args, backend}`, `{install: true, id}`.

## Consumers
The model via the `hub` tool; shell via rewrite; the TUI via metadata; Skill instructions via HUB_GUIDANCE. Tests: `packages/core/test/hub.test.ts` (12 tests).

## Pitfalls
- `danger: true` entries (files.remove, docker.prune, kill-force, systemd restart/enable) never get a silent allow — the permission ask is mandatory.
- Rewrite triggers only on a full match of the anchor regexes and only when the tool is on PATH; compound `&&` commands are untouched.
- windows entries are filtered out by `supportsPlatform` on linux/darwin; Linux-only entries (`ps aux --sort`, `ping -c`, `lscpu`, `journalctl`, systemd) on win32, where they have `windows.*` counterparts.
- Backend order: Linux/macOS `bash → nu → pwsh`, Windows `pwsh → bash(Git Bash) → nu`; an explicit `backend` is checked first. A plain bash template without pipes or quotes (`portable`) on Windows without Git Bash runs in PowerShell; `curl` there is invoked as `curl.exe`.
- The command runs in the shell of the chosen backend (`Rendered.shell`), not in the session's "compatible" shell.
- Argument values are escaped: a bare slot → one word; a slot inside `'…'`/`"…"` of a template stays inside the literal. NUL is rejected.
- The `hub` tool with `install` only prints the command (`planned`); it installs from the Registry panel in the TUI (`HubActions`).