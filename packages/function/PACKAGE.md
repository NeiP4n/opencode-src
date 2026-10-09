# @opencode/function — server function for share and the GitHub App

## What This Is

A cloud function on Cloudflare Workers: 2 files, ~400 lines in `src/`. The
package is not part of the CLI binary and is imported by no `@opencode/*`
package — it is the backend of the opencode web part: session publishing
(share) and GitHub App token exchange.

The package is `private: true`, it is not published to npm. Dependencies:
`hono` (router), `jose` (JWT), `@octokit/rest` and `@octokit/auth-app`
(GitHub), `sst` (infrastructure environment variables).

## Layers and Dependencies

Layer **L0 — leaf**: it does not depend on other `@opencode/*` packages. It
is tied to the core only by the data format: the sessions it serves arrive
from the opencode server in the same shape.

There are no consumers in `packages/*/src` — the package is deployed
separately and talks to the client over HTTP/WebSocket.

## Subsystems and Files

**`packages/function/src/api.ts`** — all the server logic, the Hono
application (`export default new Hono<...>()`, line 117) and the Durable
Object `SyncServer`:

- `SyncServer` — the state of one published session. On connect it serves
  the stored `session/*` keys over WebSocket; the `publish(key, content)`
  method checks that the key belongs to the current session
  (`session/info/<id>`, `session/message/<id>/`, `session/part/<id>/`),
  puts the JSON into the R2 bucket (`share/<key>.json`) and into the
  object's memory, then broadcasts to all subscribers.
- `share(sessionID)` — issues the publishing secret (the first time —
  `randomUUID`, afterwards it returns the stored one); `assertSecret(secret)`
  verifies it.
- `clear()` — deletes all session messages from the bucket and the object's
  memory.
- `static shortName(id)` — the short link name.
- GitHub token exchange handlers: `POST /exchange_github_app_token`
  (from the app installation), `POST /exchange_github_app_token_with_pat`
  (for a local `opencode github run`, additionally checks the
  `admin|push|maintain` permissions of the repository),
  `GET /get_github_app_installation`
  (checks whether the app is installed).

**`packages/function/src/github.ts`** — `parseRepositoryClaim(payload)`:
extracts and validates the `repository` claim from the JWT (`jose`); without
it — an error.

## Entry Points

1. `packages/function/src/api.ts` → `export default` — the Hono router that
   deploys the Cloudflare Worker.
2. `packages/function/src/github.ts` → `parseRepositoryClaim` — the only
   function of the file, used inside `api.ts`.
3. There are no external importers in `packages/*/src`: the entry point is
   the deployment itself.

## Where to Look Next

- `packages/cli/PACKAGE.md` — the commands that call this backend
  (`opencode github run`, share links).
- `packages/core/PACKAGE.md` — the sessions and messages whose format is
  stored in the bucket.
- `packages/schema/PACKAGE.md` — the data types shared by server and
  client.

## Pitfalls

1. **`Resource.GITHUB_APP_ID` and `Resource.GITHUB_APP_PRIVATE_KEY` come
   from `sst`** — without deployed infrastructure the function fails on the
   very first call to GitHub.
2. **The private token in the `/exchange_github_app_token_with_pat`
   handler** is passed through `Authorization: Bearer <PAT>`; authorization
   errors answer with status 401, exchange errors with 502.
3. **`publish` silently drops foreign keys**, returning `400` — but only
   when the key check failed; the broadcast itself goes to all WebSocket
   subscribers of the object without a secret check at that stage.
4. **`webSocketMessage` is empty** — the client sends nothing to the object,
   the channel is one-way; input comes only through the HTTP handlers.
