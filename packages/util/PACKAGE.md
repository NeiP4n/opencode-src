# @opencode/util — the core utility layer

## What This Is

The lowest layer of opencode: 44 files, ~4.5k lines in `src/`. There are no sessions,
no models, no interface here — only what any other package needs: where opencode keeps
its data on disk, how to take a file lock, how to compute a hash, how to spawn a
process, how to assemble Effect layers.

The package is imported by name: `@opencode/util/*` exposes any file from `src/`
(`@opencode/util/global`, `@opencode/util/hash`, `@opencode/util/glob`). The export
map lives in `packages/util/package.json`:

```json
"exports": {
  "./effect/layer-node": "./src/effect/layer-node.ts",
  "./*": "./src/*.ts"
}
```

Two conditional imports (`#global-roots`, `#runtime-import`) pick a variant by runtime:
on workerd (Cloudflare) one file, on bun/node another. There is no runtime detection in
the code, only a build condition.

## Layers and Dependencies

Layer **L0 — a leaf**: inside opencode it depends on no other `@opencode/*` package
(there are none in `dependencies`). There are many external dependencies: `effect`,
`cross-spawn`, `glob`, `minimatch`, `open`, `pacote`, `@npmcli/arborist` — working with
npm packages lives here too.

Who uses it (number of `@opencode/util` imports in `packages/*/src`):

| Package | Imports |
| --- | --- |
| `packages/core/src` | 232 |
| `packages/cli/src` | 49 |
| `packages/app/src` | 37 |
| `packages/tui/src` | 19 |
| `packages/gui-extensions/src` | 18 |
| `packages/session-ui/src` | 13 |
| `packages/server/src` | 11 |
| `packages/simulation/src` | 3 |
| `packages/sdk/src` | 3 |
| `packages/plugin/src` | 2 |
| `packages/enterprise/src` | 2 |

A change here breaks everything else: 11 packages stand on it.

## Subsystems and Files

**Where opencode data lives** — `packages/util/src/global-roots.ts` and `global.ts`.
`roots("opencode")` assembles five directories from XDG variables:
`~/.local/share/opencode` (data), `~/.cache/opencode` (cache), `~/.config/opencode`
(config), `~/.local/state/opencode` (state), `os.tmpdir()/opencode` (tmp).
On workerd there is no home directory, so there is a second file
`packages/util/src/global-roots.workerd.ts`: there all roots reduce to a single
temporary directory.

**File locks** — two mechanisms:

- `packages/util/src/effect-flock.ts` — the Effect service `EffectFlock` with the API
  `acquire(key, dir?, options?)` and `withLock(body, key, dir?)`. The primitive is an
  atomic `mkdir` (the analogue of O_EXCL in POSIX). An attempt creates the directory
  `<state>/locks/<sha1 of the key>.lock` and puts `meta.json` (token, pid, hostname,
  time) and a `heartbeat` file in it. While the lock is held, a separate fiber
  refreshes `heartbeat` every `staleMs / 3`. If the heartbeat is old, the lock is
  considered orphaned: it is released by whoever created the breaker directory
  `<lock>.breaker` first, and only after a repeated check. Releasing compares the token
  in `meta.json` against the token of the holder.
- `packages/util/src/flock.ts` — a low-level variant without Effect.

**Hashes** — `packages/util/src/hash.ts`: `Hash.fast` (sha1 — file names and lock
keys) and `Hash.sha256` (comparisons by essence).

**Files and paths** — `packages/util/src/fs-util.ts` (file operations as an Effect
service), `packages/util/src/path.ts` (path joining, tests in `path.test.ts`),
`packages/util/src/glob.ts`, `packages/util/src/encode.ts`.

**Processes** — `packages/util/src/cross-spawn-spawner.ts` (spawning around Windows
problems), `packages/util/src/process.ts`, `packages/util/src/open.ts` (opening a file
or a URL in a system application).

**Working with npm** — `packages/util/src/npm.ts` and `packages/util/src/npm-config.ts`:
npm configuration and parsing of package names. Plugins install packages through here,
without calling npm by hand.

**The `effect/` directory** — assembling DI layers: `layer-node.ts` (the LayerNode
graph), `app-node.ts`, `keyed-mutex.ts`, `websocket-constructor.ts`.

**The `runtime/` directory** — loading modules for a specific runtime;
`packages/util/src/runtime-import.ts` — the entry point to Bun-specific features.

**Miscellaneous** — `artifact.ts`, `binary.ts`, `bom.ts`, `activity-calendar.ts`,
`patch.ts`, `retry.ts`, `session-title-fallback.ts`, `observability.ts` and the
`packages/util/src/observability/` directory.

## Entry Points

1. `packages/util/src/global.ts` — exports `Path` with all the roots; code that needs a
   path on disk starts here.
2. `packages/util/src/global-roots.ts` — the `roots(app)` function, the only place where
   `XDG_*` variables are read.
3. `packages/util/src/effect-flock.ts` — `EffectFlock.Service` and `EffectFlock.withLock`.
4. `packages/util/src/hash.ts` — `Hash.fast`, `Hash.sha256`.
5. `packages/util/src/effect/layer-node.ts` — the only subsystem marked in
   `package.json` by a separate `exports` line.

The package has no entry points of its own: it is imported only by name, through the
`exports` map.

## Where to Look Next

- `packages/schema/PACKAGE.md` — data types: everything util puts on disk is
  described there.
- `packages/protocol/PACKAGE.md` — endpoint contracts through which this data is
  passed outside.
- `packages/core/PACKAGE.md` — the main consumer (232 imports): the `database` and
  `config` subsystems are built on this layer.
- `packages/cli/src/services/service-config.ts` — service channels and ports; explains
  why the state lives in `state/` subdirectories.
- `packages/core/src/database/database.ts` and `packages/core/src/config.ts` — how the
  core applies `global.ts` and `EffectFlock` in practice.

## Pitfalls

1. **A change to `global-roots.ts` moves all opencode data.** Changing the path does not
   migrate the old database: `opencode.db` simply stops being found.
2. **`EffectFlock` is not `flock(2)`.** The primitive is `mkdir`, the state is kept in
   `heartbeat`. A process killed without releasing the lock leaves it hanging until
   `staleMs` (60 seconds by default) — the next contender waits that time.
3. **You cannot release someone else's lock**, but you can break your own: `release`
   compares the token from `meta.json` against the token of the holder and fails on a
   mismatch.
4. **State channels.** Files in `state/` are separated by channel; reading the wrong
   subdirectory yields plausible data from a dead file. The channels are described in
   `packages/cli/src/services/service-config.ts`.
5. **The `effect/` directory is not "effects for convenience".** DI layers are assembled
   there: a change to `layer-node.ts` changes the initialization order of core services.
6. **`OPENCODE_TEST_HOME` substitutes the home directory** in `paths.home` of the file
   `packages/util/src/global.ts` — the package's tests are built on this.