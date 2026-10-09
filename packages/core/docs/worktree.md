# core/worktree — working copies: the creation strategies, the service layer and the table

## What's In This Folder

Four files. Two implementations of the strategies of working with the working copies (currently only
git), the service layer with an editable state and a drizzle table. The general meaning:
a location can work not at the root of the project, but in a separate working copy, and
the way it is created is chosen by a strategy, and not by a hardcoded git call.

## Key Files

- `packages/core/src/worktree/strategies.ts` — the type `Strategy` (`create`,
  `remove`, `list`), the type `Editor`, the interface `Interface`, the service
  `@opencode/WorktreeStrategies`, `node`.
- `packages/core/src/worktree/git.ts` — `make()`: the implementation of the strategy with
  `id` = `git`.
- `packages/core/src/worktree/directory.ts` — `canonical` and the error
  `Worktree.DirectoryUnavailableError`.
- `packages/core/src/worktree/sql.ts` — the `WorktreeTable` for sqlite.

## Important Details

- `Strategy` is three operations: `create` (from `sourceDirectory` make
  `directory`, optionally on a branch), `remove` (with `force`) and `list` (a list of
  the records). All of them return an `Effect` with an unknown error channel.
- The state service: the name `worktree`, the initial value sets the directory of the working
  copy, the map of the strategies with one entry `git` and the chosen `selected`.
  The default directory is assembled as `Global.data` + `worktree` + the first
  6 characters of the project id.
- The state editor: `configure` changes the directory, `add` registers a new
  strategy and immediately makes it chosen. A replacement of a strategy with the same `id`
  removes the previous record from the map.
- `canonical` resolves the path via `FSUtil.resolve`, requires that it be a
  directory, and otherwise falls with `DirectoryUnavailableError` with the original, and not
  the resolved, path.
- `create` in the git strategy first looks for the repository via `repo.discover`;
  if there is none — `DirectoryUnavailableError`. The creation itself is delegated
  to `git.worktree.create`, and the already canonicalized directory is handed outward.
- `list` enumerates the records of the working copies and canonicalizes the directory for each;
  a record whose directory has disappeared is discarded via
  `Effect.catchTag("Worktree.DirectoryUnavailableError", ...)`.
- The type of a record is derived from the kind of the git record: `main` becomes `root`, everything
  else — `worktree`.
- The `worktree` table is composite: a primary key from `project_id` and `directory`,
  a foreign key to the project with a cascade delete, the directory is stored by an absolute path column,
  the strategy — by text, the creation time — with the default
  `Date.now()`.

## Connections

- The `git` strategy depends on the services `Git` and `FSUtil`, the layer — also on
  `Location` and `Global`; the list of the dependencies of the node: `Location.node`, `Global.node`,
  `Git.node`, `FSUtil.node`.
- `sql.ts` refers to the project table and to the absolute path column from
  `../database/path.js`, therefore the directories in the database are written in the same format as
  the other paths of the core.
- The domains and the ids come from `@opencode/schema/worktree`; the path type is `AbsolutePath`
  from `../schema.js`.
- The state is shared with the rest of the core via `State.create` with the name `worktree`.

## Pitfalls

- A strategy is a thing added at runtime: `add` switches `selected`, and
  everything that read the directory before that works with the old value.
- The default directory cuts the project id to 6 characters — the long ids of different
  projects can give one and the same directory if the prefixes coincide.
- `list` silently discards the records with an unavailable directory: the number of the records may
  not coincide with `git worktree list`, and that is not an error.
- The `canonical` in the answer of `create` may differ from the requested directory
  (symlinks, a relative path) — it is exactly it that must be returned outward.
- `DirectoryUnavailableError` is not in the list of the typical errors of a strategy: it
  comes out as a part of the `unknown` channel and is handled by the tag.