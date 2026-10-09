# core/src — filesystem, Git, terminals, locations and plugins

## What's In This Folder

Twenty top-level files of `packages/core/src` — the boundary of the core and of the real environment: working with files and searching them, git operations, the history of changes, terminals, the Location lifecycle and the loading of plugins. Almost all of them are Effect services (`Context.Service`), assembled through the graph nodes: global (`makeGlobalNode`) — `git.ts`, `repository-cache.ts`, `worktree.ts`, `location-activity.ts`; bound to a Location (`makeLocationNode`) — `vcs.ts`, `filesystem.ts`, `file-access.ts`, `file-mutation.ts`, `ripgrep.ts`, `shell.ts`, `pty.ts`, `snapshot.ts`, `location-lifecycle.ts`, `plugin.ts`.

The files are divided into four layers: the low level of input-output (`filesystem`, `file-access`, `file-mutation`, `ripgrep`, `shell`, `pty`), version control (`git`, `vcs`, `snapshot`, `repository`, `repository-cache`, `worktree`), the management of the placements (`location`, `location-service-map`, `location-services`, `location-activity`, `location-lifecycle`) and the extensions (`plugin`).

## Key Files

- `packages/core/src/git.ts` — the only point of calling git as a process. The service `Git` with the sections `repo`, `remote`, `history`, `sync`, `worktree`, `index`, `tree`; the errors `OperationError` and `WorktreeError`; a local `KeyedMutex` on `gitDirectory`; the storage config `opencode.gitconfig` via `include.path`.
- `packages/core/src/vcs.ts` — a git-independent layer above the VCS providers from the plugins. It holds the chosen provider, the `State` editor, the `Bus` events `VcsEvent.BranchUpdated`, watches the branch metadata file via `FileSystem.Event.Changed`.
- `packages/core/src/snapshot.ts` — the snapshots of the filesystem of a Location as content-addressed git trees: `capture`, `files`, `diff`, `restore` plus the `enabled` switch.
- `packages/core/src/repository.ts` — the parsing of a repository string into `RemoteReference`/`FileReference`, the check of a branch name, the cache keys.
- `packages/core/src/repository-cache.ts` — the service `RepositoryCache.ensure`: the local checkouts by remote+branch with cloning, a daily refresh and a file flock.
- `packages/core/src/worktree.ts` — the work with the working copies of the project: `list`, `create`, `remove`, `refresh` above the strategies and the `worktree` table.
- `packages/core/src/filesystem.ts` — the Location service of reading (`read`), listing (`list`), searching (`find`) and writing (`write`).
- `packages/core/src/file-access.ts` — the lexical resolution of a path into a `Target`, the batch approval of the external directories, `authorizeRead`.
- `packages/core/src/file-mutation.ts` — the serialization of the mutations by path and the write with the preservation of the BOM.
- `packages/core/src/ripgrep.ts` — the adapter of the launch of `rg`: `find`, `glob`, `grep` above `environment.spawner`.
- `packages/core/src/shell.ts` — the non-interactive commands with the output into a file: `create`, `list`, `get`, `wait`, `result`, `timeout`, `output`, `remove`.
- `packages/core/src/pty.ts` — the interactive terminals on the native `#pty`: the sessions, the buffer, `attach` with a replay.
- `packages/core/src/persistent-pty.ts` — one line re-exporting `PersistentPty` from `packages/core/src/persistent-pty/index.ts`.
- `packages/core/src/location.ts` — `Location.Service`: the directory, `workspaceID`, the project, the optional `vcs`.
- `packages/core/src/location-service-map.ts` — the `LayerMap` of the services by `Location.Ref` plus `canonical()` and `reload()`.
- `packages/core/src/location-services.ts` — the assembly of the map via `Instance.layer`, the correct closing and the eviction of the records.
- `packages/core/src/location-activity.ts` — the accounting of the recent activity of a Location and the eviction of the idle ones.
- `packages/core/src/location-lifecycle.ts` — `isClosed`/`shutdown`: the closing of the permissions, the forms, the RPC and the publication of `LocationEvent.Shutdown`.
- `packages/core/src/file-retention.ts` — `cleanup`: the deletion of the files older than the threshold by `mtime`.
- `packages/core/src/plugin.ts` — the activation of a set of plugins, the inventory, `awaitActivation`, the switching off after a failure of `transform`.

## Important Details

