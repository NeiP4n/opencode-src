# core/event — tables of the durable event log

## What's In This Folder

- `sql.ts` — the only file: two tables, `event_sequence` and `event`.
- There is no event engine in the folder at all: no subscription, no publication, no bus.

## Key Files

- `packages/core/src/event/sql.ts` — `EventSequenceTable`, `EventTable`.

## Important Details

- `event_sequence`: `aggregate_id` — primary key, `seq` — `integer().notNull()`, `owner_id` — `text()` without being required. This is the counter of the last issued event number for an aggregate; the owner of the aggregate (`owner_id`) is stored next to the same counter.
- `event`: `id` (of type `Event.ID` from `packages/schema/src/event.ts`), `aggregate_id` — `.notNull()` with a reference to `event_sequence.aggregate_id` and `onDelete: "cascade"`, `seq`, `type`, `data` — `text({ mode: "json" })` of type `Record<string, unknown>` with `.notNull()`.
- The order of events is held by the unique index `event_aggregate_seq_idx` on `(aggregate_id, seq)`. A repeated insert with the same number is impossible — that is the protection against double publication.
- The second index `event_aggregate_type_seq_idx` on `(aggregate_id, type, seq)` serves reading a subset of events of one type in chronological order.
- `created` is `integer().notNull().default(0)`, not part of `Timestamps`: an event has its own single time field with a default value, not a created/updated pair.
- `data` is annotated `$type<Record<string, unknown>>()`: the type of the payload is not checked at the table schema level, it comes from above when the event is decoded.
- Deleting an aggregate cascade deletes its events: the log is bound to the aggregate, not stored forever on its own.

## Connections

- `packages/core/src/bus.ts` — the real engine: by the result of searching for the table names it uses both `EventTable` and `EventSequenceTable` (issuing numbers). This is the place where the log is written and read.
- `packages/core/src/session/stats.ts` — reads `EventTable`: session statistics are collected from the event log.
- `packages/core/src/database/v1-migration.bun.ts` — mentions `EventSequenceTable` when transferring the state of past versions.
- `packages/schema/src/event.ts` — the source of the `Event.ID` types and event schemas, which are decoded on read.
- `packages/core/src/bus.ts` and `packages/core/src/session/stats.ts` — the only consumers of the log; there is no separate document about the bus mechanism in `packages/core/docs`.

## Pitfalls

- The folder is called `event`, but it implements no events. Searching for subscribers, `publish` or `subscribe` in this directory will find nothing — all of that is in `bus.ts`.
- `data` is stored as JSON without a schema check. The shape of the log is held by the reading code; a broken payload surfaces at decoding, not at writing.
- Event numbers are issued by `event_sequence`, and the unique index in `event` only forbids duplicates. Inserting an event without first taking a number from the counter will fail on the unique index.
- `owner_id` is optional: events without an owner are written, and by the table alone you cannot tell whose they are.
- `created` defaults to `0`, not "now". The calling code sets the time value; if it did not, the event will look like it was created in the Unix epoch.