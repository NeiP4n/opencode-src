# @opencode/http-recorder — recording and replaying HTTP traffic

## What This Is

An Effect traffic recorder into cassettes (a VCR analogue): 14 files, ~1.6 thousand
lines in `src/`. It captures HTTP and WebSocket requests while a test runs and, on
a repeat run, returns the saved responses — that is how the core integration tests
stay out of the network.

The package describes itself as: «Record and replay Effect HTTP and WebSocket traffic
with deterministic cassettes».

## Layers and Dependencies

Layer **L0 — leaf**: it does not depend on any other `@opencode/*` package. Its
base is `effect` (`HttpClient`, `Socket`), runtime — Node ≥22.

Who plugs it in (only `devDependencies`, that is, in tests):

- `packages/ai/package.json`;
- `packages/core/package.json`.

There are no imports in the `src` product code — for example:
`packages/core/test/session-runner-recorded.test.ts` uses
`HttpRecorder.layerFetch(...)` and `HttpRecorder.removeCassetteSync(...)`.

## Subsystems and Files

**Public face** — `packages/http-recorder/src/index.ts`: the
`HttpRecorder` object with five functions (`layer`, `layerFetch`, `layerSocket`,
`layerWebSocketConstructor`, `hasCassetteSync`, `removeCassetteSync`) and
a namespace with types (`RecorderOptions`, `RedactOptions`, `RequestMatcher`,
`RequestSnapshot`, `CassetteMetadata`).

**Cassettes** — the directory `packages/http-recorder/src/cassette/`:
- `model.ts` — the structure of a cassette and its metadata;
- `store.ts` — reading/writing to disk, `hasCassetteSync` and `removeCassetteSync`.

**HTTP** — the directory `packages/http-recorder/src/http/`:
- `recorder.ts` — the `layer` and `layerFetch` layers, request interception;
- `matching.ts` — comparing an incoming request with a recorded one;
- `model.ts` — the normalized request/response snapshot.

**WebSocket** — the directory `packages/http-recorder/src/websocket/`:
`recorder.ts` (the `layerSocket`, `layerWebSocketConstructor` layers),
`model.ts` (the frame format).

**Secret redaction** — the directory
`packages/http-recorder/src/redaction/`: `secrets.ts` (what to treat as a secret),
`redactor.ts` (the additive policy of redaction and header preservation).

**Replay state** — the directory
`packages/http-recorder/src/replay/`: `state.ts` (record/replay mode),
`comparison.ts` (matching the actual response against the cassette).

**Options and API** — `packages/http-recorder/src/options.ts`,
`packages/http-recorder/src/api.ts` (the types that `index.ts` re-exports).

## Entry Points

1. `packages/http-recorder/src/index.ts` — `HttpRecorder` (object and namespace),
   the only attachment point from outside.
2. `packages/http-recorder/src/index.ts` → `layer(name, options?)` — the main
   way to hang recording on an HTTP client.
3. `packages/http-recorder/src/index.ts` → `hasCassetteSync(name, options?)` —
   check whether a cassette already exists, before the test run.

## Where to Look Next

- `packages/core/test/session-runner-recorded.test.ts` — live usage:
  how a core test plugs in a cassette.
- `packages/ai/PACKAGE.md` — the second consumer, model tests.
- `packages/util/PACKAGE.md` — where the files are stored (the cassette directory
  is set by options, not hardcoded).

## Pitfalls

1. **Recording and replay are mutually exclusive.** An unclosed recording leaves
   an incomplete cassette, and the next run goes to the network instead of
   answering from the file.
2. **`removeCassetteSync` deletes the cassette from disk** — in tests it is called
   before a re-record, a stray call in production code erases the artifact.
3. **Secrets are redacted before recording**, the policy is additive: new fields
   are added to the already-set one instead of replacing it — a misconfigured
   `RedactOptions` silently writes the token into the cassette.
4. **A request match is not exact equality.** `matching.ts` compares by
   normalized snapshot; a provider that returned another field order or a
   different `requestId` may fail to match the recording.
