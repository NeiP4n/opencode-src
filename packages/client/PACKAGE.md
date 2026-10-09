# @opencode/client — HTTP API client in three variants

## What This Is

A thin transport to the opencode server: 30 files, ~16.7k lines in `src/`.
The package contains no core logic — only calls to the endpoints described in
`protocol`, in three flavours: promise-based, Effect-based and for Solid.

Most of the lines are generated code in the `generated/` directories: hand
edits do not go there.

## Layers and Dependencies

Layer **L2**: depends on `protocol` and `schema` (and through them on
`plugin`, `ai`).

Who depends on it: `app`, `cli`, `core`, `desktop`, `enterprise`,
`gui-extensions`, `plugin`, `sdk`, `session-ui`, `tui`, `client` itself
(internal imports) and `protocol` (types).

Export map (`packages/client/package.json`):

```json
".": "./src/promise/index.ts",
"./promise": "./src/promise/index.ts",
"./service": "./src/promise/service.ts",
"./solid": "./src/solid/index.ts",
"./effect": "./src/effect/index.ts",
"./effect/service": "./src/effect/service.ts"
```

## Subsystems and Files

**Contract** — `packages/client/src/contract.ts`: a single re-export line for
`ClientApi`, `groupNames`, `effectOmitEndpoints`, `promiseOmitEndpoints` from
`@opencode/protocol/client`. It is a bridge to `protocol`, not a model of its
own.

**Promise variant** — the `packages/client/src/promise/` directory:
`client.ts` (implementation), `api.ts`, `rpc.ts`, `service.ts`, `index.ts` and
`generated/` (`client.ts`, `client-error.ts`, `types.ts`, `index.ts`).

**Effect variant** — the `packages/client/src/effect/` directory: the same
files (`client.ts`, `api.ts` + `api/api.ts`, `rpc.ts`, `service.ts`,
`index.ts`, `generated/client.ts`, `generated/client-error.ts`).

**Solid variant** — the `packages/client/src/solid/` directory: `data.ts`
(reactive data), `connection.ts` (connection state), `pty.ts` (terminal),
`index.ts`.

**Service** — `packages/client/src/service.ts`, `service-contender.ts`,
`service-timing.ts`, `service-version.ts` (versioning and service selection),
`shared-events.ts` (shared events), `rpc-runtime.ts` (RPC runtime),
`pty-handoff.ts` (handing a PTY between processes).

## Entry Points

1. `packages/client/package.json` → `"."` (the same as `./promise`) — the
   default path, the promise client.
2. `packages/client/src/promise/index.ts` → `ClientApi` — the list of all
   methods.
3. `packages/client/src/effect/index.ts` — the Effect variant for code on
   `effect`.
4. `packages/client/src/solid/index.ts` — reactive subscriptions for the UI.
5. `packages/client/script/build.ts` — building the generated files
   (`bun run generate`).

## Where to Look Next

- `packages/protocol/PACKAGE.md` — the contract the client is assembled from.
- `packages/httpapi-codegen/PACKAGE.md` — the `generated/` generator.
- `packages/server/PACKAGE.md` — the same API on the server side.
- `packages/cli/src/services/server-connection.ts` — connecting to a foreign
  server.

## Pitfalls

1. **Generated directories are not edited.** Repository rule: after changing
   `HttpApi`, run `bun run generate` from `packages/client`; files in
   `generated/` are overwritten.
2. **Three variants — one API, but different return types.** `promise`
   returns a `Promise`, `effect` — `Effect`, `solid` — a reactive signal.
   Moving code between them is not trivial.
3. **`"."` and `"./promise"` are the same file.** Importing
   `@opencode/client` and `@opencode/client/promise` makes no difference;
   confusion arises when Effect is expected and a promise is received.
4. **`contract.ts` is not a client** — it is a re-export of types from
   `protocol`; it has no call methods.
5. **`service-version.ts` compares the service version.** Connecting a client
   to a server of another version may be rejected — look in
   `service-contender.ts`.
