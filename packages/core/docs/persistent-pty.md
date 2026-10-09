# core/persistent-pty — terminals that survive a server restart

## What's In This Folder

Six files. The service `@opencode/PersistentPty` (`index.ts`) does not hold the terminals
in itself: it speaks over a local socket with a separate daemon process
`opencode-pty`, starts it when needed and parses the answers.
`daemon.ts` is the whole protocol and transport, the three `binary.*` decide which should
be the executable file of the daemon, `pty-binding.ts` is the binding to the daemon package.

## Key Files

- `packages/core/src/persistent-pty/index.ts` — the service and all the application logic:
  `list`, `get`, `create`, `write`, `resize`, `control`, `input`, `snapshot`,
  `read`, `remove`, `shutdown`, `handoff`, `attach`; the errors `UnavailableError`
  and `NotFoundError`; the type `Attachment`.
- `packages/core/src/persistent-pty/daemon.ts` — `makeDaemonTransport`, the type
  `DaemonTransport`, the schemas `WireTerminal` and `WireResponse`, `DaemonError`,
  the internal `openOwner`, `oneShot`, `subscribePromise`, `encode`, `decoder`.
- `packages/core/src/persistent-pty/binary.bun.ts` — installation of the daemon executable
  from a bundled asset with a checksum check.
- `packages/core/src/persistent-pty/binary.node.ts` — `resolveBinary` without
  installation: the environment variable or the name from `PATH`.
- `packages/core/src/persistent-pty/binary.workerd.ts` — a refusal: the persistent
  terminals in this runtime are unavailable.
- `packages/core/src/persistent-pty/pty-binding.ts` — the path or the asset description
  from the `@opencode-ai/pty` package.

## Important Details

- The daemon is started detached (`detached: true`, `stdio: "ignore"`) and with
  the variable `OPENCODE_PTY_RUNTIME_DIR` pointing to its working directory.
  The readiness is checked by polling `service.json` for at most 5 seconds with a step
  of 50 ms; on failure the started process is killed with `SIGTERM`.
- The protocol version is hard equal to 7. A mismatch of the version in `service.json`, as
  well as a mismatch of `instance_id`, `pid` or the protocol in the answer to `ping` —
  an error of the kind `protocol`, and not a silent connection.
- The daemon lives not in the data directory, but in a temporary one: `OPENCODE_PTY_RUNTIME_DIR`,
  otherwise `XDG_RUNTIME_DIR/opencode-pty`, otherwise a subdirectory in `os.tmpdir()` with
  the user identifier. Inside it a directory with a random UUID is added,
  so two instances do not collide.
- Every request is a separate connection to the socket and one frame, which
  is parsed and disposed. A separate persistent connection (`openOwner`)
  holds only the ownership rights of the daemon.
- Frame format: a four-byte length prefix `UInt32BE` and the payload, maximum
  8 MiB. A broken frame (an incomplete remainder at the end of the stream) is considered an error, and not
  a quiet end.
- The answers are parsed by the synchronous schema `WireResponse`. The daemon message
  «authentication failed» is treated as `registration` and leads to a retry of the
  request, everything else — as `protocol`.
- `request` can start the daemon by itself, but only if it is allowed by a flag
  (`start`), which only `create` gives: the other operations do not start a non-working
  daemon, but return an error. `requestIfRunning` on a connection
  error returns `undefined` — this is how `list` behaves and gives an empty
  list.
- The terminal identifiers on the bridge have the form `pty_persistent_<number>`;
  the reverse conversion throws on any other string.
- The bus events: `Added` after the creation, `Removed` after the removal. The removal
  of a finished terminal is done in the background and does not prevent the client from seeing
  the exit event: the repeated attempts are cut off by the `removing` set, and
  `NotFound` on removal is considered normal.
- The current visible terminal per session is stored in the `current` map. It is updated by
  the activity of the controller: `resize`, `control`, `input` and the connection with the role
  `controller`. Reading the screen and the visibility of the panel do not touch it.
- `read` without `lines` gives the daemon the right to choose a live height in the same
  snapshot. An incorrect `lines` — an `UnavailableError` with the text about a range
  from 1 to 65535. If the terminal has managed to disappear, the method gives `null`.
- Connection roles: `controller` manages the size and the input, `observer`
  only reads. In the answer there is `generation` — the screen generation number, — and
  the replay offsets: requested, available, final and the sign of a cut.
- The event stream starts lazily: `activate()` starts reading the frames,
  `detach()` disposes the socket. Neither of them is done twice.
- The binary output frame (`frame[0] === 0`) is not parsed as JSON: in it
  there are eight bytes of the start and eight bytes of the end as `BigUInt64BE`, and then raw
  data. A frame shorter than 17 bytes — a protocol error.
- Installation of the daemon under Bun: the directory with the rights `0o700`, the directory name contains
  the version and the first 16 characters of the checksum, the file is first written under
  a temporary name and renamed, the rights `0o755`. The directory is checked that
  it is a directory and not a symlink, and that it belongs to the current
  user; the same for the executable and its checksum.
- The variable `OPENCODE_PTY_BIN` overrides everything: the path to a ready daemon.

## Connections

- The event types and the handoff ticket are taken from
  `@opencode/schema/persistent-pty`, the session identifiers — from
  `@opencode/schema/session`, the terminal identifiers — from
  `@opencode/schema/pty`.
- The default shell for a new terminal is `ShellSelect.environment` from the
  `shell` folder, that is, the same shell selection logic as for ordinary commands.
- The default terminal directory is the root of the filesystem: a safe
  value, and not the directory of the location.
- The service is global, and not location-scoped: the node depends only on the bus and
  `Global.node`, because the terminals survive a change of location.
- The daemon is a separate published package `opencode-pty`, which has not yet moved
  into the opencode namespace; its asset arrives through `pty-binding.ts`.
- The server routes turn `attach` into a websocket, using the helpers
  `packages/core/src/pty/protocol.ts`.

## Pitfalls

- Only `create` starts the daemon. A call of `write` or `list` on a dead
  daemon will give an error or an empty list — that is not a breakage of the service.
- Protocol version 7: connecting to a daemon of another version gives a protocol
  error, and not a degradation. An old daemon in the execution directory has to be
  deleted by hand.
- `register` is reset when the ownership connection breaks, and the next
  request reconnects by itself; there is no explicit "restart the daemon" in the interface.
- The handoff ticket acts for a limited time, and a new instance of the
  server is obliged to get it before it starts: otherwise it will return a
  `registration` error and the terminals will be lost.
- `list` without `sessionID` enumerates all the terminals of the daemon, including
  those belonging to other sessions and other server instances, if it is the same
  daemon.
- Installation of the binary under Bun requires write rights to the data directory and
  the rights `0o700` on the directories: with a foreign owner of the file the check will end
  in a refusal, and not in a silent use.
- On workerd any call of `resolveBinary` throws an exception — the persistent
  terminals are completely unavailable in this runtime.