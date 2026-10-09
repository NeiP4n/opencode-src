# @opencode/server — opencode HTTP server

## What This Is

The transport layer: 52 files, ~3.9 thousand lines in `src/`. The package mounts
the `protocol` contract onto Effect `HttpApiBuilder`, implements the endpoints
with handlers from `core`, and serves the event stream over SSE. There is no
business logic here — that lives in the core; here you find routes,
authorization, server options, and layer integration.

## Layers and Dependencies

Layer **L5 — transport**: depends on `core`, `protocol`, `schema`,
`simulation`, `util`.

Who depends on it: `cli` (server startup), `sdk`, `session-ui` (direct
calls), `server` itself.

Exports are named-only: `"./*": "./src/*.ts"` — there is no root.

## Subsystems and Files

**API assembly** — `packages/server/src/routes.ts`, line 176:
`HttpApiBuilder.layer(Api, ...)` mounts the contract; below it come
`Layer.provide` with authorization, error handling, and ~35 core layers.
This is the central file of the package.

**Handlers** — `packages/server/src/handlers/`, 32 files, almost 1:1 with the
`protocol` groups: `session.ts`, `message.ts`, `generate.ts`, `model.ts`,
`provider.ts`, `event.ts`, `permission.ts`, `form.ts`, `fs.ts`,
`command.ts`, `skill.ts`, `rpc.ts`, `agent.ts`, `plugin.ts`, `server.ts`,
`debug.ts`, `pty.ts`, `pty-socket.ts`, `persistent-pty.ts`, `shell.ts`,
`reference.ts`, `location.ts`, `integration.ts`, `websearch.ts`, `mcp.ts`,
`credential.ts`, `config.ts`, `vcs.ts`, `worktree.ts`, `project.ts`,
`migration.ts`, `session-error.ts`. The aggregate file is
`packages/server/src/handlers.ts`.

**Authorization** — `packages/server/src/auth.ts`: authorization, pairing,
port binding, and the server address.

**Events** — `packages/server/src/event-feed.ts` — the SSE stream through
which the UI receives updates.

**Middleware** — the `packages/server/src/middleware/` directory:
`authorization.ts`, `schema-error.ts`, `session-location.ts`,
`form-location.ts`.

**Options and environment** — `options.ts`, `cors.ts`, `fetch.ts`,
`request-tracing.ts`, `process.ts`, `pty-environment.ts`,
`server-info.ts`, `service-status.ts`, `location.ts`, `api.ts`.

**Alternative runtime** — `packages/server/src/workerd.ts` (the Cloudflare
build), the `probe:workerd` script verifies it.

## Entry Points

1. `packages/server/src/routes.ts` → the `Api` layer — mounting the whole API.
2. `packages/server/src/auth.ts` — how to gain access to the server (tokens,
   pairing).
3. `packages/server/src/event-feed.ts` — subscribing to events (SSE).
4. `packages/server/src/handlers/` — the implementation of a specific group
   of endpoints.

## Where to Look Next

- `packages/protocol/PACKAGE.md` — the contract implemented here.
- `packages/core/PACKAGE.md` — the layers provided through `Layer.provide`.
- `packages/client/PACKAGE.md` — the client-side consumer of the API.
- `packages/cli/src/services/service-config.ts` — service channels and ports.

## Pitfalls

1. **There is no root export.** An import like `@opencode/server` is
   impossible, only `@opencode/server/routes` and so on.
2. **`routes.ts` cannot be read linearly.** The handlers are declared
   separately (`handlers/`), the mounting is separate too; "there is no
   endpoint" usually means the group is not wired in `Layer.provide`.
3. **`simulation` is not a dependency for tests.** `simulationReplacements`
   are mixed into the assembly when simulation mode is enabled — through
   that path.
4. **PTY goes over a separate socket** (`handlers/pty-socket.ts`), not through
   ordinary HTTP; terminal problems are looked for there, not in `pty.ts`.
5. **`workerd.ts` is not a duplicate but a different runtime.** A change to
   `routes.ts` requires checking it too (`bun run probe:workerd`).
