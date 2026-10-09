# @opencode/cli — command line

## What This Is

The opencode entry point: 109 files, ~12.3k lines in `src/`. The command
registry (`serve`, `run`, `tui`, `pair`, `service`, `auth`, `mcp`, `plugin`,
`session`, `models`, `debug`, …), their handlers, server startup, the service
(service), TUI and ACP mode (Agent Client Protocol).

`packages/cli/src/index.ts` is exactly what runs when `opencode` is typed in
a terminal.

## Layers and Dependencies

Layer **L6 — surface**: depends on `client`, `plugin`, `schema`, `server`,
`tui`, `util`.

Who depends on it: `app`, `desktop`, `enterprise`, `gui-extensions`,
`session-ui` (via `@opencode/cli/run`), `cli` itself.

Export map (`packages/cli/package.json`):

```json
"./vite-host": "./dev/host.js",
"./run": "./src/run/index.ts",
"./server-process": "./src/server-process.ts"
```

## Subsystems and Files

**Command registry** — `packages/cli/src/index.ts` + `commands/commands.ts`:
the `Handlers` table, each command is loaded lazily through a dynamic import.

**Handlers** — the `packages/cli/src/commands/handlers/` directory:
`run.ts`, `serve.ts`, `mini.ts`, `models.ts`, `pair.ts`, `reload.ts`,
`api.ts`, `stats.ts`, `upgrade.ts`, `uninstall.ts`, `default.ts` plus the
subdirectories `auth/` (7 files: `login`, `logout`, `list`, `switch`,
`import`, `export`, `account`), `mcp/` (`add`, `auth`, `list`, `logout`,
`resolve`), `plugin/` (`add`, `remove`, `list`, `check`, `update`,
`inventory`), `service/` (`start`, `stop`, `restart`, `status`, `get`,
`set`, `unset`), `session/` (`list`, `delete`, `import`, `export`),
`debug/` (`agents`, `config`, `paths`, `redact`).

**Run modes** — the `packages/cli/src/run/` directory: `run.ts`,
`noninteractive.ts` (pipe/scripts), `ui.ts`, `v1.ts`, `index.ts`.

**Service** — the `packages/cli/src/services/` directory: `service-config.ts`
(service channels and ports), `service-registration.ts`,
`server-connection.ts` (connecting to a foreign server), `standalone.ts`,
`web-ui.ts`, `updater.ts` (updates), `update-preflight.tsx`,
`retained-image.ts`.

**CLI config** — the `packages/cli/src/config/` directory: `config.ts`,
`schema.ts`, `migrate.ts`, `index.ts`.

**ACP** — the `packages/cli/src/acp/` directory (15 files): agent
(`agent.ts`), connection (`connection.ts`), permission (`permission.ts`),
sessions (`sessions.ts`), turn (`turn.ts`), translation (`translate.ts`).

**Server and runtime** — `server-process.ts`, `mini-host.ts`, `mini.ts`,
`node/` (`plugin-runtime.effect.ts`, `plugin-runtime.promise.ts`,
`target.ts`), `framework/` (`spec.ts`, `runtime.ts`).

**UI extras** — `packages/cli/src/ui/` (`prompt.ts`,
`integration-picker.ts`, `timeline.tsx`), `env.ts`, `version.ts`,
`cpu-profile.ts`, `heap.ts`, `database-path.ts`, `ssh-askpass.ts`,
`session-target.ts`, `app-assets.ts`, `util/`.

## Entry Points

1. `packages/cli/src/index.ts` — the `opencode` root: the command registry.
2. `packages/cli/src/commands/commands.ts` — the command table itself.
3. `packages/cli/src/run/index.ts` (export `./run`) — programmatic session
   start from another package.
4. `packages/cli/src/server-process.ts` (export `./server-process`) —
   server process management.
5. `packages/cli/src/services/service-config.ts` — service channels, ports and
   variables.

## Where to Look Next

- `packages/server/PACKAGE.md` — what the `serve` command does.
- `packages/tui/PACKAGE.md` — what the `tui` command opens.
- `packages/core/PACKAGE.md` — the logic that the commands call.
- `packages/script/PACKAGE.md` — the versions that `--version` prints.

## Pitfalls

1. **Commands are lazy.** A handler is imported only when it is invoked — an
   error in an unused command does not bother the others; but "command not
   found" also happens because of a failed import.
2. **`service` is a background service, not a local process.** Ports,
   channels and state paths are set in `services/service-config.ts`; reading
   the wrong variables gives data from a foreign channel.
3. **Three plugin runtimes** (`node/plugin-runtime.*`, `mini-host.ts`) are
   selected by the runtime environment — the behavior of `opencode run` and
   `opencode mini` differs.
4. **ACP is a separate protocol**, not the HTTP API: `src/acp/` does not call
   `server` through the same routes.
5. **`./vite-host` points to `dev/host.js`** — it is a dev host for
   development, not part of the production binary.