- `git.repo.create` writes its own config: `core.autocrlf=false`, `longpaths`, `feature.manyFiles`, `index.version=4`, `threads`; the file is included via `include.path` in `$GIT_DIR/config`. With `seed` the shared objects are included via `objects/info/alternates`, the index is copied with the errors ignored.
- All git commands are launched with `--git-dir`/`--work-tree` with the explicit paths of the repository, except for the clone and the worktree subcommands.
- `Git.tree.capture` refreshes the index only in the passed scopes, then writes the tree; `Git.tree.diff` does three parallel launches (`--name-status`, `--numstat`, patch) instead of a launch per file.
- The snapshots are stored in `global.data/snapshot/<projectID>/<hash(worktree)>`; `capture` refuses to work outside a git project and cuts off the untracked files over 2 MiB.
- `Repository.cachePath` adds the branch as `@<percent-encoded>`; the KV key is `repository-cache:<localPath>`, the same key is used for the flock; the interval of the "daily" refresh is a day.
- `repository-cache` reads `refresh: "daily"` as "not more often than a day", and `true` as "always"; the status of the result is `cached`/`cloned`/`refreshed`.
- `Vcs.diff` limits the total volume of the patches by `MAX_TOTAL_PATCH_BYTES`, the files over the limit get an empty patch; the default context size is `PATCH_CONTEXT_LINES`.
- `FileSystem` contains the constants `DEFAULT_SEARCH_LIMIT = 100` and `DEFAULT_SEARCH_TIMEOUT_MS = 30000`.
- `Shell`: the output is written into `global.data/shell/<projectID>/<id>.out`, `RETENTION` is 7 days, the cleanup is launched once an hour, in memory up to 25 finished commands are held, the reading of the output by default is not more than 65536 bytes per cursor.
- `Shell.result` takes the tail by `max_lines`/`max_bytes` from the `tool_output` configuration and adds a line indicating the range of the shown lines.
- `Pty`: the buffer of the session is limited to 2 MiB, the old data is discarded with the advancement of `bufferCursor`; the finished sessions are stored up to 25 pieces; `attach` on a non-working session gives `ExitedError`, the cursor `-1` means "only from the current end".
- `Ripgrep` reads not more than `limit + 1` lines, in order to distinguish a cut off from an exact result; the submatches are cut to 100, the text of the line — to 2000 characters, stderr — to 8 KiB.
- `LocationActivity`: the lifetime of a record is 60 minutes, the background pass is once a minute; before the eviction the executions of the sessions of this location are interrupted with the awaiting of the computation.
- `buildLocationServiceMap` sets `idleTimeToLive: Duration.infinity` — the healthy graphs are held, the eviction is only explicit.
- `Plugin.activate` compares the definitions by the prefix: only the suffix after the first difference in the id or the revision is reloaded.

## Connections

- `snapshot.ts` → `git.ts` (`repo.discover`, `repo.create`, `index.ignored`, `tree.*`) + `state.ts` for the flag `enabled`; `noopLayer` gives the empty answers when the snapshots are not needed.
- `vcs.ts` → `location.ts` (the directory, `project`, `vcs.store`), `bus.ts`, `state.ts`, `vcs/patch.ts`; the providers come from the plugins, their answers are decoded by the schemas `@opencode/schema/vcs`.
- `repository-cache.ts` → `git.ts`, `repository.ts`, `kv.ts`, `effect-flock`, `packages/util/src/global.ts`; the cache lies under `Global.repos`.
- `worktree.ts` → `database/database.ts` and `worktree/sql.ts` (the table), `worktree/strategies.ts` (the set of the strategies), `worktree/directory.ts` (the canonicalization of the path), `location-service-map.ts` (the services of a foreign location), the `app-node` dependency `Git.node` for the worktree errors.
- `filesystem.ts` → `filesystem/search.ts` (the search above `ripgrep.ts`), `location.ts`, `schema.ts` (`AbsolutePath`/`RelativePath`).
- `file-access.ts` → `permission.ts` (the approval of the `external_directory` and `read` actions), `project.ts` (the root of the project for `save`), `tool.ts` (the type of the call context).
- `file-mutation.ts` → `environment/index.ts` (`files.stat/read/write`), `effect/keyed-mutex.ts`, the type `FileAccess.Target`, the `bom` utilities; `file-retention.ts` serves the files that `shell.ts` leaves.
- `shell.ts` → `shell/select.ts` (the choice of the shell and of the arguments), `environment` (the spawner), `plugin/hooks.ts` (`shell/create.before`), `config.ts`, `tool-output.ts`, `bus.ts`, `session/environment.ts` (the environment of the session).
- `pty.ts` → the lazy import `#pty`, `shell/select.ts` (the command and the login flag), `bus.ts`; `persistent-pty.ts` re-exports the daemon from `persistent-pty/index.ts`.
- `location-services.ts` → `instance.ts` (`Instance.layer` with the substitutions), `location-service-map.ts`, `location-lifecycle.ts`; the cache of the instances takes the graph of the owner, and does not hold its scope.
- `location-lifecycle.ts` → `permission.ts`, `form.ts`, `rpc.ts`, `project.ts`, `bus.ts`; `location-activity.ts` → `location-service-map.ts`, `session/execution.ts`, `session/store.ts`, `bus.ts`.
- `plugin.ts` → `plugin/host.ts` (the registry of the host functions and the storage on `kv.ts`), `plugin/service.ts` (the service and the type `Generation`), `state.ts` (the inheritance, the batch updates, the rollback).

