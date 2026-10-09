# core/database — access to SQLite on Drizzle and Effect: database service, runtime adapters, migrations and V1 → V2 data transfer

## What's In This Folder

77 `.ts` files in four layers:

- service and startup: `database.ts`, `sqlite.ts`, `sqlite.bun.ts`, `sqlite.node.ts`, `sqlite.workerd.ts`.
- column types and shared schema pieces: `path.ts`, `schema.sql.ts`.
- a Drizzle fork under Effect: `drizzle.ts`, `drizzle/index.ts`, `drizzle/effect-sqlite/`, `drizzle/internal/`, `drizzle/sqlite-core/effect/`.
- migrations and data transfer: `migration.ts`, `migration.gen.ts`, `schema.gen.ts`, `migration/`, `v1-migration.ts`, `v1-migration.bun.ts`, `v1-migration.noop.ts`.

## Key Files

- `database.ts` — the `Database.Service` service (token `@opencode/storage/Database`, `Interface` with a `db` field), the layers `layer`, `layerFromClient`, `configured`, `configuredClient`, `node`; pragmas at startup, `restrictToOwner`, semaphores per file path.
- `sqlite.ts` — the shared frame of the adapters: the `Sqlite.Native` service, `makeConnection`, `makeClient` (semaphore, `acquirer`, `transactionAcquirer`, `spanAttributes` with `db.system.name = sqlite`).
- `sqlite.bun.ts`, `sqlite.node.ts`, `sqlite.workerd.ts` — three implementations on top of `bun:sqlite`, `node:sqlite` and Durable Object storage; each declares `supportsTuningPragmas` and `supportsForeignKeyToggle`.
- `migration.ts` — `apply` and `applyOnly`, keeping the log in the `migration` table, carrying marks over from `__drizzle_migrations`.
- `migration.gen.ts` — the `migrations` array of 48 migrations (`m00`…`m47`), the order of application.
- `migration/` — 58 migration files, each exports `{ id, foreignKeys?, up }` and runs SQL through `tx.run`.
- `schema.gen.ts` — the whole bootstrap schema: 19 tables and 16 indexes, in a single `up` function.
- `v1-migration.bun.ts` — transfer of a V1 database (tables `message`, `part`) into V2 (`session_message`), plus the import of a neighboring `opencode-next.db`.
- `path.ts` — the columns `absoluteColumn`, `directoryColumn`, `pathColumn`, `absoluteArrayColumn`.
- `schema.sql.ts` — `Timestamps` with `time_created` and `time_updated`.
- `drizzle/effect-sqlite/driver.ts` — `make` and `makeWithDefaults`, `DefaultServices`.
- `drizzle/effect-sqlite/session.ts` — `EffectSQLiteSession`, `EffectSQLiteTransaction`, `managesTransactionsNatively`.
- `drizzle/sqlite-core/effect/` — the builders `select`, `insert`, `update`, `delete`, `count`, `query`, `raw`, `session`, `db`.
- `drizzle/internal/drizzle-utils.ts` — work with Drizzle's private symbols and a JIT check of the environment.

## Important Details

