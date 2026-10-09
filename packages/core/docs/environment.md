# core/environment — the file abstraction of the core: contract, local and in-memory drivers, process execution

## What's In This Folder

Eight files: the contract of file operations (`FilesImpl`), three of its implementations
(via process launch, via `node:fs` and in memory), the `@opencode/Environment`
service that chooses the implementation per location, and a substitute environment
without an execution plane. The idea: the whole core works with files and
processes through one narrow contract, and nothing above this seam touches
`node:fs` directly.

## Key Files

- `packages/core/src/environment/files.ts` — the contract: `FileType`, `FileInfo`,
  `DirEntry`, the errors `NotFound`, `WrongKind`, `Failed`, the `FilesImpl` interface,
  the function `typeFollowing`.
- `packages/core/src/environment/exec-defaults.ts` — the default implementation
  via launching shell scripts: `execDefaults`, the scripts `stat`, `read`,
  `list`, `move`, `loadMetadata`.
- `packages/core/src/environment/local.ts` — `makeLocalDriver`: local
  access to the host through `node:fs/promises`.
- `packages/core/src/environment/memory.ts` — `makeMemoryDriver`,
  `MemoryDriver`: a filesystem in memory with symlink support.
- `packages/core/src/environment/environment.ts` — the `@opencode/Environment` service,
  the choice of driver by `location.workspaceID`.
- `packages/core/src/environment/driver.ts` — the `Driver` type: a spawner and
  optional overrides of `FilesImpl`.
- `packages/core/src/environment/index.ts` — the public entry point of the folder,
  the function `makeFiles` (gluing `execDefaults` and the driver overrides).
- `packages/core/src/environment/unavailable.ts` — `spawner` and `layer`, an environment
  without the ability to run processes.

## Important Details

- Content operations (`read`, `list`) go along the final symlink, but metadata
  (`stat` and the entry tags in `list`) do not: `stat` must show a
  symlink as a symlink.
- The local driver is chosen precisely because of this break: the effect's
  `stat` always follows symlinks, and `readDirectory` returns only names.
- The process implementation works by exit codes: 44 — "not found",
  45 — "wrong type", 46 — "error". Error texts are not parsed, so
  localization does not break the classification; the only text match
  left in stderr under `LC_ALL=C`, which is pinned by the environment.
- The scripts require GNU coreutils and findutils: BSD and busybox do not fit.
  Reading is through `cat` or `dd` with a range mode, listing is `find` with
  `printf '%y\0%f\0'` and a NUL separator.
- Parse errors of the scripts' own output (for example `Invalid stat output`
  or `Invalid find output`) are defects, and they are thrown, not
  returned as `Failed`.
- The collected output is limited: 64 MiB for stdout and 64 KiB for stderr.
  Exceeding it becomes `Failed`, so large files are read in ranges.
- The default write creates directories on the fly (`mkdir -p` plus `cat`), and
  the delete is recursive (`rm -rf`).
- The in-memory driver resolves paths relative to the `/` root through
  `path.posix.resolve`, walks symlink cycles with a `seen` set and
  sorts the listing by name. It has its own `symlink`
  operation, which is not in the contract — for tests only.
- The spawner of the in-memory driver always fails with `PlatformError`: it cannot
  run processes, and the default implementation on top of it will not work.
- The environment service chooses the driver like this: with `workspaceID` present
  the driver of a remote location, otherwise local. A workspace connection error
  is deliberately turned into a defect: the environment has no error channel, an unknown or
  destroyed placement is considered a configuration error.
- `typeFollowing` derives the type with a symlink transition in a cheap way: it takes
  `stat`, and for a symlink it does a zero-length read and takes the type from
  the result; a dangling symlink gives `NotFound`, not "unknown type".

## Connections

- The public API of the folder is `index.ts`: outside it imports `Files`, `FileInfo`,
  `Driver`, `NotFound`, `WrongKind`, `Failed`, `typeFollowing`, `execDefaults`,
  `makeLocalDriver`, `makeMemoryDriver`, as well as `Service` and `node`.
- The environment node is a location node, it depends on `CrossSpawnSpawner.node`,
  `Location.node` and `Workspace.node`: the choice of implementation depends on the placement
  of the location.
- The process executor in the default implementation is the same spawner that the
  environment service exposes outward, so a remote location gets the same operations, but
  on its own machine.
- `mcp/stdio.ts` and other consumers of the location's processes work through the
  environment spawner, not directly through `node:child_process`.

## Pitfalls

- Paths in the contract are plain strings, not `AbsolutePath`: the check of path correctness
  is taken on by the calling side.
- "No execution plane node" and "the node exists" are different layers, and
  `unavailable.ts` answers the first case: any process launch in such a
  location fails immediately, without an attempt to reach the disk.
- The default implementation does not fit non-GNU systems: `stat` with the flag
  `-c` and `find` with `-printf` are either missing there or print differently.
- `list` in the in-memory driver returns the type of the entries themselves, and the directory
  is passed through the symlink — exactly the behavior for which the contract is separated.
- The 64 MiB limit is on reading the process stdout, not on the file size: a file
  larger than the limit is read by range only.
- The in-memory driver stores file bytes in a `Map` and has no size limit: it is not
  intended for large volumes.