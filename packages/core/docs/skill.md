# core/skill — downloading skills from an external index and the instruction about them for the model

## What's In This Folder

Two files: `packages/core/src/skill/discovery.ts` — loading of the skills from
an external HTTP index into a cache, and `packages/core/src/skill/instructions.ts` —
the instruction for the model with the list of available skills.

## Key Files

- `packages/core/src/skill/discovery.ts` — the service `SkillDiscovery`
  (`@opencode/SkillDiscovery`) with the single method `pull(url)`:
  it returns an array of absolute paths to the downloaded skills.
- `packages/core/src/skill/instructions.ts` — the service `SkillInstructions`
  (`@opencode/SkillInstructions`) with `load(permissions)`.
- The schemas in `discovery.ts`: `Index` (`{ skills: [...] }`) and `IndexSkill`
  (`name`, the optional `version`, `files`).

## Important Details

- The index protocol: at the address `url` (with a trailing `/` added) `index.json` is read,
  each skill has `files`, each file has a URL
  relative to `<name>/`.
- A skill is taken only if it has `SKILL.md` or `<name>.md`.
  Both variants are checked both when downloading and in the ready catalog.
- The skill directory: `path.resolve(global.cache, "skills", Hash.fast(base))`,
  that is, a subdirectory of the cache named by the hash of the index address, and inside it
  the skill directory.
- The path safety checks are multilayered and trigger **before** the download:
  `isSafeSegment` for the name, `isSafeRelativePath` for each file,
  `FSUtil.contains` for the directory, the match `resource.origin === source.origin`
  for the URL. Any failure discards the skill entirely.
- `isSafeRelativePath` cuts off `\` and `\0`, `?`, `#`, absolute paths in
  posix and win32, URL-like strings, and each segment is checked after
  `decodeURIComponent` — an unparsed percent gives a refusal.
- The files of one skill are downloaded in parallel, the constant `fileConcurrency`
  equals 8; the skills are processed in parallel, `skillConcurrency` equals 4.
- The HTTP client is reconfigured: a retry of transient errors twice on
  an exponential schedule with jitter (base 200 ms) and a filter
  of non-2xx answers.
- The download of each file is idempotent: if the target already exists,
  `download` does nothing and returns `true`.
- The update safely replaces the directory. If the version of the skill is set and does not
  match the content of `.opencode-version`, the files are downloaded into
  `staging` = `<root>.tmp-<uuid>`, the presence of the manifest is checked, the new version is written,
  then the old directory goes into `backup` = `<root>.old-<uuid>`,
  staging is renamed into place, and the backup is deleted.
- The replacement of the directory is wrapped in `Effect.uninterruptible`, and a rename error
  rolls the `backup` back into place.
- Any failure during the update is logged and **does not** interrupt: the staging
  stays untouched, and `ensuring` deletes it recursively.
- `instructions.ts` shows a skill only if it has a `description`
  and `autoinvoke` is not `false`.
- Before the output the skills are filtered by the permissions: `Skill.available(list, permissions)`,
  which is given the merged ruleset of the agent and the session.
- The instruction key is `core/skill-guidance`; the sorting is by `id`.
- The instruction says to the model directly: a skill that has already arrived as a `<skill_content>`
  block in the correspondence does not need to be called again.

## Connections

- `packages/core/src/skill.ts` — a neighboring file of the root `src`: the service
  `Skill.Service` with the list of skills, the types `Skill.ID`, `Skill.Name` and
  the function `Skill.available`.
- `packages/core/src/instructions/index.ts` — `Instructions.make`,
  `Key`, `diffByKey`, `removed`; the delta engine.
- `packages/core/src/permission.ts` — the type `Permission.Ruleset`, which
  filters the list of skills.
- `@opencode/util/fs-util` — `exists`, `readFileStringSafe`, `writeWithDirs`,
  `writeFileString`, `rename`, `remove`, `contains`.
- `@opencode/util/hash` — `Hash.fast` for the name of the directory in the cache.
- `effect/unstable/http` — the client, the retries and `schemaBodyJson` for the parsing of
  `index.json`.
- `@opencode/util/effect/app-node` — `makeGlobalNode` for the discovery and
  `makeLocationNode` for the instruction.

## Pitfalls

- `SkillInstructions` is created via `makeLocationNode`, and `SkillDiscovery` —
  via `makeGlobalNode`: the first is rebuilt per location, the second is global.
- `pull` returns only those skills for which a manifest was found after
  the download. A skill without files in the index silently falls out of the result.
- The absence of `version` in a skill means that the update is not checked: the files
  are simply downloaded on top, and `.opencode-version` is not written.
- `Hash.fast` is from the index address, and not from the skill: a change of the address resets
  the whole cache of skills for that index.
- The filter by `autoinvoke === false` compares strictly: a skill without the field
  `autoinvoke` gets into the instruction if the description is enough.
- The comparison of the permissions in `load` happens on the side of the caller: if you pass
  the wrong ruleset, the instruction will get skills that the agent will not be able to call.