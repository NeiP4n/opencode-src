# core/effect — layer graph assembly: per-location service substitution and platform implementations

## What's In This Folder

- `app-node-builder.ts` — the function `build`: turns a node graph into a ready `Layer`, substituting the `Instance` node and the per-location service map.
- `app-node-platform.ts` — ready platform nodes: the HTTP request executor, the LLM client and the WebSocket constructor.
- `websocket-constructor.ts` — an implementation of the WebSocket constructor taking proxy and environment variables into account.
- `keyed-mutex.ts` — per-key locks: one queue per key, independent keys run in parallel.
- All files are dependency injection assembly points. There is no core business logic here.

## Key Files

- `packages/core/src/effect/app-node-builder.ts` — `build`, the private node `instances`.
- `packages/core/src/effect/app-node-platform.ts` — `requestExecutor`, `llmClient`, `webSocketConstructor`.
- `packages/core/src/effect/keyed-mutex.ts` — `makeUnsafe`, `make`, `KeyedMutex`.
- `packages/core/src/effect/websocket-constructor.ts` — `WebSocketConstructor` with the fields `layer` and `proxy`.

## Important Details

- `build(root, replacements)` forms two substitutions: its own implementation of `Instance.Service` and the replacements passed by the caller. Its own implementation is lifted from `LocationServiceMap.Service` and gives `Effect.provide(locations.get(session.location))` — exactly the substitution declared by the contract in `packages/core/src/instance/service.ts`.
- The replacements are applied twice and in different ways: `LocationServiceMap.node.replace(buildLocationServiceMap(bindings))` collects the service map with the replacements, and `Instance.node.replace(instances)` is the instance node itself. Skipping either of the two substitutions leaves an unbound node in the graph.
- The replacements go into a single `bindings` array, which is at the same time the list for the service map and the set of substitutions of the `Instance` itself. The saving is that services replaced from outside are visible both in the location map and in the instance.
- `app-node-platform.ts` declares three nodes with explicit dependencies: `requestExecutor` requires `httpClient` from `@opencode/util/effect/app-node-platform`, `llmClient` requires `requestExecutor`, `webSocketConstructor` requires nothing.
- The WebSocket constructor chooses the implementation by the presence of the global `Bun`. In Bun it uses `globalThis.WebSocket` with the fields `headers`, `protocols` and an optional `proxy`. In Node — `NodeWS.WebSocket` from `@effect/platform-node/NodeSocket` with a proxy agent and `followRedirects: false`. Disabling redirects is explained by a comment: otherwise headers can cross the origin boundary, and the caller safely falls back to HTTP.
- The proxy choice takes into account `WS_PROXY`/`WSS_PROXY`, then `HTTP_PROXY`/`HTTPS_PROXY`, then `ALL_PROXY`. The variable name is looked up first as is, then in lower case — on Windows this matters.
- `NO_PROXY` is parsed by hand: a list separated by spaces and commas, `*` means "everything", a `host:port` record is compared with the port, and a leading dot in the name means a suffix match. A separate case: `127.0.0.1`, `localhost` and `::1` are always proxied, regardless of `NO_PROXY`.
- The proxy agent is chosen by the scheme: `wss:` or a proxy with `https:` give `HttpsProxyAgent`, otherwise `HttpProxyAgent`. This is an important difference from most clients, where `wss` by itself does not require an HTTPS proxy, but here the decision is made by both signs.
- In Bun the trust is left in the runtime store, so that `NODE_EXTRA_CA_CERTS` keeps working as an addition. The same is recorded in a comment.
- `constructorOptions` brings the Effect input that arrives as a browser-like object down to `{ headers, protocols }`. A string and an array of strings are treated as a protocol list, everything else as handshake options.
- `WebSocketConstructor.proxy` is moved out along with the layer: the proxy selection rules can be tested without starting a socket.
- `KeyedMutex.makeUnsafe` holds a `Map` of the form key → `{ semaphore, users }`. The `users` counter grows on every entry into `withLock` and drops in `Effect.ensuring`, so a record is removed from the map only when neither owners nor waiters are left. That is the protection against a waiter using an already removed record.
- The body of the critical section is always wrapped in `semaphore.withPermit(effect)`, that is, the lock covers both success and failure. The lock is released in `ensuring`, not in the success path.
- `size` gives `Effect.sync(() => locks.size)` — a synchronous snapshot, which by itself does not guarantee that the next operation will see exactly as many records.
- At the top of `websocket-constructor.ts` the reason for the narrow implementation is recorded: the platform barrel still exports Redis with an optional native hash loader that workerd cannot parse. Therefore this file imports `@effect/platform-node/NodeSocket` directly.

## Connections

- `packages/core/src/instance/service.ts` — the contract that `app-node-builder.ts` implements.
- `packages/core/src/location-service-map.ts` and `packages/core/src/location-services.ts` — the per-location service map from which `build` assembles the substitution.
- `packages/util/src/effect/app-node.ts` and `packages/util/src/effect/layer-node.ts` — the constructors `makeGlobalNode`, `LayerNode.unbound`, `LayerNode.compile`, `LayerNode.replace` and `Node.tags`, on which the whole folder stands.
- `packages/util/src/effect/app-node-platform.ts` — the source of `httpClient`, on which `requestExecutor` depends.
- `packages/core/src/effect/keyed-mutex.ts` — the consumers were found by searching for `KeyedMutex`: `packages/core/src/bus.ts`, `packages/core/src/file-mutation.ts`, `packages/core/src/git.ts`, `packages/core/src/mcp/index.ts`, `packages/core/src/plugin/update.ts`, `packages/core/src/session/inbox.ts`, `packages/core/src/workspace.ts`. In other words a per-key lock is needed everywhere where two threads may edit the same resource.
- `packages/ai/src/route` — the source of `LLMClient` and `RequestExecutor`, which are declared as nodes in `app-node-platform.ts`.
- `effect/unstable/socket` — the type `Socket.WebSocketConstructor` that the layer implements.
- `packages/core/docs/instance.md` — the document about the contract implemented here.

## Pitfalls

- `build` requires substituting both `Instance` and the service map. Replacing only one of them gives a graph that compiles and fails at the first `provide` in the middle of the work.
- On Bun the path through `globalThis.WebSocket` is extended with a `proxy` field, which the standard type does not have. In the code this is a type check suppression with an explanation in a comment; the comment and the suppression must not be removed while the code reaches for a non-standard field.
- In Node redirects are disabled. A client that relied on automatic redirect following will get a response with a redirect code and must handle it itself — with a safe fallback to HTTP.
- `NO_PROXY` is parsed by hand and does not understand records with CIDR or without a leading dot. A domain the user wrote as `example.com` will match only that domain, not the subdomains: for subdomains a leading dot is needed.
- `KeyedMutex` removes a record when the `users` counter drops to zero. Between the removal and the next entry the map will create a semaphore again, so two consecutive critical sections on one key are not guaranteed to land in one queue — this is not a transaction-level lock.
- `makeUnsafe` has no lifetime scope: the locks live as long as the object lives. Creating it per request is not allowed, otherwise serialization stops working.