- Startup of a file database: with `supportsTuningPragmas` it runs `PRAGMA journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout = 5000`, `cache_size = -64000`, `wal_checkpoint(PASSIVE)`; with `supportsForeignKeyToggle` — `PRAGMA foreign_keys = ON`. Then the migrations are applied under the lock.
- The database lock is bound to a specific database, not to the module: file databases share a semaphore by the path from a `Map`, `:memory:` gets its own. The reason is in the comment — in workerd all objects of an isolate share the module state, and releasing a shared semaphore wakes a waiting fiber in the context of someone else's I/O.
- `restrictToOwner` sets `0600` on the file and on `-wal`/`-shm`; on win32 it does nothing. A missing file is created synchronously (`openSync`/`closeSync`), otherwise another fiber would open it first; the comment notes that opening and closing a ready database drops POSIX locks of a foreign connection.
- `apply` chooses a branch by the table `session` or `session_v2`: if there is no such table and the database is not empty — `Effect.die` with the message «Database is not empty and has no session table»; if there are no tables at all — a full bootstrap runs: `schema.gen.ts`, the `migration` table and the mark of all migrations at once. System tables and names with a leading underscore are ignored — a namespace without a prefix belongs to OpenCode.
- `applyOnly` with an empty log once carries marks over from `__drizzle_migrations`: either directly from the `name` column, or by matching `created_at` with the prefix of an `id` of the form `YYYYMMDDHHMMSS`; a mismatch is `Effect.die`. Then every unrecorded migration is run in a transaction together with the record of its `id` and time.
- Migrations with `foreignKeys: false` go with the check weakened: `PRAGMA foreign_keys = OFF` where toggling is allowed, otherwise `PRAGMA defer_foreign_keys = ON`, with restoration in `ensuring`.
- The migration `20260804233008_loose_psylocke` is a fork: if the log has the marker `20260730195856_optional_session_title`, it renames `session` to `session_v2` in place (checking that there is no V1 history without a V2 projection), otherwise it collects the whole V2 set of tables and indexes.
- The migration `20260805200742_import_legacy_credentials` reads `auth.json` from `Global.data`, carries the `oauth`, `api`, `wellknown` entries over into `credential`, and folds the wellknown sources into `kv` under the key `wellknown:sources`; the OAuth method is chosen by the integration name: `openai` → `chatgpt-browser`, `github-copilot`, `opencode`, `xai` → `device`, otherwise `oauth`.
- `schema.gen.ts` creates `account`, `account_state`, `control_account`, `credential`, `event`, `event_sequence`, `kv`, `permission`, `project`, `project_directory`, `instruction_blob`, `instruction_entry`, `instruction_state`, `session_inbox`, `session_message`, `session_pending`, `session_v2`, `workspace`, `worktree`. Unique indexes: `event_aggregate_seq_idx`, `session_message_session_seq_idx`, `session_pending_session_admitted_seq_idx`, `session_inbox_session_enqueued_seq_idx`, `permission_project_action_resource_idx`. Partial: `session_pending_session_compaction_idx` (on `type = 'compaction'`) and `session_v2_time_suspended_idx`.
- `v1-migration.bun.ts` considers the migration needed by the presence of the table `session` in `sqlite_master`; the state lives in `kv` under the key `migration.v1-v2` with a cursor over `session.id`. The old table `event` is cleaned in portions of 1000 rows. `transformSession` collects messages of the types `user`, `assistant`, `compaction`, `synthetic`, `system`, sets `seq` and a watermark in `event_sequence`; broken rows do not bring the transfer down, they land in `warnings` and in the log. V1 → V2 tool renames: `bash` → `shell`, `task` → `subagent`, `apply_patch` → `patch`, the `filePath` argument → `path`, in `skill` the `name` argument → `id`, the old task-list tool is abolished; about the renames met in the visible history, a system message is added.
- The import of `opencode-next.db` is read-only, checks for the presence of `project`, `session`, `session_message`, and missing columns are projected through a fallback or `NULL` (`icon_url_override` is taken from `icon_url`).
- `path.ts`: `absolute` throws on a non-absolute path and understands windows paths on any OS; `directoryColumn` lets an empty string through for legacy sessions; `pathColumn` only changes the separators; `absoluteArrayColumn` stores a JSON array and decodes it with a synchronous schema.
- Bun and Node read integers differently: Bun — `statement.safeIntegers`, Node — `setReadBigInts` plus `setReturnArrays(true)` for value queries; both take the flag from the `SqlClient.SafeIntegers` service. In workerd this flag is ignored, and an `ArrayBuffer` from a blob is cast to `Uint8Array`.
- The workerd client is marked `transactionStatements: false`, so the Drizzle session does not send `BEGIN`/`COMMIT`/`SAVEPOINT` but calls `withTransaction` on top of `storage.transaction`; nested transactions are an error. In a regular session the nesting is done via a savepoint with an increasing number and an honest `rollback to savepoint`.
- Drizzle fork: each builder class at the end of the file goes through `applyEffectWrapper`, so the builder itself is an `Effect`. In `SQLiteEffectPreparedQuery` the result is mapped by a JIT mapper or row by row; inside a transaction the cache is always off; an error is wrapped in `EffectDrizzleQueryError`. `SQLiteEffectTransaction.rollback()` returns `EffectTransactionRollbackError`.
- `drizzle/internal/drizzle-utils.ts` pulls Drizzle's private data out through the symbols `Columns`, `IsAlias`, `Name`, `BaseName` and `ViewBaseConfig`; `jitCompatCheck` disables the JIT mappers if `new Function` is forbidden in the environment.

## Connections

