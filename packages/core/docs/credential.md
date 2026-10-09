# core/credential — storage of integration credentials in SQLite

## What's In This Folder

- `sql.ts` — the only file: the drizzle-orm sqlite schema of the `credential` table.
- There is no runtime logic in the folder: reading and writing live in the root `packages/core/src/credential.ts`.

## Key Files

- `packages/core/src/credential/sql.ts` — `CredentialTable`.
- `packages/core/src/credential.ts` — the service that reads and writes this table.

## Important Details

- The table columns: `id` (primary key, of type `Credential.ID` from `packages/core/src/credential.ts`), `integration_id`, `label`, `value`, `connector_id`, `method_id`, `active`, plus the shared `Timestamps` set from `packages/core/src/database/schema.sql.ts`.
- `value` is a `text({ mode: "json" })` column with the type `Credential.Value`: the secret sits as a JSON value, not as a string. The type comes by an `import type`, that is, at the table build stage it is only a column annotation.
- `label` is declared `.notNull()`, while `integration_id`, `connector_id`, `method_id` and `active` are optional. `active` is at the same time `integer({ mode: "boolean" })`, that is, it accepts the values 0/1 and can be `null`: in SQLite that is not the same as `false`.
- The schema only reads types and imports no services: the only dependency of the folder is `packages/core/src/database/schema.sql.ts` (the `Timestamps` set).
- The table is declared in terms of core entities (`Credential.ID`, `Credential.Value`), not in terms of the application domain. The table schema does not know what an integration is or what authorizes it.

## Connections

- `packages/core/src/credential.ts` — the only consumer of `CredentialTable` (verified by searching the table name over `packages/core/src`).
- `packages/core/src/config.ts` — subscribes to `Credential.Event.Switched` and re-reads the config when the account of an integration taking part in a wellknown config has changed.
- `packages/core/src/config.ts` — when loading a wellknown entry it takes the latest credential of the integration and requires `credential.value.type === "key"`: entries of other types do not substitute the config.
- `packages/core/docs/permission.md` — a neighboring mechanism in meaning: permissions saved by the user also live in SQLite, but per project.
- `packages/core/docs/account.md` — another table with tokens; it is unused (see the pitfalls).

## Pitfalls

- The table declares no foreign keys on `integration_id`, `connector_id`, `method_id`: the integrity of the relations is held by the code, not by the database.
- `active` admits `null`. Code reading it as a flag must itself decide what the absence of a value means.
- The type `Credential.Value` is imposed by a `$type` annotation, not by a check: a value written into the table against the schema will have nothing to decode it later.
- The table has exactly one consumer in common, so any edit of the columns breaks only `credential.ts` — but an edit in the other direction (reading a field that is not in the table) already breaks at the type level.