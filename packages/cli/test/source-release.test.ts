import { expect, test } from "bun:test"
import { $ } from "bun"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { SourceRelease } from "../src/services/source-release"

// A published repository with two releases and a friend's install pinned to the older one.
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-pp-release-"))
  const origin = path.join(root, "origin")
  const install = path.join(root, "install")
  const identity = {
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  }
  const git = (args: string[]) => $`git -C ${origin} ${args}`.env({ ...process.env, ...identity }).quiet()
  await $`git init -q -b main ${origin}`.quiet()
  await writeFile(path.join(origin, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }))
  await $`${process.execPath} install`.cwd(origin).quiet()
  await git(["add", "-A"])
  await git(["commit", "-qm", "one"])
  await git(["tag", "release/1.0.0"])
  await writeFile(path.join(origin, "notes.txt"), "two")
  await git(["add", "-A"])
  await git(["commit", "-qm", "two"])
  await git(["tag", "release/1.2.0"])
  await git(["tag", "release/not-a-version"])
  await $`git clone -q ${origin} ${install}`.quiet()
  await $`git -C ${install} checkout -q --detach release/1.0.0`.quiet()
  return { root, origin, install, [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) }
}

test("a pinned install sees and moves to the newest release", async () => {
  await using repo = await setup()
  expect(await SourceRelease.current(repo.install)).toBe("1.0.0")
  expect(await SourceRelease.latest(repo.install)).toBe("1.2.0")

  await SourceRelease.apply("1.2.0", repo.install)
  expect(await SourceRelease.current(repo.install)).toBe("1.2.0")
  expect(await Bun.file(path.join(repo.install, "notes.txt")).text()).toBe("two")
})

test("a checkout on a branch is a development tree and never updates", async () => {
  await using repo = await setup()
  await $`git -C ${repo.install} checkout -q main`.quiet()
  expect(await SourceRelease.current(repo.install)).toBeUndefined()
})

test("the newest release is chosen by version, not by name order", () => {
  expect(SourceRelease.newest(["1.9.0", "1.10.0", "1.2.3"])).toBe("1.10.0")
})
