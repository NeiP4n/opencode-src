# @opencode/app — browser application

## What This Is

The largest package: 515 files, ~121k lines in `src/`. The opencode web
application: home screen, session creation, workspaces, settings, composer,
server panels and the shell.

Built with Vite (see `index.html`, `manifest.json` in the package root) and
embedded into the desktop application.

## Layers and Dependencies

Layer **L6 — surface**: depends on `client`, `gui-extensions`, `schema`,
`session-ui`, `ui`, `util`.

Who depends on it: `packages/desktop`, `packages/session-ui` — both take
parts of the application. The root `src` is the entry point of the
application itself.

Export map (`packages/app/package.json`):

```json
".": "./src/index.ts",
"./desktop": "./src/desktop.ts",
"./desktop-menu": "./src/shell/commands/desktop-menu.ts",
"./vite": "./vite.js",
"./index.css": "./src/index.css"
```

## Subsystems and Files

Directories in `packages/app/src/`:

- `home/` — home screen with the session list;
- `new-session/` — session creation;
- `session/` — session workspace;
- `composer/` — message input (composer);
- `workspaces/` — workspaces;
- `servers/` — server panel (connecting to other instances);
- `settings/` — settings;
- `shell/` — shell and commands, including `commands/desktop-menu.ts`;
- `providers/` — Solid state providers;
- `runtime/` — runtime plumbing (including `i18n/desktop-native.ts`);
- `app.tsx`, `entry.tsx`, `index.ts`, `index.css`, `desktop.ts`.

**Tests** — `packages/app/component-tests/` and `packages/app/e2e/`
(E2E runs), `theme-preload.test.ts` in `src/`.

## Entry Points

1. `packages/app/src/index.ts` (export `"."`) — the application root.
2. `packages/app/src/entry.tsx` — the render entry point.
3. `packages/app/src/desktop.ts` (export `./desktop`) — the variant for the
   desktop build.
4. `packages/app/src/index.css` (export `./index.css`) — styles for when the
   application is embedded without its own HTML.

## Where to Look Next

- `packages/session-ui/PACKAGE.md` — the session feed components that
  `session/session` is assembled from.
- `packages/gui-extensions/PACKAGE.md` — extensions pluggable into the
  application.
- `packages/ui/PACKAGE.md` — base components.
- `packages/desktop/PACKAGE.md` — the Electron wrapper.

## Pitfalls

1. **`"./vite"` points to `vite.js` in the package root**, not in `src/` —
   it is the build host plugin.
2. **Two entry points (`index.ts` and `entry.tsx`)** — module and render;
   confusing them produces "the application does not start".
3. **`desktop.ts` is not a copy but a behavior branch** for Electron: part of
   the browser API is disabled or replaced there
   (`runtime/i18n/desktop-native.ts`).
4. **E2E and component-tests live outside `src/`** and are not included in the
   package line count — but they break first when the UI is changed.
