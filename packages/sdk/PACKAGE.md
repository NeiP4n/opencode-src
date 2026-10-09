# @opencode/sdk — programmatic access to opencode

## What This Is

A small SDK: 15 files, ~647 lines in `src/`. It lets external code connect to a
running opencode — create sessions, call tools, watch events — without dealing
with the HTTP contract.

The package has two styles (promise and Effect) and support for Cloudflare
Workers (workerd).

## Layers and Dependencies

Layer **L6 — surface**: depends on `client`, `core`, `plugin`,
`schema`, `server`, `util`.

Who depends on it: `core` (tests/SDK plugins), `plugin`, `session-ui`,
`sdk` itself.

Exports (`packages/sdk/package.json`):

```json
".": "./src/index.ts",
"./effect": "./src/effect/index.ts",
"./workerd": "./src/workerd.ts",
"./workerd/effect": "./src/effect/workerd.ts"
```

## Subsystems and Files

**opencode client** — `packages/sdk/src/opencode.ts` (the main class),
`packages/sdk/src/promise.ts` (promise wrapper),
`packages/sdk/src/index.ts` (root export).

**Effect variant** — the `packages/sdk/src/effect/` directory: `index.ts`,
`opencode.ts`, `tool.ts`, `workerd.ts`.

**Tools** — `packages/sdk/src/tool.ts` — tool declaration
for external use.

**Internal** — the `packages/sdk/src/internal/` directory: `fetch.ts`
(HTTP transport), `host.ts` (host), `instances.ts` (instances),
`workerd.ts` (the workers variant).

**Contracts and logging** — `packages/sdk/src/contracts.ts`
(the types the SDK exposes outward) and `packages/sdk/src/logging.ts`.

**Workerd** — `packages/sdk/src/workerd.ts` (the `./workerd` export) —
the same SDK under Cloudflare Workers.

## Entry Points

1. `packages/sdk/src/index.ts` — root export, promise SDK.
2. `packages/sdk/src/effect/index.ts` (the `./effect` export) — the SDK built
   on `effect`.
3. `packages/sdk/src/opencode.ts` — the class itself, if you need access
   without the wrapper.
4. `packages/sdk/src/workerd.ts` — the workers variant.

## Where to Look Next

- `packages/client/PACKAGE.md` — the transport the SDK uses.
- `packages/server/PACKAGE.md` — the server it connects to.
- `packages/plugin/PACKAGE.md` — how plugins declare tools
  (the parallel path to `tool.ts`).
- `packages/cli/PACKAGE.md` — the commands that run what the SDK connects to.

## Pitfalls

1. **The four entry points are not the same thing.** `"."` and `"./effect"` are
   different styles, `"./workerd"` is a different runtime; a wrong combination
   produces type errors rather than a runtime failure.
2. **The SDK connects to an already running opencode.** On its own it does not
   start a server — you need a running `serve` or service.
3. **`internal/` is not published as API** — importing
   `@opencode/sdk/internal/*` technically works, but stability is not
   promised.
4. **`contracts.ts` is not `protocol`.** It is a slice of the SDK types, not
   the full HTTP contract; the absence of a method in `contracts.ts` does not
   mean it is absent on the server.
