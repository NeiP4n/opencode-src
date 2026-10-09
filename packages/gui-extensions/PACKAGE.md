# @opencode/gui-extensions — interface extensions

## What This Is

A set of extensions for the browser application: 799 files, ~45k lines in
`src/` (many small files). Each directory is a separate feature:
browser, change review, terminal, SSH, WSL, device pairing,
updates, usage statistics and others.

## Layers and Dependencies

Layer **L6 — surface**: depends on `client`, `plugin-browser`,
`schema`, `session-ui`, `ui`, `util`.

Who imports it: `packages/app` and `packages/desktop`.

Exports (`packages/gui-extensions/package.json`):

```json
"./renderer": "./src/renderer.ts",
"./main": "./src/main.ts",
"./sdk": "./src/sdk/index.ts",
"./sdk/main": "./src/sdk/main.ts",
"./sdk/bridge": "./src/sdk/bridge.ts",
"./updater": "./src/updater/contract.ts"
```

## Subsystems and Files

`packages/app`-style directories in `packages/gui-extensions/src/`:

- `browser/` — browser tools (they work with
  `@opencode/plugin-browser`);
- `review/` — change review, file review;
- `terminal/` — the terminal in the interface;
- `file/` — working with files;
- `pair/` — device pairing (access from a phone);
- `ssh/`, `wsl/` — remote environments;
- `updater/` — updates (`contract.ts` is a separate export);
- `usage/` — usage statistics;
- `summary/` — summaries;
- `debug/` — debug panels;
- `btw/`, `sdk/` — service modules;
- `main.ts`, `renderer.ts` — the two halves: main process and renderer.

## Entry Points

1. `packages/gui-extensions/src/main.ts` (export `./main`) — the main
   process of the extensions.
2. `packages/gui-extensions/src/renderer.ts` (export `./renderer`) —
   the renderer part.
3. `packages/gui-extensions/src/sdk/index.ts` (export `./sdk`) — the API
   for writing your own extensions.
4. `packages/gui-extensions/src/updater/contract.ts` (export `./updater`) —
   the update contract.

## Where to Look Next

- `packages/app/PACKAGE.md` — the application the extensions are built
  into.
- `packages/plugin-browser/PACKAGE.md` — the server side of the browser
  tools.
- `packages/session-ui/PACKAGE.md` — the components reused by the
  extensions.
- `packages/ui/PACKAGE.md` — the base components.

## Pitfalls

1. **There is no root export.** Only `./main`, `./renderer`, `./sdk`
   and so on; importing `@opencode/gui-extensions` does not work.
2. **799 files at 45k lines** — the average file is small: edits are
   usually local, but searching by name is more reliable than by memory.
3. **`main` and `renderer` are different processes** (the Electron
   pattern): the shared code lives in `sdk/`, not in one of the two.
4. **`updater/contract.ts` is separate**, so a consumer takes only the
   types without pulling in the update implementation.
