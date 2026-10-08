#!/usr/bin/env bun
// Publishes an Opencode++ release for friends: tags HEAD as release/<version>
// and pushes the tag. Installed copies see it on their next update check.
//
//   bun run release:pp 1.2.0            pushes to the "backup" remote
//   bun run release:pp 1.2.0 origin     pushes to another remote
import { $ } from "bun"

const version = process.argv[2]
const remote = process.argv[3] ?? "backup"

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail("Usage: bun run release:pp <major.minor.patch> [remote]")
if ((await $`git status --porcelain --untracked-files=no`.quiet().text()).trim())
  fail("Commit or stash your changes first: a release is exactly the committed HEAD.")
const tag = `release/${version}`
if ((await $`git tag -l ${tag}`.quiet().text()).trim()) fail(`${tag} already exists.`)

const published = (await $`git ls-remote --tags --refs ${remote} release/*`.quiet().text())
  .split("\n")
  .map((line) => line.split("refs/tags/release/")[1])
  .filter((item): item is string => Boolean(item))
const newest = published.toSorted((a, b) => Bun.semver.order(b, a))[0]
if (newest && Bun.semver.order(version, newest) <= 0) fail(`${version} must be newer than the published ${newest}.`)

await $`git tag -a ${tag} -m ${`Opencode++ ${version}`}`
await $`git push ${remote} ${tag}`
console.log(`Released ${tag} to ${remote}. Friends get it from the update prompt in Opencode++.`)

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
