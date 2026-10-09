# core/ripgrep — where to get the ripgrep binary: system, already downloaded or download from GitHub

## What's In This Folder

One file `binary.ts`: the service `@opencode/RipgrepBinary`, which once
finds or delivers the `rg` executable and hands over its path. There is no
file search here — only the preparation of the binary, so that the project search
works without a package installed in the system.

## Key Files

- `packages/core/src/ripgrep/binary.ts` — the only file: the namespace
  `RipgrepBinary` with `VERSION` = `15.1.0`, the `PLATFORM` table, the `Service`
  and the `node`.

## Important Details

- The order of choosing the binary: first `rg`/`rg.exe` in `PATH` (priority
  `Global.bin`), then the already downloaded `rg` in `Global.bin`, and only then
  the download from GitHub. The result is cached through `Effect.cached`, so within
  the lifetime of the layer the path is looked up once.
- The `PLATFORM` table lists seven builds: aarch64 and x86_64 for macOS and
  Linux (`tar.gz`), as well as arm64, ia32 and x86_64 for Windows (`zip`). For Linux
  the musl build is chosen. A platform without an entry in the table gives an explicit error
  `unsupported platform for ripgrep`.
- The archive is downloaded from the release tag of BurntSushi/ripgrep into `Global.bin`, then
  unpacked into a temporary directory with the prefix `ripgrep-`, copied to the
  target and on non-Windows gets the rights `0o755`. The archive after unpacking
  is deleted, a deletion error is ignored.
- Unpacking of the zip is done via `powershell.exe` or `pwsh.exe` (looked up via
  `which`), tar.gz — with the system command `tar`. Both commands require a return
  code of 0, otherwise the text of stderr, stdout or the code itself goes into the error.
- In the PowerShell command the single quotes of paths are escaped by doubling, and the
  progress itself is suppressed via `$global:ProgressPreference`.
- The executable is looked for by the name `rg.exe`/`rg` inside the unpacked
  directory with the version and the platform; if it is absent — the error «ripgrep archive did
  not contain executable».
- An empty download response is considered an error before writing the file: at a zero
  byte length the download is aborted right away.
- Launching the helper commands is done by hand through `ChildProcessSpawner` with
  `extendEnv: true` and `stdin: "ignore"`, stdout and stderr are collected and the return
  code is read at the same time (`concurrency: "unbounded"`).

## Connections

- The dependencies of the node: `FSUtil.node`, `Global.node`, the HTTP client and
  `CrossSpawnSpawner.node`.
- The content file search lives in `../ripgrep.js`, and the consumer of the binary
  path is the `filesystem/search.ts` layer, which chooses between ripgrep and fff.
- `which` is taken from `../util/which.js` and gets the extra directory
  `Global.bin`, therefore a manually installed `rg` from the data directory is visible
  just like a system one.

## Pitfalls

- The very first attempt at launching downloads the file from the network: without access to GitHub the service
  fails, even if somewhere on the machine there is a working `rg` — but only if that one is not
  found in `PATH` and in `Global.bin`.
- For Linux the musl build is taken: on glibc systems it works, on
  non-standard environments the choice is not adapted to the libc of the machine.
- Windows without PowerShell has nothing to unpack the zip with — `findExecutable` will return
  empty, and `powershell.exe` will be chosen by default, which may
  be absent.
- `filepath` is an `Effect` with an error in the channel: the calling side is obliged to
  handle the failure, and not to consider the path guaranteed.
- The archive after unpacking is deleted, but copies remain in the temporary unpacking
  directory; they are removed by the scope finalizer of `makeTempDirectoryScoped`.