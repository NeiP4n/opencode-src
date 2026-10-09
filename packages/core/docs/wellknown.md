# core/wellknown — an internal plugin turning the manifests of known integrations into methods and a name in the UI

## What's In This Folder

- `plugin.ts` — one plugin `opencode.wellknown`, which reads the well-known service entries and registers for each integration with an auth block a name by the host name and a login command.

## Key Files

- `packages/core/src/wellknown/plugin.ts` — the whole module.

## Important Details

- The declaration `export const Plugin = define({ id: "opencode.wellknown", effect: Effect.fn(...) })` uses `define` from `@opencode/plugin/effect/plugin`; the body is an Effect generator, which receives the services through `yield*`.
- First of all `wellknown.entries().pipe(Effect.orDie)` is called: a load error of the manifests turns into a defect, and not into a quiet skip of the registration. After that the data is taken from `wellknown.snapshot()`, that is, already from the cache.
- `ctx.integration.transform(...)` is the editor of the integrations; inside the loop over the snapshot the records without `entry.manifest.auth` are skipped. Each such record forcibly gets `integration.name = new URL(entry.origin).hostname` through `editor.update`, that is, the name is overwritten even if it had been set before.
- Through `editor.method.update` a method with a fixed `id: "login"`, `type: "command"`, the label `Log in` and the command copied from the manifest as an array `[...entry.manifest.auth.command]` is added — the copy is needed so that the field is not shared with the manifest data.
- The subscription to `WellKnown.Event.Updated` is done via `bus.subscribe(...)`, the body is `Stream.runForEach(() => ctx.integration.reload())`, and it is started via `Effect.forkScoped({ startImmediately: true })`. The fork is bound to the scope of the plugin: on the unloading of the plugin the subscription dies with it, without a manual cancellation.
- The file exports itself as a namespace by the line above the imports: `export * as WellKnownPlugin from "./plugin.js"`.
- The manifest is taken from the `WellKnown` service, whose record type `Entry` contains `origin`, `integrationID` and `manifest`; the `auth` block in the manifest is an array of the command and the name of the environment variable.

## Connections

- `packages/core/src/wellknown.ts` — the service itself: `Service` with `entries()` and `snapshot()`, the type `Entry`, the schema `Manifest` and the event `WellKnown.Event.Updated` with the type `wellknown.updated`.
- `packages/core/src/bus.ts` — the bus, from which `Bus.Service` is taken for the subscription.
- `packages/plugin/src/effect/plugin.ts` — `define` and the type of the plugin context, in which there is `ctx.integration`.
- `packages/plugin/src/effect/integration.ts` — the contract of the integrations domain: `transform`, `reload`, the editor with `update` and `method.update`.
- `packages/core/src/plugin/internal.ts` — the list of the internal plugins, where `WellKnownPlugin.Plugin` stands next to the plugins of the tools, the config, the VCS and the models.
- `packages/core/src/integration.ts` — the implementation of the domain that this plugin writes into through the context.

## Pitfalls

- The order of the calls is mandatory: `entries()` must finish before the first access to `snapshot()`, otherwise the editor will get an empty cache. Now this is ensured by both calls standing in one generator in a row.
- `Effect.orDie` on `entries()` turns a network or a parsing error into a process defect. The plugin does not "survive" an unavailable manifest — it dies.
- The name of the integration is overwritten entirely: any name set by another plugin before will be wiped with the host name. The load order of the plugins affects the result.
- The login method is added with a fixed `id: "login"`, therefore a repeated registration for the same integration replaces the method, and not adds a second one.
- A snapshot update does not switch `transform` into a "hot" mode: `transform` is called once at startup, and on the event `wellknown.updated` the plugin calls `reload`, that is, a full reassembly of the domain. The interval between the event and the ready state is the moment when the integration is not yet in the list.
- `forEach` over the snapshot is synchronous, but the `forEach` itself is inside an Effect context: an exception from `new URL(entry.origin)` will go into a defect, since there is no local handling.