# @opencode/httpapi-codegen — client generator from HttpApi

## What This Is

Code generator: 1 file, ~2 thousand lines in `src/`. It takes `HttpApi` from
Effect (the HTTP contract described in `protocol`) and turns it into a
TypeScript client file — exactly those generated files that the repository rule
forbids editing by hand.

The package is `private: true` and is not used at runtime: it only works during
the build.

## Layers and Dependencies

Layer **L0 — leaf**: it does not depend on any `@opencode/*` packages. Its
foundation is `effect` (`Schema`, `HttpApi`, `OpenApi`) and `prettier` (output
formatting).

The only consumer is `packages/client`:

- `packages/client/package.json` declares the `@opencode/httpapi-codegen`
  dependency;
- `packages/client/script/build.ts` imports `compile`, `emitEffectImported`,
  `emitEffectShape`, `emitPromise`, `write` and assembles the client from them.

## Subsystems and Files

There is a single file, `packages/httpapi-codegen/src/index.ts`, but it can be
split into six meaningful parts:

**Operation model** (lines 7–100) — the types `Operation`,
`OperationInputField`, `InputField`, `Output`, `Contract`, `Endpoint`, `Group`.
They describe what the generator sees on input: a group, a method name, input
fields (`params` / `query` / `headers` / `payload` / `wildcard`), success
(`value` / `void` / `stream`) and the list of errors. `GenerationError` is here
too — a `Schema.TaggedError` with a `reason` field.

**Contract compilation** — `compile(api)` (line 101): walks `HttpApi`, collects
groups and endpoints, validates name uniqueness (`groupTypeNames` /
`endpointTypeNames`) and turns schemas into readable type references.

**Client variant emission** — four functions:
- `emitEffect(contract)` (293) — the Effect client;
- `emitEffectImported(...)` (303) — the same, but with type imports;
- `emitEffectShape(...)` (320) — the result shape, without an implementation;
- `emitPromise(...)` (338) — the promise client.

**Text generation** — the main part of the file: building function, type and
import declarations as strings, with checks so that the output is valid TS.

**Writing to disk** — `write(output, directory?)` (1467): puts the files into
the directory and writes a manifest (a list of the generated files).

**The whole build** — `generate(api, options?)` (1536): `compile` →
`emitEffect` → `write`.

## Entry Points

1. `packages/httpapi-codegen/src/index.ts` → `generate(...)` — the full cycle,
   this is where to start.
2. `packages/httpapi-codegen/src/index.ts` → `compile(...)` — if you only need
   the contract parsing into `Contract`.
3. `packages/client/script/build.ts` — the only place where the package is
   really called; it also shows which client files come out.

## Where to Look Next

- `packages/protocol/PACKAGE.md` — the `HttpApi` itself that the contract is
  taken from.
- `packages/client/PACKAGE.md` — the generated result and three API variants
  (`effect`, `promise`, `solid`).
- `packages/server/PACKAGE.md` — the server-side implementation of the same
  endpoints.
- `packages/schema/PACKAGE.md` — the types that end up in the contract.

## Pitfalls

1. **Client files are not edited by hand** — this follows from how the
   generator works: any edit will be overwritten by the next `bun run generate`
   run from `packages/client`.
2. **Changing `HttpApi` in `protocol` or `server` without regeneration**
   desynchronizes the types: the server answers differently from what the
   client declares.
3. **`GenerationError` is the only expected error**: duplicate group or
   endpoint names fail generation instead of producing a warning.
4. **`generate` writes files and a manifest** — running it outside the package
   directory scatters the generated files across the given `options.directory`.
5. **Formatting via `prettier` is built in** — the version `3.6.2` is pinned in
   the dependencies; changing it changes how the generated code looks in git.
