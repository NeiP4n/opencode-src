# core/instructions — the engine of composite instructions: values, hashes, deltas, render

## What's In This Folder

Two files: `packages/core/src/instructions/index.ts` — the mechanism itself, and
`packages/core/src/instructions/builtins.ts` — two built-in sources
(the date and information about the environment).

The mechanism solves this problem: instructions for the model change over time (the date,
catalogs, available skills), and one has to give the model not the whole list anew,
but a delta — what was added, what changed, what disappeared.

## Key Files

- `packages/core/src/instructions/index.ts` — the types `Source`, `List`,
  `ReadResult`, `Admission`; the functions `make`, `combine`, `read`, `diff`,
  `renderInitial`, `renderUpdate`, `hash`, `applyHashDelta`, `diffByKey`;
  the errors `InitializationBlocked` and `DuplicateKeyError`.
- `packages/core/src/instructions/builtins.ts` — the service
  `InstructionBuiltIns` (`@opencode/InstructionBuiltIns`) with the keys
  `core/date` and `core/environment`.

## Important Details

- A source (`Source`) is a "read the value" pair plus three render
  functions: `initial`, `changed`, `removed`. The value always goes through
  `codec` into canonical JSON: the same JSON is hashed, stored and replayed.
- Three states of a value, not two: an ordinary value, `unavailable` (reading
  temporarily failed — the stored value stays in force) and `removed`
  (the source exists, but there is no value anymore).
- The states are distinguished **by reference equality**, not by
  structure: `isUnavailable` compares with the `unavailable` singleton. In the code
  this is spelled out in a separate note, because the value `A` itself may be
  a JSON-like object with the same fields.
- `make` closes the typed definition in `Source` and knows how to
  decode a historical value: if `decode` gives `undefined`
  (the value does not fit the schema), the render is skipped and the line does not
  get into the output.
- `changed` with an unavailable previous value falls back to `initial` —
  a partial update is not shown.
- Empty text from a render is an exception (`requireText`), not a silent skip.
- `diff` counts `blocked` only on the first read (`previous` not passed):
  `InitializationBlocked` with a list of keys. If the values already exist,
  `unavailable` is simply skipped.
- `removed` lands in the delta only if the key was in `previous` — otherwise
  there is nothing to record about the removal.
- Hash: SHA-256 of the canonical form (`canonical`), where the object keys
  are sorted ascending. The order of fields in the object does not affect the hash.
- `read` reads all sources in parallel (`concurrency: "unbounded"`),
  the order of the result matches the order in the list.
- `combine` checks the uniqueness of the keys and throws `DuplicateKeyError`
  synchronously, before the reading.
- `renderInitial` and `renderUpdate` join the parts with two
  line breaks (`join("\n\n")`).
- `diffByKey` — a shared helper for comparing two lists by key with
  a change predicate; it is used not only by instructions (`reference` and `skill` call it too).
- `instructions/builtins.ts`: `core/date` renders `date.toDateString()`,
  `core/environment` — a `<env>` block with the working directory, the workspace root,
  the git-repository flag, `process.platform` and a hint to use
  `global.tmp` instead of `/tmp`.

## Connections

- `@opencode/schema/instruction` — the source of the `Key`, `Hash`, `Values`,
  `Delta` types and the `removed` constant; all four are re-exported from there.
- `packages/core/src/location.ts` — gives `location.directory`,
  `location.project.directory` and `location.vcs?.type` for the `<env>` block.
- `@opencode/util/global` — `global.tmp`, the path that is advised
  to use instead of the system temporary one.
- `@opencode/util/effect/app-node` — `makeLocationNode` for binding
  a service into the dependency graph (`Global.node`, `Location.node`).
- The consumers of the mechanism: `packages/core/src/reference/instructions.ts`
  (key `core/reference-guidance`) and
  `packages/core/src/skill/instructions.ts` (key `core/skill-guidance`).

## Pitfalls

- `unavailable` and `removed` are distinguished by identity, not by shape: if
  the source value contains an object with the same fields, that is not the removal
  state. Checking structurally is not allowed here.
- `diff` on the first read falls with `InitializationBlocked` if at least one
  source is `unavailable`. The list of keys in the error is exactly what blocks the start.
- `renderUpdate` for a removed key requires the key to be present in `previous`;
  otherwise the line is silently skipped.
- Canonicalization takes into account only the order of the keys of objects and arrays. The order
  of the array elements is meaningful, and it changes the hash.
- `codec` in `make` is applied both on write and on read: a value that
  does not pass `Schema.encodeSync` brings down the whole `read` of the source.
- The render functions in `Source` return `string | undefined`, in
  `Source.Definition` — a mandatory `string`. The mismatch is deliberate,
  so that historical values can be skipped.