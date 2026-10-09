# core/kv — the "key-value" table for service state

## What's In This Folder

- `sql.ts` — the only file: a two-column `kv` table plus timestamps.
- There is no reading and writing logic in the folder: it is in the root `packages/core/src/kv.ts`.

## Key Files

- `packages/core/src/kv/sql.ts` — `KVTable`.

## Important Details

- The columns: `key` — `text().primaryKey()`, `value` — `text({ mode: "json" })` with the type `KV.Value` and `.notNull()`, plus `Timestamps` from `packages/core/src/database/schema.sql.ts`.
- The primary key is the key itself, so a record is unique by name and the update goes through `replace` or `insert ... onConflictDoUpdate`, and not through select-and-insert.
- The value is typed by the `$type<KV.Value>()` annotation, not by an Effect schema: the shape check of the value lives in the calling code.
- The field is called `value`, not `data`; in the other tables of the package it is read as `row.value`.

## Connections

- `packages/core/src/kv.ts` — the consumer of the table; a general-purpose service that other core subsystems also hold.
- `packages/core/src/database/v1-migration.bun.ts` — the second consumer of `KVTable` by the result of searching for the table name: during the migration of past versions the state is transferred into this table.
- `packages/core/src/models-dev.ts` — uses `KV` to store the model catalog cache (`updatedAt`, `digest`, `body`), that is, large JSON objects are put here too.
- `packages/core/docs/database.md` — the shared database access layer, through which the work with this table goes.

## Pitfalls

- The value type is imposed by an annotation: a string written into the table against `KV.Value` will not be checked either on write or on read.
- A key without a version and without a namespace: two subsystems that picked the same key silently share one record. That is exactly why in `models-dev.ts` the key includes a hash of the source (`models-dev:catalog:<hash>`), and not only the name.
- `Timestamps` on the table means that the creation and update times exist, but nobody in the schema watches their consistency — that is done by the code.
- `value` has no separate history table: overwriting a value leaves no trace, so the model catalog cache stores `digest` and `updatedAt` next to it, so as not to publish the byte-for-byte same catalog.