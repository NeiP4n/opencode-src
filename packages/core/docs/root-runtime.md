# core/src — event bus, RPC, state, jobs and the root services of the core

## Purpose

The working layer of the core: how events are published and replayed, how the local state is built from them, how the external calls come into the services and go back, what keeps the registry of tools alive and how their output is truncated. Separately four small things without a slot: the MIME by the byte signature, the schema re-exports, the subscriber to the bus and the console policies.

## What's In This Folder

Fourteen files of the root `src`. The cross-cutting services: `bus`, `rpc`, `state`, `job`, `session`,
`tool`, `tool-output`, `command`, `form`, `instance`. The small ones: `event-logger`, `mime`,
`schema`, `managed-policy`. All the services are on Effect: `Context.Service` + `Layer` + a node
`makeLocationNode`/`makeGlobalNode` with explicit dependencies.

## Key Files

- `bus.ts` — the event bus. Three `PubSub`: `live` (unbounded), `durable` (a map of aggregate →
  a set of `sliding(1)` bell ringers), `typed` (a map of type → unbounded). A durable event goes
  under the `KeyedMutex` of the aggregate in one transaction (`behavior: "immediate"`, without
  interruption): the last `seq`, the projectors, the `commit` hook, the update of `EventSequenceTable` via
  `max(seq, …)` and at `persist` the write into `EventTable`. `prepareRoutes` hands over a closure,
  applied only after the commit. `log()` at `follow: true` subscribes BEFORE the reading of the
  history, takes `latestSequence`, hands over `log.synced` and goes into the live mode. There are
  `replay`, `remove`, `claim` and the obsolete `listen`.
- `rpc.ts` — the calls by a schema. `register` puts `{definition, handlers}` into an array under
  `rpcID` and returns `{dispose, events.emit}`; `call` takes the last registration
  (`at(-1)`) and passes the input and the output through `parse`/`encode`. The errors are encoded as
  `{type, message, data?}`: `rpc.unavailable`, `rpc.method_not_found`,
  `rpc.invalid_input`, `rpc.invalid_output`, `rpc.internal`. `close` is an `Effect` value, and not a
  function; the calls race with `Deferred.await(closed)` through `raceFirst`, so that a long
  RPC releases the location. The schemas understand the Effect schemas, the Standard SchemaV1 (the key
  `~standard`) and the JSON Schema (the codec is cached in a `WeakMap`).
- `state.ts` — a replayable state. `create({initial, editor, notify})` holds a set
  of transform callbacks; `get()` rebuilds the value only at `dirty`, creates
  a new object every time and never touches the previous ones. The edits go through `transform`, which
  is hooked by the `Scope` finalizer. `batch()` accumulates the notifications and sends one at the end,
  `shutdown()` closes the changed states forever. `group(report)` detaches the State from the
  identity of a plugin: an exception inside the transform switches the whole group off and calls `report`;
  the ungrouped exceptions are passed through. There are also `invalidate()`, `revision()`, `inherit()`
  and `reconcile`.
- `job.ts` — the registry of the works. A work gets `Scope.fork(state.scope, "parallel")`,
  a `Deferred` of the completion `done`, a separate `Deferred` of the background transfer `backgrounded` and
  a counter `blockingSessions` with a reference count by sessions. `start` does not restart the running
  work. `block` races `done` and `backgrounded`; `backgroundAll` takes only the works
  blocking the given session. The recoverable works (`recovery`: `shell` or
  `subagent`) are written into the `KV` under the prefix `job.background/` and live until
  `completeBackground(notificationID)`. The history of the consumed works without a `notificationID`
  is limited to 25 records.
- `session.ts` — the service of the sessions. `CreateInput` is a union: either `location`, or `parentID`, but not
  both; the absence of both gives `Effect.die`, a repeated `create` with the same id returns the already
  recorded session. `fork` takes the last message by the descending `seq` and inherits
  the `InstructionState` and the `InstructionEntry` of the parent in one transaction — the newest values, and
  not the ones that were in force at the boundary. The rest is delegated per object:
  `sessions.forSession(id).*` — `prompt`, `shell`, `skill`, `synthetic`, `compact`, `wait`,
  `resume`, `interrupt`, `revert`, `inbox`. The node is global, sixteen dependencies.
- `tool.ts` — the registry of the tools. The registration checks the segments of the namespace, the name
  `/^[A-Za-z0-9_-]{1,128}$/`, forbids `execute` at `codemode: false` and assembles
  the `ToolDefinition`; an error is not thrown, but accumulates in `Data.errors` and goes into the log.
  `snapshot(permissions)` cuts off the actions completely forbidden by the rules, splits
  the tools into the direct ones and the code-mode ones and returns the `definitions` along with the `execute`. That one calls
  the hooks `tool.execute.before` and `tool.execute.after`. The pictures pass `normalizeImages`:
  the unreadable ones are replaced with a string with the number of the skipped files.
- `tool-output.ts` — the truncation of the output. The limits `MAX_LINES = 2_000` and `MAX_BYTES = 50 * 1024`,
  the full text is stored for 7 days in the `tool-output` subdirectory of the global data. `truncate` is
  a no-op if `metadata.truncated` is already set; otherwise it glues the text parts, writes the FULL
  text into a file `Identifier.ascending("tool")` and inserts a marker of the form `lines 1-N of M`.
  The items of the type `file` are never truncated. The cleanup is once an hour by a separate global node.
- `command.ts` — the named commands. The key of the registry is `definition.name`, therefore a repeated
  registration with the same name replaces the previous one; `Command.Event.Updated` is published,
  an unknown name gives `Command.NotFoundError`, an execution error is logged and
  wrapped into `Command.ExecutionError`.
