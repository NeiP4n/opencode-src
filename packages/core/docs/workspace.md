# core/workspace — binding of the workspaces to the resources of the external providers

## What's In This Folder

- `sql.ts` — the `workspace` table with the provider, the opaque binding and the time of the last use.
- `driver.ts` — the contract of a provider driver and the registry of the drivers: creation of a resource, connecting to it, suspending and deleting.
- There are no driver implementations in the folder: it declares what the external code is obliged to do.

## Key Files

- `packages/core/src/workspace/driver.ts` — `Binding`, the errors `Error` and `ProviderNotFound`, the `Interface`, `Registry`, `registryNode`, `node`.
- `packages/core/src/workspace/sql.ts` — `WorkspaceTable`.

## Important Details

- `Binding` — `Schema.Record(Schema.String, Schema.Json)`: the minimal JSON that the provider uses to reconnect to the same resource. The core stores it opaquely and hands it back; only the owning driver reads inside it.
- Four operations of the contract:
  - `create({ workspaceID })` — create or find a resource; returns the `binding`.
  - `connect({ workspaceID, binding, saveBinding })` — return an `EnvironmentDriver.Driver` in the `Scope`.
  - `suspendForIdle({ workspaceID, binding, saveBinding })` — release the resource without deleting.
  - `destroy({ workspaceID, binding })` — delete the resource.
- The idempotency of `create` is declared mandatory, and the comment lists three reasons of a repeated call with the same ID: a retry after an error, a crash of the process between the successful creation and the saving of the binding, and a race of two processes. Hence the requirement to key the resource by `workspaceID` (a tag at the provider or a deterministic name) and to pick up the existing one instead of creating a duplicate.
- `saveBinding` is passed inside `connect` and `suspendForIdle`: the driver itself decides when a new binding must be written, and is not obliged to do it on each call.
- `destroy` accepts `binding: Binding | null`. `null` means that the binding was not saved: either the workspace was not created, or the creation broke in the middle. In that case the driver is obliged to find the resource by `workspaceID` and remove it, counting the absence as a success.
- `registry({ ... })` builds a `Registry` with the single method `get(provider)`. The provider is looked for via `Object.hasOwn`, and not via `in` or a property access: the prototype is not considered a source of drivers.
- `registryNode(drivers)` is a global node without dependencies (`deps: []`), because the registry by itself requires nothing.
- `node = registryNode({})` — the default registry is empty. Any `get` on it gives `ProviderNotFound`. That is not an error, but a connection point: the real set of drivers is added at the assembly of the application.
- `make(driver)` is an identity function for the convenience of the type inference when declaring a driver.

## Connections

- `packages/core/src/workspace.ts` — the root of the subsystem: it reads `WorkspaceTable` and uses `KeyedMutex` from `packages/core/src/effect/keyed-mutex.ts` to serialize the work on one workspace.
- `packages/core/src/environment/driver.ts` — the source of the type `EnvironmentDriver.Driver` that `connect` returns.
- `packages/schema/src/workspace.ts` — the source of `Workspace.ID`, by which the column `id` and all the parameters of the contract are typed.
- `packages/util/src/effect/app-node.ts` — `makeGlobalNode`, from which `registryNode` is built.
- `packages/core/src/effect/keyed-mutex.ts` — a primitive that is similar in meaning: the per-key locks.

## Pitfalls

- The idempotency of `create` is a requirement to the driver, and not something ensured by the core. A driver that creates a resource anew on each call will leave an orphan behind on a retry: `destroy` will get a `binding` of an already different session.
- `Binding` is a `Record` of string keys in JSON, therefore the provider cannot put an array or a nested schema of an arbitrary shape there without an agreement: the core will check only that it is a JSON object.
- `node` is empty by default, and this state looks working until the first access: the error will appear as `ProviderNotFound` at the moment of connecting, and not at the assembly of the graph.
- `suspendForIdle` is not obliged to save anything — if the provider suspends the resource and does not connect to it again, the restoration lies on the periodicity of the last use.
- The time in the table is called `created_at`/`last_used_at`, and not `time_created`/`time_updated` as in the other tables of the package: looking here by the general rule is pointless.