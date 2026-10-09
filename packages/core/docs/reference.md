# core/reference — the instruction for the model about the extra reference directories of the project

## What's In This Folder

One file `packages/core/src/reference/instructions.ts`: it turns the `reference`
list of a project (directories additionally available to the agent) into an instruction
for the model — a text block with the tags `<available_references>`.

The idea: the agent must know which other directories of the project can be read, and know
it from the instruction, and not from guesses.

## Key Files

- `packages/core/src/reference/instructions.ts` — the service
  `ReferenceInstructions` (`@opencode/ReferenceInstructions`) with the single
  method `load()`, plus `node` for binding to a location.
- Inside the file: the schema `Summary` (`name`, `path`, `description` — the last one
  optional), the function `entries()` (the lines of the block), `render()` (the full
  list), `update()` (deltas between states).

## Important Details

- Only the references with a non-empty `description` get into the list. A reference without
  a description is filtered out, and not printed in an incomplete form.
- The list is sorted by `name` via `localeCompare` — the order is
  stable between calls, otherwise the diffs would "make noise".
- The instruction key is `core/reference-guidance`, it is also part of
  `Instructions.List`.
- `removed` is returned as a special value when no references are left.
  The render for this state is a separate line «Project reference guidance
  is no longer available. Do not use previously listed references.»
- Further along the file on disk the update is counted through
  `Instructions.diffByKey` by the `name` field with a change predicate on
  `path` and `description`.
- Rendering of deltas: additions are printed as «New project references are
  available in addition to those previously listed», removals — by a line with
  a listing of the names and a prohibition to use them.
- Any change of an existing reference (neither an addition nor a removal)
  switches to the full listing with the phrase «This list supersedes the previous
  reference list».
- The output format is XML-like tags with an indent of two spaces per `<reference>`
  level and four for the level of the fields.

## Connections

- `packages/core/src/reference.ts` — a neighboring file of the root `src`: the
  `Reference.Service` service itself with the `list()` method. The names,
  paths and descriptions of the references come from there.
- `packages/core/src/instructions/index.ts` — `Instructions.make`,
  `Instructions.Key`, `Instructions.diffByKey`, the type `Instructions.List`:
  the mechanism that stores the state and counts the changes between calls.
- `@opencode/util/effect/app-node` — `makeLocationNode`, which binds
  the service to `Reference.node` in the dependency graph.

## Pitfalls

- The filter by `description` is strict: a reference with an empty description disappears from
  the instruction entirely, although in `Reference.Service` it stays.
- `update` mixes two cases: a change of any reference prints the whole
  list anew, while pure additions and removals — by a delta. The logic of the condition
  is collected in one line, it is easy to break by adding a third kind
  of change.
- An empty list and a list that has changed towards empty give a different output:
  the first — `removed`, the second — a delta with removals and without additions.
- `render` always prints an explanatory line before `<available_references>`;
  in a diff this preamble is not output, only the blocks themselves.
- The paths and descriptions are substituted into the text without escaping: a reference name with
  angle brackets breaks the markup of the instruction.