# core/project — the project schema and table, plus the transfer of the old directory table

## What's In This Folder

- `schema.ts` — local schemas on top of `@opencode/schema/project` and its own `Vcs` schema.
- `sql.ts` — the `project` table, the `project_directory` table marked as obsolete and the function `upsertProject`.
- There is no logic for working with a project in the folder: it is in the root `packages/core/src/project.ts`.

## Key Files

- `packages/core/src/project/schema.ts` — `ProjectSchema` with `ID`, `Current`, `Info`, `UpdateInput`, `Event`, `Vcs`.
- `packages/core/src/project/sql.ts` — `ProjectTable`, `ProjectDirectoryTable`, `upsertProject`.

## Important Details

- `ProjectTable`: `id` (of type `ProjectSchema.ID`), `worktree` — a path column via `absoluteColumn()`, `vcs` — of type `ProjectSchema.Vcs["type"]`, `name`, `icon_url`, `icon_url_override`, `icon_color`, `time_initialized`, `time_active`, `sandboxes` and `commands`.
- `worktree` — the only column meaningful for the identity of a project: the path, and not the name. The name and the icons are optional decoration.
- `time_active` is declared `.notNull().default(0)` with `$defaultFn(() => Date.now())`. The default value in SQLite and the default value in TypeScript differ: the first is written by the database in the absence of a field, the second is substituted by the driver before sending.
- `sandboxes` — `absoluteArrayColumn()`, that is, an array of paths and not a JSON string in the general sense; the column types are taken from `packages/core/src/database/path.ts`.
- `commands` — `text({ mode: "json" })` with the type `{ start?: string }`: in fact one option is stored, and the plural name of the column is misleading.
- `ProjectSchema.Vcs` — `Schema.Struct({ type: Project.Vcs, store: AbsolutePath })`: the version control system type plus the path to its storage. This is the only schema added in the folder beyond the schema re-exports.
- `ProjectDirectoryTable` is marked `@deprecated` with a replacement pointer: `WorktreeTable` from `packages/core/src/worktree/sql.ts`. Its composite primary key `(project_id, directory)` expresses the old model of "a project has many directories".
- `upsertProject` accepts both a database client and a transaction: the `Transaction` type is derived from the `transaction` signature of the client, and not declared by hand.
- The logic of `upsertProject` is asymmetric: with `vcs` set the update condition requires that the database has `NULL` or a different value, and with `vcs` not set — that the value is already there. In other words the absence of `vcs` in the argument means "clear the flag", and not "do not touch".

## Connections

- `packages/core/src/project.ts` — the root of the subsystem: it reads and writes `ProjectTable`.
- `packages/core/src/permission/sql.ts` — declares a foreign key on `ProjectTable.id` with a cascade delete.
- `packages/core/src/session/sql.ts` and `packages/core/src/session/projector.ts` — refer to `ProjectTable` when working with sessions.
- `packages/core/src/worktree.ts` and `packages/core/src/worktree/sql.ts` — the new place of storage of the "project ↔ directory" correspondence, which has displaced `ProjectDirectoryTable`.
- `packages/schema/src/project.ts` — the source of `Project.ID`, `Project.Current`, `Project.Info`, `Project.UpdateInput`, `Project.Event` and `Project.Vcs`.
- `packages/core/src/schema.ts` — the source of `AbsolutePath`, the base type of all path columns.
- `packages/core/src/database/path.ts` — the implementation of `absoluteColumn()` and `absoluteArrayColumn()`.

## Pitfalls

- `upsertProject` updates only the `vcs` field. An already written `worktree` does not change on a repeated call, even if a different `canonical` is passed in the argument — the divergence of the path and the ID will remain unnoticed.
- The semantics of `vcs` are asymmetric: you cannot pass "no change", only "set the value" or "clear".
- The plural name of the `commands` column with a single `start` field — when adding options it is easy to get a shape that the old databases will not be able to read.
- `ProjectDirectoryTable` is declared but marked obsolete. Using it means writing into a table that the code does not read on the new schemas.
- Different names of time fields in one file: in `ProjectTable` there are `time_created`/`time_updated`/`time_initialized`/`time_active` from different sets, so the rule "a time is called time_*" is kept here, and the rule "a time comes from Timestamps" is not.