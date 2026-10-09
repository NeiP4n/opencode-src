# core/pty — pseudoterminals: process types, transport helpers and one-time connection tickets

## What's In This Folder

Six files and not a single terminal-owning service: only types, three
runtime spawn adapters, a frame protocol for websockets and a service of one-time
tickets. The PTY domain service lives outside the folder and does not depend on the transport, and
the server routes translate `Pty.attach` into websockets through the helpers from here —
therefore all surfaces speak one protocol.

## Key Files

- `packages/core/src/pty/pty.ts` — pure types: `Disp` (the unsubscribe), `Exit`
  (`exitCode` and the optional `signal`), `Opts` (`name`, `cols`, `rows`, `cwd`,
  `env`), `Proc` (`pid`, `onData`, `onExit`, `write`, `resize`, `kill`).
- `packages/core/src/pty/pty.bun.ts` — the Bun adapter: `spawn` from `bun-pty`.
  On Windows through `dlopen("kernel32.dll")` it calls
  `SetConsoleCtrlHandler(null, 0)`, after which the library is closed.
- `packages/core/src/pty/pty.node.ts` — the Node adapter: the module is loaded through
  `createRequire(import.meta.url)` from the environment variable
  `OPENCODE_NODE_PTY_PATH` or from `@lydell/node-pty`.
- `packages/core/src/pty/pty.workerd.ts` — a runtime substitute: `spawn` throws
  «Pseudo-terminals are unavailable on the workerd runtime».
- `packages/core/src/pty/protocol.ts` — frame helpers: `REPLAY_CHUNK`,
  `metaFrame`, `chunks`, `decodeInput`.
- `packages/core/src/pty/ticket.ts` — the service `@opencode/PtyTicket`:
  `issue`, `consume`, `Scope`, `ConnectToken`, `make`, `node`.

## Important Details

- The outgoing frames are raw chunks of the UTF-8 terminal. Exactly one control frame:
  the byte `0x00`, then UTF-8 JSON with the absolute cursor position of the output after the replay,
  so that the client can continue from the right place.
- `REPLAY_CHUNK` = 64 KiB: a replay can be megabytes long, therefore it is cut into
  frames of a limited size by the function `chunks`.
- `decodeInput` accepts a string, a `Uint8Array` or an `ArrayBuffer`; the decoder is
  `fatal: true`, and invalid UTF-8 leads to `undefined` — the input is simply
  discarded, and no error is thrown.
- The ticket: default TTL of 60 seconds (`Duration.seconds(60)`), cache capacity
  of 10 000 records. `issue` puts `Scope` (ptyID, directory, workspaceID) into the cache under
  the key `crypto.randomUUID()` and returns `expires_in` in seconds;
  `consume` deletes the record via `Cache.invalidateWhen` and checks all three fields
  of the scope.
- The ticket cache has a `noLookup` function set, which dies with the message «PtyTicket
  cache must be used via set/invalidateWhen, never get»: a call to `get`
  is considered misuse of the interface, and not a missing key.
- In `pty.bun.ts` Ctrl+C is reset once before spawning shells: a detached
  server starts with an ignored Ctrl+C, and the ConPTY shells inherit it.
  The registered handlers are kept at the same time.
- In `pty.node.ts` `useConptyDll` is switched on only on Windows and only inside
  a single-executable application (`isSea()` from `node:sea`).
- `make(ttl)` is exported specifically for tests with a short TTL; in
  production `layer` with the default TTL is used.

## Connections

- `pty.bun.ts`, `pty.node.ts`, `pty.workerd.ts` — three variants of one module with
  the same export `spawn`; the builder chooses the variant by the suffix.
- `pty.ts` — the only source of the types: the adapters only re-export
  `Disp`, `Exit`, `Opts`, `Proc`.
- `pty/protocol.ts` is described as "Pty.attach to a websocket", that is, it is used
  by the server routes, and not by the terminal itself.
- `ticket.ts` depends on the schemas `@opencode/schema/pty-ticket`,
  `@opencode/schema/pty`, `@opencode/schema/workspace` and on
  `makeGlobalNode` — the service is global, not bound to a location.
- The shells from `pty.bun.ts`/`pty.node.ts` are the only place in the folder where
  a real OS process is needed.

## Pitfalls

- Not a single file of the folder exports a terminal service: the owner of
  `Pty.attach` has to be looked for outside `packages/core/src/pty`.
- `opts.cwd` and `opts.env` are optional in the types, but `name` is mandatory — on
  a call with an object without `name` the error will come from the native module already.
- `onData` and `onExit` return `Disp`; if the unsubscribe is lost, the listener
  will keep receiving data — storing and calling `dispose` is the duty of the caller.
- The ticket is one-time: a repeated `consume` of the same value will return false, because
  `invalidateWhen` deletes the record at the first successful withdrawal.
- `metaFrame` always puts `0x00` as the first byte — the client is obliged to distinguish the
  control frame by this byte, otherwise it will be shown as terminal text.
- On workerd any call of `spawn` is a defect, and not a supported branch:
  terminals do not work at all in this environment.