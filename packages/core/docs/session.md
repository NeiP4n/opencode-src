# core/session — the session as a whole: inbox, projection, execution and assembling the request to the model

## What's In This Folder

- 49 `.ts` files (about 10 500 lines) plus `packages/core/src/session/runner/prompt/system.txt`.
- Subfolders: `runner/` — the loop of step execution (9 files), `execution/` — only `restart.ts` with the recovery after a restart.
- Layers by purpose: the public facade (`session.ts`), the projection of events into the DB (`projector.ts`, `message-updater.ts`), the storage (`sql.ts`, `store.ts`, `info.ts`), the inbox (`inbox.ts`), the execution (`execution.ts`, `run-coordinator.ts`), the request assembly (`model-request.ts`, `model-transport.ts`, `provider-context.ts`, `affinity.ts`), the history (`history.ts`, `compaction.ts`, `instruction-state.ts`, `instruction-entry.ts`, `instructions.ts`), other (`usage.ts`, `diff.ts`, `revert.ts`, `title.ts`, `stats.ts`, `transfer.ts`, `subagent-job.ts`, `subagent-completion.ts`, `move.ts`, `generate.ts`, `system-prompt.ts`, `command.ts`, `shell.ts`, `skill.ts`, `environment.ts`, `error.ts`, `to-session-error.ts`, `schema.ts`, `event.ts`, `message.ts`).
- The general principle: `session.ts` only publishes events through the bus, and the only code that writes into the tables during the work is the projector `projector.ts`.

## Key Files

- `packages/core/src/session/session.ts` — the facade. `make()` assembles the service once in the host Scope, `forSession(id)` returns a handle with an already bound `sessionID`.
- `packages/core/src/session/projector.ts` — all the `bus.project(...)`: creation, renaming, forking, delivery of the inbox, execution terminals, rollback, token sums.
- `packages/core/src/session/message-updater.ts` — a pure function: an event plus an adapter give a new message; all the work with the DB lives in the adapter of the projector.
- `packages/core/src/session/sql.ts` — the tables `session_v2`, `session_message`, `session_pending`, `session_inbox`, `instruction_entry`, `instruction_blob`, `instruction_state`.
- `packages/core/src/session/store.ts` — reading of sessions and messages plus the "claim" of the execution (`claim`, `release`, `releaseChildClaims`, `countResume`, `listSuspended`).
- `packages/core/src/session/inbox.ts` — admission of the input, the `steer`/`queue` switch, selection of the promotable, projections of the rows.
- `packages/core/src/session/execution.ts` — the routing by `Session ID` into the runner of the chosen Location and the terminal events.
- `packages/core/src/session/run-coordinator.ts` — one fiber per "busy period", the doorbell `pendingWake`.
- `packages/core/src/session/execution/restart.ts` — the recovery of sessions with an unreleased claim after a crash or a restart.
- `packages/core/src/session/runner/llm.ts` — the `drain` loop: input → context → step → step; the exit `Complete`/`Moved`/`Reloaded`.
- `packages/core/src/session/runner/step.ts` — one attempt of a step: the provider stream, the tools, the calculation of the errors and the `Outcome` result.
- `packages/core/src/session/runner/publish-llm-event.ts` — the translation of provider events into session events with batching of deltas.
- `packages/core/src/session/model-request.ts` — the request assembly, the response limit, the media filters, the plugin hooks, the HTTP and WebSocket wrappers.
- `packages/core/src/session/compaction.ts` — compaction of the history: a local summary or the native window of the provider.
- `packages/core/src/session/history.ts` — which messages get into the request and with which lower bound.

## Important Details

