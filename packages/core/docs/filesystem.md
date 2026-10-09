# core/filesystem — file watching, tree search, protection against extra walking

## What's In This Folder

Eleven files: a wrapper over `fs.watch` and a Parcel worker (`watcher.ts`),
the ignore policy for a location, watching of the VCS control file
(`location-watcher.ts`), file search by name with two engines — ripgrep and fff,
lists of ignored folders, protected home directories and fff adapters for three
runtimes. The idea: everything the core knows about the project filesystem is
collected here.

## Key Files

- `packages/core/src/filesystem/watcher.ts` — the services `@opencode/Watcher`,
  `@opencode/Watcher/Native` and `@opencode/Watcher/Test`; the layers `layer`,
  `nativeLayer`, `testLayer`; `hasNativeBinding`, `subscribeDirectory`, `Event`.
- `packages/core/src/filesystem/location-watcher.ts` — the service
  `@opencode/LocationWatcher`: watches the VCS branch file and publishes events
  into the bus.
- `packages/core/src/filesystem/location-watcher-policy.ts` — the service
  `@opencode/LocationWatcherPolicy`: the observable list of ignored paths.
- `packages/core/src/filesystem/search.ts` — the service
  `@opencode/FileSystem/Search`: the layers `ripgrepLayer`, `fffLayer`, `layer`,
  `configured`, the node `node`.
- `packages/core/src/filesystem/ignore.ts` — lists of folders and files that are not
  walked, and the aggregated `PATTERNS`.
- `packages/core/src/filesystem/protected.ts` — `isHome`, `names`, `paths`:
  home directories that must not be scanned.
- `packages/core/src/filesystem/watcher-binding.ts` — lazy loading
  of the native module `@parcel/watcher`.
- `packages/core/src/filesystem/fff.ts`, `fff.bun.ts`, `fff.node.ts`,
  `fff.workerd.ts` — types and bindings of the fff search engine.

## Important Details

- Two different watchers are attached to different targets. A file and a set of names
  are watched through `fs.watch` without recursion (instant reaction), while
  recursive directories go through Parcel with the platform backend: `windows`,
  `fs-events`, `inotify`.
- Identical watches are shared: keys in `RcMap` are compared structurally, so
  equivalent subscriptions use one native subscription. Ignore path lists and
  name lists are deduplicated and sorted before being used as a key.
- At `enabled: false` the service returns an empty stream — not an error.
- If the native subscription failed (no binding, unknown platform,
  timeout), the subscriber's stream simply ends instead of hanging: the pubsub is switched off
  and `subscribe` returns an empty stream.
- The readiness wait is passed as a separate `onReady` and is performed after
  the listener is registered, when the stream is already being consumed.
- A subscription to the native side can hang up to `SUBSCRIBE_TIMEOUT_MS`
  (10 seconds). It is marked interruptible, and the interruption itself closes
  a subscription that resolved too late.
- The ignore array is copied before being passed to native code: it shares the key
  `RcMap`, which caches a structural hash.
- VCS location event: the target is chosen once and cached — `HEAD` for git
  (with the `.git` path and the resolved `gitDirectory` in the alias list), `branch`
  for hg. A `.git` or `.hg` directory in the ignore list switches the watching off.
- A change of the ignore policy renegotiates the watch: the active subscription
  is closed, on a target change a new one is created. The transitions are serialized
  by a semaphore for one operation, the `stopped` flag kills the work after finalization.
- Watching starts after the activation of plugins, and its failure is logged and does not
  bring the layer down; interruptions are considered normal.
- The name search rebuilds the index on every scan, but reuses the prepared
  `fuzzysort` strings for the paths that remained. The first scan is waited for
  by everyone, subsequent ones for at most `REFRESH_INTERVAL` (10 seconds); the update
  always goes in the background, and until the first completion the call waits for its completion.
- Until the first scan is complete, the search returns an empty index, not an error: this
  is noticeable as "flashing" of results at startup.
- The home directory on the first scan is limited to 100 000 entries and excludes
  protected subdirectories; a regular location under VCS is walked without a limit.
- Choice of the search engine: a remote location (`workspaceID`) always goes
  through ripgrep, because fff would index the local directory and give
  wrong results. Besides that, fff is switched off on Windows when the flag is not
  explicitly set, and is unavailable without a native module.
- `ignore.ts` — a list for walks, not git rules: among the folders `node_modules`,
  `.git`, `dist`, `target`, `desktop`, caches and IDE directories; `PATTERNS` collects
  them into one set with the glob form `**/{...}/**`.
- `protected.ts` distinguishes base names (`names`) and absolute paths (`paths`):
  on macOS these are `Music`, `Pictures`, `Library` and `Library` subdirectories, as well
  as `.Spotlight-V100`, `.Trashes`, `.fseventsd` and the like in the root; on Windows —
  `AppData`, `Downloads`, `OneDrive` and others; on Linux both lists are empty.

## Connections

- Content search does not go from here, but through `../ripgrep.js`; the prepared
  binary lies in `packages/core/src/ripgrep/binary.ts`.
- File event types are taken from `@opencode/schema/filesystem`
  (`FileSystem.Event.Changed`, `FileSystem.Entry`, `FileSystem.FindInput`), and
  the paths — `RelativePath` from `../schema.js`.
- `location-watcher.ts` publishes through the bus `../bus.js` and waits for the activation
  of plugins through `../plugin.js`; the repository and the `.git` directory — through
  `../git.js` and `FSUtil`.
- The fff adapter under Bun loads the native package `@ff-labs/fff-bun`; under Node — with
  a dynamic import and error interception; under workerd there is no backend at all.
- The Parcel native module is chosen by platform and libc (the variables
  `OPENCODE_LIBC` and `OPENCODE_PARCEL_WATCHER_PATH`), the module itself is loaded
  lazily.

## Pitfalls

- The event `Event.Updated` is the same `FileSystem.Event.Changed`: there is no separate
  "updated" event in the schema.
- Publication of a VCS event goes as `add`/`change`/`unlink` by the type of change, but
  the source of events is the file `HEAD` or `branch`, so a branch change looks
  like a change of this file.
- Adding `.git` or `.hg` to the ignore policy not only excludes the path, but
  switches the location's watching off completely.
- A subscription to the native side can hang, and this is handled by cancellation and
  late closing — but what lands in the log is not an error, but an empty stream at the client.
- The search index belongs to the location: moving the location requires a new layer, otherwise
  the paths of the old directory will stay in the results.
- `fff` in `aiMode` with content indexing switched off: the output of
  fff is a name match, not a full-text search.
- The ignore list contains the folder `desktop` — that is the build directory of the Electron app,
  not the user's desktop; on macOS the desktop is protected separately,
  in `protected.ts`.