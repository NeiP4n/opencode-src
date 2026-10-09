# @opencode/script — release versions and channels

## What This Is

A single-file package: 1 file `src/index.ts`, 88 lines. This is not a library
for the core, but a build script that computes which version and channel the
current build has reached. The numbers for npm releases and preview builds
come from here.

It exports a single object `Script` with the properties `channel`, `version`,
`preview`, `release`, `team`. On import the script immediately prints the
computed values to stdout (`console.log` at the end of the file) — this is the
standard way to hand data to CI.

## Layers and Dependencies

Layer **L0 — leaf**: does not depend on `@opencode/*` packages. The only runtime
dependency is `semver`, plus the Bun API (`import { $ } from "bun"`).

Who depends on the package:

- the root `package.json` (workspace dependency),
- `packages/cli/package.json`.

In `src` there is not a single `@opencode/script` import: the package is run as
a script, not used as a core module.

## Subsystems and Files

The only file `packages/script/src/index.ts` does four things in order:

1. **Bun version check.** Reads the `packageManager` field from the root
   `package.json`, compares it with `process.versions.bun` via `semver.satisfies`
   (`^x.y.z`) and fails if the Bun version does not fit.
2. **Channel selection.** The environment variables `OPENCODE_CHANNEL`,
   `OPENCODE_BUMP`, `OPENCODE_VERSION`, `OPENCODE_RELEASE`; if the channel is
   not set — the name of the current git branch is taken (`git branch --show-current`),
   otherwise `local`. The `latest` channel means a regular release, everything
   else — a preview.
3. **Version computation.** For a preview — `0.0.0-<channel>-<build number>`; the number
   is taken from `GITHUB_RUN_NUMBER` (and `GITHUB_RUN_ATTEMPT`), and on a local
   run — from the current time. For a release the version is requested from the npm
   registry (`@opencode/cli/latest`) and incremented by `OPENCODE_BUMP`:
   `major`/`minor`/`patch` (patch by default). The `2.0.0` threshold is the minimum
   version, we do not go below it.
4. **Team list.** Reads `.github/TEAM_MEMBERS` (lines, `#` — a comment)
   and adds the bots `actions-user`, `opencode`, `opencode-agent[bot]`.

## Entry Points

1. `packages/script/src/index.ts` — the only file, and at the same time the entry
   point from `exports` (`".": "./src/index.ts"`).
2. The import happens only from build scripts: the root `package.json` and
   `packages/cli/package.json`.
3. `Script` — the only named export.

## Where to Look Next

- `packages/cli/PACKAGE.md` — the consumer of the script: the CLI commands packaged
  into a release.
- `.github/` in the repository root — the workflow where `OPENCODE_VERSION`
  and `GITHUB_RUN_NUMBER` are set.
- `packages/util/PACKAGE.md` — the shared layer the core takes paths and hashes from.

## Pitfalls

1. **The script runs on import.** Top-level lines do `fetch`
   to the npm registry and run git — an import from a test or a sandbox will hit
   the network.
2. **A preview version depends on the environment.** Without `GITHUB_RUN_NUMBER` the number
   is assembled from the timestamp, that is, two builds within one minute give the same
   number.
3. **`console.log` at the end of the file** is not debugging, it is a contract: CI reads
   the output. It must not be removed.
