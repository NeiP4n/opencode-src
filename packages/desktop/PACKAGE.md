# @opencode/desktop — desktop application (Electron)

## What This Is

An Electron wrapper: 142 files, ~9.6k lines in `src/`. The three parts of
classic Electron — the main process (`main/`), the preload (`preload/`),
the renderer (`renderer/`) — plus shared code (`shared/`).

Built by `electron-vite`, packaged by `electron-builder` (configs in the
package root), updated through `electron-updater`.

## Layers and Dependencies

Layer **L6 — surface**: the manifest lists no dependency on `@opencode/*`
(the package uses workspace packages through devDependencies and the
build), but by code it is tied to `app`, `cli`, `client`,
`gui-extensions`.

There are no consumers in `packages/*/src` — the package runs on its own.

## Subsystems and Files

Directories in `packages/desktop/src/`:

- `main/` — the Electron main process: windows, system tray, IPC;
- `preload/` — the bridge between the renderer and the main process;
- `renderer/` — the application window (`@opencode/app` is embedded
  here);
- `shared/` — types and utilities shared by both halves.

Configuration in the package root:

- `electron.vite.config.ts` (+test `electron.vite.config.test.ts`) —
  the build;
- `electron-builder.config.ts` (+test) — packaging of distributables;
- `drizzle.config.ts` — migrations of the local database;
- `icons/` — icons.

Scripts (`packages/desktop/package.json`): `dev`, `build`
(`electron-vite build`), `package:mac` / `package:win` /
`package:linux`, `bench:startup`, `migration`.

Dependencies: `electron-updater` (updates), `electron-log`,
`electron-context-menu`, `@zip.js/zip.js`, `lighthouse`.

## Entry Points

1. `packages/desktop/package.json` → `"main": "./out/main/index.js"` —
   the Electron entry point after the build.
2. `packages/desktop/src/main/` — the main process, where development
   starts.
3. `packages/desktop/src/renderer/` — the window the application is
   embedded into.
4. `electron.vite.config.ts` — how the three parts are built.

## Where to Look Next

- `packages/app/PACKAGE.md` — the application inside the renderer.
- `packages/gui-extensions/PACKAGE.md` — the extensions desktop connects.
- `packages/cli/PACKAGE.md` — the CLI launched from the desktop app.
- `packages/desktop/README.md` — the package's own notes.

## Pitfalls

1. **`src/` is not the main-process code after the build:** the result
   lives in `out/` (`out/main/index.js`); edits in `src/` require a
   rebuild.
2. **Configs are tested too** (`electron-builder.config.test.ts`,
   `electron.vite.config.test.ts`) — editing them breaks the tests, not
   just the build.
3. **`drizzle.config.ts` is about the desktop database**, not the
   opencode core database (`packages/core/src/database`); two different
   files.
4. **`main`, `preload`, `renderer` are different contexts.** The only
   shared part is `shared/`; using the DOM in `main/` or the Node API in
   `renderer/` without the preload will crash.
