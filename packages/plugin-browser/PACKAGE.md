# @opencode/plugin-browser — browser access plugin

## What This Is

The `opencode.browser` plugin: 7 files, ~1.5 thousand lines in `src/`. It gives
the model tools for working with a browser — open a page, read a file,
show a tab — and keeps a connection to the browser through a proxy and a tunnel.

The package is plugged in as a plugin (`export default Plugin.define(...)`), and
also exposes two separate modules for low-level access.

## Layers and Dependencies

Layer **L2**: depends on `plugin` (host) and `schema` (types, including
`TabID` and `Ref` — regex-validated strings).

Who plugs it in:

- `packages/core` — plugin registration in the session;
- `packages/gui-extensions` — browser tools in extensions.

Exports (`packages/plugin-browser/package.json`):

```json
".": "./src/index.ts",
"./rpc": "./src/rpc.ts",
"./proxy": "./src/proxy.ts"
```

## Subsystems and Files

**Attachment point** — `packages/plugin-browser/src/index.ts` (13 lines):
`Plugin.define({ id: "opencode.browser", effect: ... })`; inside,
`BrowserConnection.make(ctx)` opens the connection, then
`BrowserTools.register(ctx, connection)` registers the tools.

**Connection** — `packages/plugin-browser/src/connection.ts` →
`BrowserConnection.make(...)`, the `Connection` type is derived from the result
(`Effect.Success<ReturnType<typeof make>>`).

**Tools** — `packages/plugin-browser/src/tools.ts`:
`BrowserTools.register(...)` and `normalizeAction(action)` — reducing
actions to a single form.

**RPC schema** — `packages/plugin-browser/src/rpc.ts` (namespace `Browser`):
constants `MAX_FILE_BYTES` (5 MB), `TUNNEL_CHUNK_BYTES` (64 KB),
`MAX_TEXT` (100 000 characters) and the schemas `TabID`
(`/^tab_[a-f0-9-]{36}$/`), `Ref` (`/^@?e[1-9][0-9]*$/`).

**Proxy** — `packages/plugin-browser/src/proxy.ts` → `BrowserProxy.make(
transport)`: the `Transport` type, the `Proxy` type. The file comment
says outright: desktop-only, the server plugin does not load it.

**Files** — `packages/plugin-browser/src/files.ts` → `BrowserFiles.read`,
`BrowserFiles.save`, `captureName(name)`: files travel between machines
as bytes, only this endpoint interprets paths; `captureName` strips
`.`/`..` and Windows devices like `CON.txt`.

**Tunnel** — `packages/plugin-browser/src/tunnel.ts` →
`BrowserTunnel.make()`: one instance per desktop connection;
backpressure comes from sockets, not from an in-memory buffer.

## Entry Points

1. `packages/plugin-browser/src/index.ts` — `export default`, this is how the
   plugin gets into a session.
2. `packages/plugin-browser/src/rpc.ts` — protocol types and limits
   (the `./rpc` export).
3. `packages/plugin-browser/src/proxy.ts` — the proxy transport (the `./proxy`
   export), only for the desktop part.

## Where to Look Next

- `packages/plugin/PACKAGE.md` — `Plugin.define`, the context and the Effect variant.
- `packages/core/PACKAGE.md` — where the plugin is attached to the session.
- `packages/gui-extensions/PACKAGE.md` — the consumer of the tools.
- `packages/schema/PACKAGE.md` — the types used in the RPC schema.

## Pitfalls

1. **`proxy.ts` is desktop-only.** Importing it from server code will not give a
   working connection: the listener there is deliberately not loaded.
2. **The limits are declared in `rpc.ts` and are not negotiable.** A file larger
   than 5 MB or text longer than 100 000 characters is rejected at the schema level —
   the errors are looked for here, not in `files.ts`.
3. **`TabID` and `Ref` are not ordinary strings.** The schema carries a regex:
   an invalid format will not pass validation before sending; in tests this looks
   like "the string is not accepted".
4. **`files.ts` is the only place where paths are interpreted.** Files arrive
   as bytes; an attempt to handle a path on the other side gives a wrong
   result, and this is stated outright by a comment in the file.