- The import conditions are set in `packages/core/package.json`: `#sqlite` → `sqlite.workerd.ts`, `sqlite.bun.ts`, `sqlite.node.ts` (node by default), `#v1-migration` → the full implementation only for bun, `v1-migration.noop.ts` for node and workerd.
- `database.ts` → `drizzle.ts` → `drizzle/index.ts` → `drizzle/effect-sqlite/driver.ts` and `session.ts` → `drizzle/sqlite-core/effect/session.ts` → `drizzle/sqlite-core/effect/db.ts` and the other builders → `drizzle/internal/drizzle-utils.ts`.
- `database.ts` → `migration.ts` → `migration.gen.ts` → `migration/`; `migration.ts` → `schema.gen.ts` and `#sqlite` behind the `supportsForeignKeyToggle` flag.
- `v1-migration.bun.ts` → `session/sql.ts`, `kv/sql.ts`, `event/sql.ts`, `session/schema.ts`, `session/message.ts`, `@opencode/schema/session-v1`, `@opencode/schema/project`.
- The columns from `schema.sql.ts` and `path.ts` are used by `account/sql.ts`, `credential/sql.ts`, `kv/sql.ts`, `permission/sql.ts`, `project/sql.ts`, `session/sql.ts`.
- The `Database.Service` service is consumed by `bus.ts`, `credential.ts`, `kv.ts`, `project.ts`, `session.ts` and the `session/` files: `session/compaction.ts`, `session/context.ts`, `session/diff.ts`, `session/execution.ts`, `session/generate.ts`, `session/history.ts`, `session/inbox.ts`, `session/instruction-entry.ts`, `session/move.ts`, `session/projector.ts`, `session/revert.ts`, `session/session.ts`, `session/stats.ts`, `session/store.ts`, `session/runner/llm.ts`.

## Pitfalls

- `#sqlite` and `#v1-migration` are resolved per runtime: a new adapter file without an entry in `packages/core/package.json` will not get into the build.
- In workerd `journal_mode`, `synchronous`, `busy_timeout`, `cache_size`, `wal_checkpoint` and `foreign_keys` are forbidden. They can only be tuned through the flags `supportsTuningPragmas` and `supportsForeignKeyToggle`.
- In workerd `sql.exec` rejects `BEGIN`, `COMMIT` and `SAVEPOINT`: a transaction goes only through `withTransaction`, nested transactions are not supported at all.
- The workerd adapter cannot open a file. For a Durable Object you need `Database.layerFromClient` together with `sqliteLayer({ storage })`; an attempt to give a path dies with an explanation in `Effect.die`.
- `runValues` in node requires `setReturnArrays(true)`: without the flag the values arrive not as arrays, and the result drifts into the typing.
- SQLite creates sidecars with the rights of the database, but does not tighten the already existing ones — so `restrictToOwner` chmods both `-wal` and `-shm`, and creates a missing file synchronously before the rights.
- The semaphore from `locks` cannot be shared module-wide: in workerd a release wakes a waiting fiber in a foreign I/O context, and its first storage call is rejected as cross-object I/O.
- `apply` dies on a non-empty database without a `session` table: this is someone else's database or not the right schema.
- The `id` of a migration equals the file name, and the run is determined by the log: renaming a file will make it run again, and already applied migrations cannot be rolled back.
- Some migrations irreversibly erase data: `20260603040000_session_message_projection_order` deletes `session_message`, `20260604172448_event_sourced_session_input` cleans `session_input`, `session_message`, `event`, `event_sequence` and `workspace`, `20260622202450_simplify_session_input` — the same. The migration `20260603141458` with autoincrement is replaced by a table without it.
- The order of application is set only by the `migrations` array in `migration.gen.ts`: a new file needs both an import and an array element.
- `insert`, `update`, `delete` without `returning()` give a run result; `all()`, `get()`, `values()` without `returning()` — a `DrizzleTypeError` type error.
- Inside a transaction the query cache is always off: read the fresh state, not the cache.
- `jitCompatCheck` kills the JIT mappers if the environment forbids `new Function`; in this mode `mapResultRow` maps the rows — slower, but correct.
- `drizzle/internal/drizzle-utils.ts` and the whole `drizzle/sqlite-core/effect/` come with `/* oxlint-disable */`: the linter stays silent here, only the type check catches errors. Plus the private Drizzle symbols must be re-checked after updating `drizzle-orm`.
- The V1 transfer status is derived from the presence of the table `session`, and on node and workerd it is always "completed": there a stub works, not the transfer.
- `directoryColumn` tolerates an empty string, `absoluteColumn` does not: a relative value from legacy data will cause an exception on write.
- In the database the paths are stored with slashes regardless of the OS, and `toPlatform` turns them into backslashes only on Windows at read time.