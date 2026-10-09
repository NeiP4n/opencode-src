# core/account — unused account schema and selection state

## What's In This Folder

- `sql.ts` — the only file: three drizzle-orm sqlite tables.
- `account` — a record with a token pair and an expiry time.
- `account_state` — a single state row: which account and which organization are selected right now.
- `control_account` — marked in code as `LEGACY`: an older storage shape with a composite primary key.

## Key Files

- `packages/core/src/account/sql.ts` — `AccountTable`, `AccountStateTable`, `ControlAccountTable`.

## Important Details

- `AccountTable`: `id` (primary key), `email`, `url`, `access_token`, `refresh_token` — all `.notNull()`, `token_expiry` is `integer()` and optional, plus `Timestamps` from `packages/core/src/database/schema.sql.ts`.
- `AccountStateTable`: `id` is `integer().primaryKey()` without `$defaultFn`, so the row number comes from the database itself; this table has no `Timestamps` with its own column names either. The current selection is stored as an `active_account_id` reference to `AccountTable.id` with `onDelete: "set null"`: deleting an account clears the selection but not the state row itself.
- `active_org_id` — a plain `text()` with no reference to an organizations table: there is no such table in the package.
- `ControlAccountTable` — composite primary key `primaryKey({ columns: [table.email, table.url] })`, meaning the same person at different URL installations is distinct, while two accounts with identical email and URL collapse into one. `active` here is declared `.notNull().$default(() => false)`, unlike the field of the same name in the permissions table.
- The `// LEGACY` comment sits above `ControlAccountTable` and refers to it alone.

## Connections

- Searching `packages/core/src` for `AccountTable` and `ControlAccountTable` finds only `packages/core/src/account/sql.ts` itself: there are no external consumers.
- `packages/core/src/credential.ts` — a neighboring secret-storage mechanism, it is live; the account schema next to it is unused.
- `packages/core/src/database/v1-migration.bun.ts` — the only place in the package that migrates data from older versions; it does not mention the account tables.

## Pitfalls

- The whole folder is dead: three tables are declared, but no core code reads or writes any of them. Changing them mindlessly is doubly dangerous — an edit will not break the build, because there is nothing to break, and it will not help either.
- Tokens live in the same database as the rest of the data and are not encrypted at the schema level: protection depends entirely on the access rights to the database file.
- `token_expiry` is declared `integer()` and is optional. There is no code reading it, so the unit (seconds, milliseconds) cannot be pinned down from anything — you can only guess from the data.
- `AccountStateTable.id` without `$defaultFn` relies on SQLite autoincrement; inserting an explicit `id` breaks the subsequent auto-numbering.
- The general rule for single-table folders: `docs/credential.md`, `docs/kv.md` and `docs/event.md` are built the same way — only a drizzle schema, no logic.