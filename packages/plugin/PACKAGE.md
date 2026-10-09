# @opencode/plugin — extension host

## What This Is

The opencode plugin host: 60 files, ~3.1k lines in `src/`. The package is
responsible for how a plugin is found, loaded, reloaded when files change,
and given access to the core: sessions, tools, commands, events,
permissions, MCP, skills.

The package has three "faces" for different runtimes — promise, Effect and
TUI — plus its own server API.

## Layers and Dependencies

Layer **L3**: depends on `ai`, `client`, `protocol`, `schema`, `util`.

Who depends on it: `cli`, `core`, `gui-extensions`, `latex`, `merman`,
`sdk`, `simulation`, `tui`, `plugin-browser` and `plugin` itself.

Export (`packages/plugin/package.json`):

```json
".": "./src/promise/index.ts",
"./effect": "./src/effect/index.ts",
"./host": "./src/host.ts",
"./tui": "./src/tui/index.ts",
"./*": "./src/*.ts"
```

Plus the conditional import `#plugin-source`: on bun — `source.bun.ts`,
on node and by default — `source.node.ts`.

## Subsystems and Files

**Plugin loader** — `packages/plugin/src/host.ts` → namespace `Host`:
types `Target` (directory and optional name) and `Entrypoints`
(`server` / `tui` / `rpc`), function `resolve(target)` looks up entry points
through `resolveModule` from `@opencode/util/runtime-import`, skipping
`ENOENT`.

**Source reading** — `packages/plugin/src/source.ts` →
`createPluginSources(watch)`: takes file hashes (`@opencode/util/hash`),
watches for changes and reloads only the changed graph. Runtime variants
live in `source.bun.ts` and `source.node.ts`, the shared one — `source.package.ts`.

**Plugin server API** — `packages/plugin/src/app.ts`: the `App` interface
(`name`, `version`, `channel`) and the rest of the root files — `options.ts`,
`rpc.ts`, `storage.ts`, `worktree.ts`.

**Server surface (Effect)** — directory
`packages/plugin/src/effect/`: one file per capability —
`session.ts`, `tool.ts`, `command.ts`, `agent.ts`, `event.ts`,
`permission.ts`, `provider.ts`, `model.ts`, `mcp.ts`, `skill.ts`,
`shell.ts`, `vcs.ts`, `worktree.ts`, `websearch.ts`, `reference.ts`,
`integration.ts`, `storage.ts`, `registration.ts`, `aisdk.ts`,
`rpc.ts`, `plugin.ts` — plus `index.ts` on top.

**The same surface on promises** — directory
`packages/plugin/src/promise/` (a mirror set + `adapter.ts`,
`types.ts`), this is the root export `"."`.

**TUI surface** — directory `packages/plugin/src/tui/`: `index.ts`,
`plugin.ts`, `context.ts`, `solid.ts` — what a plugin can change in the
interface; export `./tui`.

## Entry Points

1. `packages/plugin/package.json` → `"."` — `Plugin.define(...)`, how a
   plugin is written by default (the promise variant).
2. `packages/plugin/src/effect/index.ts` — the same API on `effect`
   (`@opencode/plugin/effect`).
3. `packages/plugin/src/host.ts` → `Host.resolve(...)` — lookup of a
   plugin's entry points on disk.
4. `packages/plugin/src/tui/index.ts` — registration in the interface
   (exactly what `latex`, `merman` use).

## Where to Look Next

- `packages/core/PACKAGE.md` — where the host is embedded into the session
  (`plugin/host.ts` and `plugin/internal.ts` assemble the graphs).
- `packages/latex/PACKAGE.md`, `packages/merman/PACKAGE.md`,
  `packages/plugin-browser/PACKAGE.md` — three real plugins as examples.
- `packages/util/PACKAGE.md` — `runtime-import`, which the loader is built on.
- `packages/ai/PACKAGE.md` — `@ai-sdk/provider` and model tools.

## Pitfalls

1. **The three API variants are not interchangeable.** `"."` — promises,
   `"./effect"` — Effect, `"./tui"` — the interface. A plugin on `Plugin.define`
   from `@opencode/plugin/tui` and a plugin from `@opencode/plugin/effect` are
   different formats (`id` + `setup` versus `id` + `effect`).
2. **`#plugin-source` is chosen by the bundler.** Code written for
   `source.bun.ts` gets `source.node.ts` on node — hot reload behavior
   differs.
3. **Hashes in `source.ts` drive the tracking.** If the reload does not
   fire, the usual cause is that the file hash did not change — the watch
   fires, but no reload is needed.
4. **`host.ts` silently skips missing entry points** (`ENOENT` —
   a normal path). A plugin without a `tui` entry point will not fail, it will
   simply show nothing in the interface.
