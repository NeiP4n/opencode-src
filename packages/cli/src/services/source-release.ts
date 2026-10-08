export * as SourceRelease from "./source-release"

import { $ } from "bun"
import path from "node:path"
import { parseReleaseVersion } from "./updater-action"

// Opencode++ is shared as a git checkout pinned to a release tag (release/1.2.0),
// installed by opencode-pp-install.sh or .ps1. Such a checkout updates by moving to the
// newest release tag on its origin. A checkout on a branch is a development tree:
// it never offers updates, so work in progress is never replaced.

const PREFIX = "release/"
const checkout = path.resolve(import.meta.dir, "../../../..")

// The release this checkout is pinned to, or undefined for a development tree.
export async function current(root = checkout) {
  // Installs sit on a detached tag; a branch is a development tree even right
  // after its commit was tagged for release.
  const branch = await $`git -C ${root} symbolic-ref -q HEAD`.quiet().nothrow()
  if (branch.exitCode === 0) return undefined
  const tag = await $`git -C ${root} describe --tags --exact-match --match ${PREFIX + "*"} HEAD`
    .quiet()
    .nothrow()
    .text()
  return version(tag.trim())
}

// The newest release published on origin.
export async function latest(root = checkout) {
  const listing = await $`git -C ${root} ls-remote --tags --refs origin ${PREFIX + "*"}`.quiet().text()
  return newest(
    listing
      .split("\n")
      .map((line) => version(line.split("\t")[1]?.replace("refs/tags/", "") ?? ""))
      .filter((item): item is string => item !== undefined),
  )
}

// Moves the checkout to a release and installs its dependencies.
export async function apply(release: string, root = checkout) {
  await $`git -C ${root} fetch --tags --force origin`.quiet()
  await $`git -C ${root} checkout --detach ${PREFIX + release}`.quiet()
  // The running Bun, so the update works even when bun is not on PATH.
  // Only what the terminal app needs, as the installer does.
  await $`${process.execPath} install --frozen-lockfile --filter ./packages/cli`.cwd(root).quiet()
}

export function newest(versions: readonly string[]) {
  return versions.toSorted((a, b) => Bun.semver.order(b, a))[0]
}

function version(tag: string) {
  if (!tag.startsWith(PREFIX)) return undefined
  const value = tag.slice(PREFIX.length)
  return parseReleaseVersion(value) ? value : undefined
}