- `Session.prompt`, `synthetic`, `compact`, `skill`, `steerInbox` by default wake the session (`execution.wake`); it is switched off by the flag `resume: false`. The admission of the input goes under `SessionInbox.serialized`, the preparation of the prompt — outside the lock, under the mask `uninterruptibleMask`.
- The declared rollback is committed only after the successful preparation of a new input and before its admission (`SessionRevert.commit` inside `Session.prompt`).
- `Session.shell` forks the work and waits: the server itself appends the result, even if the sending client has dropped.
- The projector is the only place of writing into `session_message` during the work; the exception is the import in `transfer.ts`, which inserts the rows directly in the same transaction as the creation event.
- The claim is written in the commit hook of the `Execution.Started` event, taken off on a terminal; both hooks hold `time_updated` by assigning it to themselves, so that the record does not look like user activity.
- `time_idle` grows as `max(now, time_idle + 1)`, `time_viewed` as `max(idle, coalesce(time_viewed, idle))` — the "unread" is determined by a strict comparison of the marks.
- `run-coordinator.ts`: a `wake` on an active key does not interrupt the work, but rings the doorbell; the merged wakeups keep the widest scope ("input" is wider than "steer"). A stopped execution refuses new participants and passes them to its successor.
- `inbox.ts`: the table stores only the undelivered; a repeat of the same `id` in the same session and type is idempotent, a mismatch gives `LifecycleConflict`. The projectors report the conflict as a defect, and the publications turn it into an error via `catchDefect`.
- `promote` first takes the steer rows, moves compaction forward but does not cross `move`; in the "input" scope one queue is allowed.
- `history.ts` sets the lower bound by the type `Boundary`: `latest` (any completed), `local` (only local summaries) or `Provenance` (the native window that the target model is able to replay).
- `compaction.ts`: after a refusal "too long" the targets are reduced to 70%, 50% and 35% of the first rejected estimate; the ceiling of the request is the window minus 10%, but not less than 16 000 tokens. The expense is published per model call, therefore an interrupted compaction is also billed.
- `provider-context.ts`: the identity of the deployment is a sha256 from the base URL, the path and the sorted query parameters; the comparison is strictly by value. Old version 1 with the fields `mediaType`/`data` is brought to the `media.source` form on read.
- `model-request.ts` cuts the output to the remainder of the window with a 15% margin for the text estimate; the pictures in total over 25 MiB are replaced with a text stub up to 15 MiB, the media of unsupported types is replaced with a text error for the model.
- A hook can rename a tool, therefore the actual tool is looked for by the identity of the definition object, and not by the name.
- `runner/publish-llm-event.ts` batches the deltas by 100 ms, but publishes the beginnings of the blocks right away: the order of the events matches the order of the model. A late `tool-result` with an error is considered a harmless lag, a late success — a double execution and brings down the fiber.
- `stats.ts` counts 31-day windows strictly sequentially; the compaction expense is taken from the events table and not from the messages, therefore it does not depend on the lower bound of the history.
- `transfer.ts` under `sanitize` replaces the content with marks of the form `[redacted:kind:id]`, and zeroes the attachment data; an import with an already existing `id` gives `ImportConflictError`.
- `diff.ts` looks for the turn boundaries by the `idle` messages; in a session without such markers the turn ends at the next user message, and a range crossing a change of Location is rejected.

## Connections

- `packages/schema/src/session.ts`, `session-message.ts`, `session-event.ts`, `session-inbox.ts`, `session-revert.ts`, `session-provider-context.ts`, `session-stats.ts` — the sources of all the types and events.
- `packages/core/src/bus.ts` — the bus: `publish` with commit hooks and `project`; every write goes exactly through it.
- `packages/core/src/database/database.ts` and `packages/core/src/project/sql.ts` — the connection and the cascade over the tables.
- `packages/core/src/job.ts` — background commands and subagents, whose notifications are recovered in `execution/restart.ts`.
- `packages/core/src/location-service-map.ts`, `location.ts`, `snapshot.ts`, `vcs/patch.ts` — the change of Location, the snapshots and the diffs.
- `packages/core/src/tool.ts`, `tool-output.ts`, `permission.ts`, `question.ts` — the execution of the tools and their budgets.
- `packages/core/src/model-resolver.ts`, `packages/ai` — the choice of the model, the stream, the errors and `isRetryable`.
- `packages/core/src/instructions/index.ts` — the assembly of instructions and their epochs.
- `packages/core/src/plugin/hooks.ts` — the hooks `prompt`, `context`, `compaction`, `title`, `model.request`, `http.*`, `retry`, WebSocket frames.

## Pitfalls

- `Session.prompt` returns the already admitted item, and not a new message: the message appears only at the delivery (`InboxDelivered`) during the drain.
- `store.list` and `store.messages` with `anchor`/`cursor` with the direction `previous` change the sorting to the opposite and reverse the selection — the order of the output is "human", and not the order of the database.
- `SessionStore.claim` does not move `time_updated`, therefore the activity counter and the session list do not react to the start of a turn.
- `execution.ts` on an interruption with the reason `shutdown` deliberately keeps the claim: the next load will continue the turn. Any other terminal takes it off.
- `SessionExecution.noopLayer` is a stub without execution: the caller gets empty `wake`/`resume`, and there will be no silent refusals.
- `run-coordinator.ts` does not start the work one tick later than the wakeup: the progress is visible by the events or by `run`, and not by the `wake` itself.
- `session.ts` ends with a constant of the preview limit repeating the limit of the shell tool: when editing one side it is easy to forget the other.
- `inbox.ts` holds its own locks (`KeyedMutex`); `move.ts` checks the availability of the source outside the lock deliberately, so that the cancellation of the move stays possible during the initialization.
- `history.ts` looks for the native window with a `json_extract` query on `$.providerContext.provenance.*`, therefore the composition of the provenance fields affects which messages get into the request.
- `runner/to-llm-message.ts` replays the provider state only for the same model; after a change of model the text and the reasonings survive as ordinary text, and the reasonings with an error turn into text.
- `model-transport.ts`: five lost exchanges in a row or one refusal 1009 ("request too large") leave the session on HTTP forever until a restart or a move.
- `prompt.ts` rejects an attachment over 20 MiB and a data-URL with non-canonical base64; in the error messages the attachment is named by its mark, and not by the bytes themselves.
- `instructions.ts` keeps the deduplication by the synthetic messages with `metadata.instruction.paths`: the paths that fell out of the visible history (compaction, rollback) will be introduced anew.