## Pitfalls

- `Git.index.refresh` removes the ignorable and too large untracked files from the index via `rm --cached -f`: the working files stay in place, only the index changes. Only the allowed part is staged, everything else in the repository is untouched.
- In `Git.tree.diff` the names and the numbers go through `-z`, and the patches — without quotes (`-c core.quotepath=false`): thus the splitting of the patch by files keeps coinciding for the non-ASCII names.
- `Git.tree.files` and `diff` always work with `--no-renames`: both sides of a rename are returned, because the rollback changes both.
- `Git.tree.restore` first asks `ls-tree`, and if the path is not in the tree — deletes it from the disk. Everything runs under the lock by `gitDirectory`.
- `Git.repo.discover` goes up the tree, therefore in `repository-cache` the check of the reuse compares the `worktree` with the cache path itself: otherwise an external repository with the same origin will pass itself off as a cache record.
- `repository-cache` writes the time of the attempt before the network work, therefore a failed clone also falls under the daily interval; the update goes by the "new wins" principle — `fetch` plus `reset --hard` move the checkout under the readers.
- `FileSystem.read` is limited by `FSUtil.contains` twice (by the directory of the location and by the real path), and `FileSystem.write` deliberately goes beyond the bounds of the location — so that the client can put the files into the temporary directory of the server.
- `FileAccess.resolve` counts as internal both the directory of the location and the directory of the project; for an external path the `save` is built from the root of the project found via `Project.root`, and not from the directory of the location.
- `FileMutation.withLock` takes a global mutex by the sorted paths (the reverse order of the walk), therefore the locks do not conflict between the locations; the lock, however, is only inside the process — the external writes can race.
- `Shell.wait` is resolved before the eviction of the command from memory, therefore a command deleted after completion still gives its exit code, and not `NotFoundError`.
- `Shell` deliberately interrupts the timeout fiber last in `finish`: the order is needed so that the waiters see the terminal status.
- `Ripgrep`: the code 1 is "no matches" and that is an empty successful result; the code 2 together with the text about the parsing of the regex gives `InvalidPatternError`; any other code is an execution error.
- `Ripgrep.glob` at `hidden: false` adds `--glob=!**/.*` after the positive glob: the positive pattern otherwise cancels the built-in filter of the hidden files.
- `Vcs`: for `info`, `branches`, `status` a failure of the provider turns into a warning and an empty fallback answer, and for `base` and `diff` — into a `DiffError` error; the interruptions are not swallowed, but turn into a defect.
- `Vcs.refresh` publishes the event in a loop: if the branch managed to change while the nested updates were being published, the event is sent again with the current value.
- `LocationServiceMap.canonical` normalizes the path only on win32; on the other platforms the paths that are equivalent in meaning but different in writing give different cache keys.
- `buildLocationServiceMap` on the eviction first breaks the routing and only then closes the record, and all this is uninterruptible; a failed assembly is evicted in the scope of the owner, otherwise the replacement would already have managed to evict itself.
- `LocationActivity` on the expiry of the term first interrupts the executions of the sessions with the awaiting of the computation and only then detaches the cache record: the borrowers keep the old graph until they hand the work over at the boundary of the step.
- `Plugin.activate` on a match of the prefix reuses the live slots; if the rearrangement of the healthy registrations has touched a slot with the same unsuccessful revision, there will be no repeated load until the revision changes. A duplicate of `Plugin.ID` leads to `Effect.die`.
- `Plugin` never attaches the finalizers of the user under the lock of the activation or under the holding of the readiness — for this the deferred queue of the invocations is decoupled via `hold`/`release`.