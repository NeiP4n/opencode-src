# core/instance — the interface of per-session service substitution

## What's In This Folder

- `service.ts` — the only file: the `Instance` service contract and its node in the layer graph.
- The folder contains no implementation: it declares what must happen when code needs the services of a specific session.
- The real graph assembly is in the root `packages/core/src/instance.ts`, which this file re-exports.

## Key Files

- `packages/core/src/instance/service.ts` — `Interface`, `Service`, `node`.
- `packages/core/src/instance.ts` — the root: the `Services` type and the construction of the core layer graph.

## Important Details

- `Interface.provide(session)` — a higher-order method: it takes a session and returns a function that wraps any Effect, removing `Services` from its requirements. In other words the services that depend on the session's location are obtained by one substitution, not by passing arguments.
- The only method of the contract is `provide`. All other behavior (caching, layer lifetime) is declared as belonging to the implementations, not to the service.
- `Service` — `Context.Service<Service, Interface>` with the tag `"@opencode/Instance"`. This is an Effect-empty tag, not an implementation: the layer is substituted from outside.
- `node = LayerNode.unbound(Service, Node.tags.values.global)` — a node without implementation and without dependencies, marked as global. The real layer is substituted by a replacement in `packages/core/src/effect/app-node-builder.ts`.
- The module re-exports the `Services` type from `../instance.js`, so a single import from the folder is enough for the consumers.

## Connections

- `packages/core/src/effect/app-node-builder.ts` — substitutes the implementation: `build()` replaces `Instance.node` with a layer that takes `LocationServiceMap.Service` and gives `Effect.provide(locations.get(session.location))`. This is the only place where `provide` is implemented.
- `packages/core/src/location-service-map.ts` and `packages/core/src/location-services.ts` — the source of the set of services per location.
- `packages/core/src/session.ts` — a session has the field `location`, by which `provide` chooses the set of services.
- `packages/util/src/effect/app-node.ts` — `Node`, `makeGlobalNode`, the node constructors by which the `deps` dependencies are marked.
- `packages/core/docs/effect.md` — the neighboring folder with the layers and the graph assembly.

## Pitfalls

- The node is declared `unbound`: if you forget the substitution in `app-node-builder.ts`, the error will not be "service not found" at startup, but a break of Effect requirements at an arbitrary place of use.
- `provide` depends on `session.location`. A session without a correct location will not substitute services, and the place of failure will be far from the place where the session was created.
- The `Services` type arrives here by re-export: an edit of the root `instance.ts` changes the requirements of all core effects at once.
- The contract deliberately promises neither caching nor lifetime. Any implementation that considers layers eternal must take this on explicitly — otherwise per-location services start leaking.