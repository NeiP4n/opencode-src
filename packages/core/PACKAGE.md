# @opencode/core — the opencode core

## What This Is

The heart of the system: 431 files, ~65k lines in `src/` (plus ~96k lines
of tests in `core/test/` — the logic lives in `src/`). Everything that
makes opencode opencode lives here: sessions, model tools, providers,
permissions, database, configuration, plugins, filesystem, git, MCP,
skills.

The `server` layer mounts these subsystems into the HTTP API, while `tui`
shows them to the user; `core` itself knows nothing about them.

## Layers and Dependencies

Layer **L4 — core**: depends on `ai`, `codemode`, `plugin`,
`plugin-browser`, `schema`, `util`.

Who imports it: `server`, `cli`, `sdk`, `tui`, `simulation`, `client`
(tests), `enterprise`.

## Subsystems and Files

**Graph assembly** — `packages/core/src/instance.ts`, line 114:
`export const graph = LayerNode.group(nodes)` — where core dependencies are
assembled. Two similar graphs assemble plugin requirements:
`packages/core/src/plugin/host.ts` (line 574) and
`packages/core/src/plugin/internal.ts` (line 160).

**Event bus** — `packages/core/src/bus.ts` (908 lines) — the real event
engine. The `packages/core/src/event/` directory contains only `sql.ts`
(a table); do not look for the logic there.

**Database** — the `packages/core/src/database/` directory (77 files).
Three runtime variants: `sqlite.bun.ts`, `sqlite.node.ts`,
`sqlite.workerd.ts` — editing one does not edit the others.

**Sessions** — `packages/core/src/session.ts` (483 lines) and the
`packages/core/src/session/` directory (49 files): lifecycle, messages,
fork/revert, compaction, inbox.

**Tools** — `packages/core/src/tool.ts` (332 lines) and the
`packages/core/src/tool/` directory (20 files): `bash`, `edit`, `read`,
`write`, `grep`, `glob`, `patch`, `task`, `todowrite`, `webfetch`, `lsp`,
`skill`, `session`, `snapshot`, `formatter`, `filesystem`, `instruction`,
`credential`, `job`, `kv`, `codemode`, `effect`.

**Core plugins** — the `packages/core/src/plugin/` directory (67 files):
`host.ts`, `internal.ts` (the graphs), plus tool and registration hosts.

**Configuration** — `packages/core/src/config.ts` (374 lines) and the
`packages/core/src/config/` directory (26 files): schemas for config,
agents, commands, questions.

**Providers and models** — `provider.ts` (468), `model.ts` (299),
`model-resolver.ts` (470), `models-dev.ts` (439), the
`github-copilot/` directory (24 files), `oauth/`, `credential.ts`.

**Model invocation** — `aisdk.ts` (1082 lines) and `aisdk-native.ts` (321)
— the bridge to the AI SDK.

**Files and search** — `filesystem.ts` + the `filesystem/` directory
(11 files: `watcher.ts`, `search.ts`, `ignore.ts`, `protected.ts`,
`fff.ts`), `ripgrep.ts`, `file-access.ts`, `file-mutation.ts`,
`file-retention.ts`.

**Git** — `git.ts` (758 lines), `snapshot.ts` (file snapshots
`capture|files|diff|restore`), `repository.ts`, `repository-cache.ts`,
the `vcs/`, `worktree/` directories.

**Permissions** — `permission.ts` (347) + `permission/` (including
`permission/saved.ts`), `managed-policy.ts`.

**Miscellaneous** — `shell.ts` (455), `job.ts` (482), `kv.ts`, `form.ts` (370),
`instruction-discovery.ts` (searching the tree for AGENTS.md) +
`instructions/` (assembly and hashing into the system prompt),
`skill.ts` + `skill/`, `mcp/`, `pty.ts` + `pty/` + `persistent-pty/`,
`websearch.ts`, `image.ts`, `location*.ts`, `project.ts`, `workspace.ts`,
`variant.ts` (608), `rpc.ts` (289), `bus.ts`, `effect/` (layer helpers),
`environment/`, `util/`, `id/`, `modal/`, `v1/` (16 migration files),
`account/` (dead code — zero imports).

## Entry Points

1. `packages/core/src/instance.ts` → `graph` — assembly of all core layers.
2. `packages/core/src/config.ts` — reading and validating the configuration.
3. `packages/core/src/session.ts` — working with sessions.
4. `packages/core/src/tool.ts` — the tool registry.
5. `packages/core/src/bus.ts` — subscribing to core events.

## Where to Look Next

- `packages/server/PACKAGE.md` — how these layers become the HTTP API.
- `packages/protocol/PACKAGE.md` and `packages/schema/PACKAGE.md` — the
  contract and the types.
- `packages/ai/PACKAGE.md` — the providers that `aisdk.ts` calls.
- `packages/plugin/PACKAGE.md` — how to extend the core without changing
  its code.
- `packages/core/test/session-runner-recorded.test.ts` — an example of a
  session run with traffic recording.

## Pitfalls

1. **A folder is not a subsystem.** `provider/`, `event/`, `credential/`,
   `permission/` are single `.ts` files next to same-named directories
   that exist only for `sql.ts`. Look for the file, not the folder.
2. **Events live in `bus.ts`, not in `event/`.** `event/sql.ts` is only
   the journal table.
3. **Three database runtimes:** `sqlite.bun.ts` / `sqlite.node.ts` /
   `sqlite.workerd.ts`. An edit to one does not carry over to the others.
4. **`test/` is bigger than `src/`.** 96.5k lines of tests against 65k
   lines of logic — do not look for the implementation in the tests.
5. **`account/sql.ts` is dead code:** zero imports, the table exists
   separately in `console/core/src/schema/account.sql`.
6. **`node-ffi.d.ts` and `markdown.d.ts` are type declarations**, not
   code; `models-dev/` is empty (the logic is in `models-dev.ts`).
