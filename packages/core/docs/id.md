# core/id — identifier generation with an entity prefix and a sort direction

## What's In This Folder

- `id.ts` — the only file. It holds the entity prefix map, two wrappers over the generator (`ascending`, `descending`), the internal `generateID` and `createID`, time extraction from an ID, and a self-contained namespace re-export.

## Key Files

- `packages/core/src/id/id.ts` — the entire module.

## Important Details

- `prefixes` — a constant map of the form "entity → short prefix": `job` → `job`, `event` → `evt`, `session` → `ses`, `message` → `msg`, `permission` → `per`, `question` → `que`, `part` → `prt`, `pty` → `pty`, `tool` → `tool`, `workspace` → `wrk`. The parameter type is `keyof typeof prefixes`, so an unknown entity does not compile.
- `ascending(prefix, given?)` and `descending(prefix, given?)` — the only entry point for the other core packages. If `given` is not passed, a new ID is generated; if it is passed, it is only validated and returned as is.
- Validating `given`: the string must start with exactly this entity's prefix, otherwise an `Error` about the mismatch is thrown. This protects against passing off one entity's ID as another's (for example, a session ID passed as a job ID).
- `createID` assembles the string as `prefix + "_" + create(...)` — so the ID always contains an underscore separator.
- The real generation lives in `packages/schema/src/identifier.ts` (`create(descending, timestamp?)`): the first 12 hex characters encode `timestamp * 0x1000 + counter` (the inverted value when descending), the remaining 14 characters are random bytes from `crypto.getRandomValues` mapped onto a 62-character alphabet.
- The `counter` in the generator is process-wide and resets when the millisecond changes, so two IDs in the same millisecond do not collide.
- `timestamp(id)` parses the hex after `prefix_` and divides by `0x1000n`, discarding the counter. The function comment says outright that it does not work for descending IDs, because the value is bitwise inverted.
- `createID` is re-exported as `create` (`export { createID as create }`) — tests use exactly `Identifier.create("tool", "ascending", ts)` to get an ID with a given time.
- The last line of the file is `export * as Identifier from "./id.js"`, a self-contained namespace for imports like `import { Identifier } from "./id/id.js"`. The same trick is used in the other modules of the repository.

## Connections

- `packages/schema/src/identifier.ts` — the source of `create`, called here; the schema also has its own ID constructors (for example, `packages/schema/src/session-id.ts` builds `ses_` plus a descending suffix).
- `packages/core/src/job.ts` — `Identifier.ascending("job")` as the default ID value when creating a job.
- `packages/core/src/tool-output.ts` — `Identifier.ascending("tool")` for the tool output file name.
- `packages/core/test/tool-output.test.ts` — imports `Identifier` directly from `@opencode/core/id/id` and injects IDs with an artificial time to test cleanup of old files.
- `packages/core/package.json` — maps `./*` to `./src/*.ts`, so the external import `@opencode/core/id/id` works without a separate entry point.

## Pitfalls

- `timestamp` on a descending ID returns a meaningless number and throws nothing: the value inversion in the generator makes the original time unrecoverable. The direction has to be checked on the calling side.
- Descending IDs are not monotonically ordered by time in the usual sense: the inversion flips the counter inside a single millisecond too, so two IDs created in the same millisecond will be ordered by reverse counter.
- A passed `given` is neither normalized nor regenerated: this is not "create an ID if there is none yet", it is "validate and hand back". Functions with such an argument are not idempotent in the sense of producing a new value.
- The prefix check compares only the start of the string, so a string like `job_` with an empty tail passes validation — this module does not check the validity of the tail.
- The counter and `lastTimestamp` in the generator are process-level state: in two instances of the code living in one process the values continue the shared sequence instead of starting it over.