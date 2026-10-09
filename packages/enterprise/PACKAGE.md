# @opencode/enterprise — corporate surface

## What This Is

A small SSR package: 12 files, ~1.4k lines in `src/`. The corporate
surface of opencode — a server-side render of the application with separate
routes and core (`core/`).

The package is `private`, there are no `exports` in `package.json` — it is
built, not imported as a module.

## Layers and Dependencies

Layer **L6 — surface**: depends on `client`, `core`, `schema`,
`session-ui`, `ui`, `util`.

There are no consumers in `packages/*/src` — the package runs as its own
application.

## Subsystems and Files

Directories and files in `packages/enterprise/src/`:

- `entry-server.tsx` — the server-side render (the SSR entry point);
- `entry-client.tsx` — client hydration;
- `app.tsx`, `app.css` — the application and its styles;
- `routes/` — the routes of the corporate surface;
- `core/` — the bridge to the core (access to `@opencode/core`);
- `global.d.ts`, `custom-elements.d.ts` — type declarations.

Tests live next to it: `packages/enterprise/test/` and
`packages/enterprise/test-debug.ts`; the build scripts are in
`packages/enterprise/script/`.

## Entry Points

1. `packages/enterprise/src/entry-server.tsx` — SSR, where request
   handling starts.
2. `packages/enterprise/src/entry-client.tsx` — hydration on the client.
3. `packages/enterprise/src/routes/` — which pages exist.
4. The `package.json` scripts of the package — build and run.

## Where to Look Next

- `packages/app/PACKAGE.md` — the browser application the package overlaps
  with in components.
- `packages/session-ui/PACKAGE.md` and `packages/ui/PACKAGE.md` —
  reusable components.
- `packages/core/PACKAGE.md` — the core that `core/` accesses.

## Pitfalls

1. **`exports` is missing** — `@opencode/enterprise` cannot be imported
   from another package; it is a separate application.
2. **SSR and the client are two entry points.** Editing `app.tsx` requires
   checking both: the server-side render and the hydration.
3. **`custom-elements.d.ts` and `global.d.ts` are declarations**, not
   code; there is no logic in them.
4. **The package is smaller than the other surfaces** — part of its
   functionality comes from `app` instead of being duplicated; look for
   "enterprise logic" in `routes/`, not in the components.