- `form.ts` — the forms for the questions to the user. They live in a `Cache` with an infinite TTL while
  the status is `pending`, and with a retention of 10 minutes after it. `create` and `reply` are uninterruptible; `ask`
  waits for a `Deferred` under the mask and on an interruption cancels the form. `validateFields` requires
  at least one field, unique keys and `when` conditions, referring only to the earlier
  fields, with a value type matching the type of the target field. `close` cancels all the hanging
  forms and is hooked as a finalizer of the layer.
- `instance.ts` — the assembly of the graph of a location. The array `nodes` enumerates 53 nodes with the services
  of the location; `Services` and `Error` are derived from `LayerNode.group(nodes)`.
  `Options.discovery: false` substitutes `Config` and `InstructionDiscovery` with the non-scanning ones
  (`{project: false, global: false}`), but does NOT disable the mixing in of the nested `AGENTS.md`
  on a file read. The order of the substitutions: the vanilla values, the substitutions of the caller, then
  the bindings of the location and the list of the plugins. The global nodes are shared between the instances via
  `shared: Node.tags.values.global`.
- `event-logger.ts` — the subscriber to the bus. Through the obsolete `listen` it logs into
  `Effect.logInfo` only five types: `agent.updated`, `provider.updated`, `model.updated`,
  `command.updated`, `config.updated`. The finalizer removes the subscription.
- `mime.ts` — the determination of the type by the signature: PNG, JPEG, GIF, BMP, PDF, WEBP (`RIFF` +
  `WEBP` at an offset of 8) and AVIF (`ftyp` at an offset of 4 plus `avif`/`avis` at an offset of 8).
  Then `text/plain`, if the bytes look like text, otherwise `application/octet-stream`. Text is
  considered to be a non-empty buffer without null bytes, a strict UTF-8 decoding and at most 30%
  of the control bytes.
- `schema.ts` — the re-export of `AbsolutePath`, `DateTimeUtcFromMillis`, `NonNegativeInt`,
  `optional`, `PositiveInt`, `RelativePath`, `statics` and the type `DeepMutable`; there is no code.
- `managed-policy.ts` — the policies of the connected OpenCode console: an array of `ConfigPolicy.Info`
  and an optional organization name. `current()` is synchronous deliberately — the catalog
  conversions read the statements during the work; `set()` replaces the state entirely, and
  the statements from different connections are not merged. The node is global, without dependencies.

## Important Details

- The durability of an event is set by the definition of the event itself: the field `durable` with the name of the aggregate and
  a version number. The field of the aggregate must be a string, otherwise the publication dies with a defect
  `Bus.InvalidDurableEvent`.
- The violations of the invariants in `bus.ts` and `rpc.ts` are `Effect.die`, and not typed
  errors: a divergence during replay, a mismatch of the owner, a wrong sequence and
  an undeclared RPC error type do not get into the error channel.
- `bus.ts` imports `Location` and `SessionTable` by a deferred `import()` inside the layer:
  a static import would close the cycle `bus → location → project → bus` and fall on the bindings
  of the nodes because of the temporal dead zone.
- `tool.ts` and `command.ts` do not throw exceptions on a bad registration: a bad tool
  or command simply does not appear. The key of the registry in `tool.ts` is not `name`, but `effectiveName`,
  and `update` strictly returns the previous `name` and `namespace`.

## Connections

- `packages/core/src/event/sql.ts` and `packages/core/src/database/database.ts` — the event
  tables and the access to the database for `bus.ts`.
- `packages/core/src/session/store.ts` — `ListInput` and the history of the messages for `session.ts`;
  `packages/core/src/session/diff.ts` and `packages/core/src/location-service-map.ts` — the diff of a turn.
- `packages/core/src/session/execution.ts`, `packages/core/src/session/model-transport.ts` and
  `packages/core/src/session/projector.ts` are attached to `session.ts` as nodes;
  `packages/core/src/kv.ts` — both to it and to `job.ts`.
- `packages/core/src/file-retention.ts`, `packages/core/src/id/id.ts` and
  `packages/core/src/tool/runtime.ts` — the dependencies of `tool-output.ts` and `tool.ts`;
  `packages/core/src/plugin/hooks.ts` and `packages/core/src/image.ts` — the hooks and the pictures.
- `instance.ts` enumerates `Command`, `Rpc`, `Tool`, `ToolOutput`, `Form` and `Session` among
  the other nodes, assembling them into one graph of the location; `event-logger.ts` depends only on the bus.

## Pitfalls

- `bus.ts` by default does not store the payloads (`persist: false`): the sequences grow,
  and the historical reading of `log` will not return anything.
- `log()` in `bus.ts` skips the types that are not in the manifest of the durable events, and
  moves the cursor by the raw last `seq` — the number of `log.synced` can be greater than the last one.
- The order of applying the routes is tied to the commit of the transaction: a failed transaction
  of the transfer of a session will not redirect the events toward a non-existent place.
- `DeepMutable` in `schema.ts` is a local substitute: the branch of an object is limited by
  `extends object`, otherwise `unknown` collapses into `{}`; the primitives are checked first.
- `call` in `rpc.ts` takes the last registration: a repeated registration overrides the previous one.
- `tool-output.ts` writes the full output to the disk BEFORE the truncation and independently of how many lines
  fit: the file appears even at the marker `0 lines`.
- `form.ts` considers the condition false for both operators if the dependent field was not answered;
  together with the prohibition to answer a hidden field this cascades into zeroing all the references to it.
- `form.ts` publishes the answer event before the update of the state and before the completion of the waiting
  `Deferred`: the subscriber to `Form.Event.Replied` will not yet see `answered` in the cache.
- `job.ts` does not remove the completed recovered work from memory: the record in the `KV` is removed
  only via `completeBackground` by `notificationID`.