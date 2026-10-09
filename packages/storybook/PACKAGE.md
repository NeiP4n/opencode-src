# @opencode/storybook — component sandbox

## What This Is

A package without a single `src/` file: 0 lines of TypeScript. It is a wrapper
around Storybook — an isolated environment where the `ui` and `session-ui`
components are browsed and tested separately from the application.

The stories (`.stories.tsx`) live in the component packages themselves; only
the configuration and the run are collected here.

## Layers and Dependencies

Layer **L6 — surface**: it does not depend on `@opencode/*` packages at
runtime — everything is in `devDependencies`.

What is wired up (from `packages/storybook/package.json`):

- `@opencode/client`, `@opencode/session-ui`, `@opencode/ui` —
  the components for the stories;
- `storybook` 10.4.4 and addons (`a11y`, `docs`, `links`, `onboarding`,
  `vitest`), `storybook-solidjs-vite`, `builder-vite`;
- `vite`, `vite-plugin-solid`, `@tailwindcss/vite`;
- `@playwright/test` — screenshot/browser checks (the
  `packages/storybook/playwright/` directory);
- `react`, `react-dom` — only for Storybook itself (it runs on React),
  the opencode UI is on Solid.

Package directories: `playwright/`, `tsconfig.json`, `package.json` — `src/`
is absent.

## Subsystems and Files

1. `packages/storybook/playwright/` — Playwright configuration and tests
   for running the stories in a browser.
2. `packages/storybook/tsconfig.json` — typing of the configuration.
3. `packages/storybook/package.json` — the `storybook`
   (`storybook dev -p 6006`) and `build` (`storybook build`) scripts.

The stories the package shows are scattered across the consumers:
`packages/ui/src/**/*.stories.tsx`,
`packages/session-ui/src/**/*.stories.tsx` (for example
`timeline/mermaid.stories.tsx`, `components/dock-prompt.stories.tsx`,
`tools/tool-group.stories.tsx`).

## Entry Points

1. `packages/storybook/package.json` → the `storybook` script — starting the
   dev server on port 6006.
2. `packages/storybook/package.json` → the `build` script — a static build of
   the stories.
3. `packages/storybook/playwright/` — browser checks of the built
   stories.

## Where to Look Next

- `packages/ui/PACKAGE.md` — the components stories are written for.
- `packages/session-ui/PACKAGE.md` — session components with their own
  stories.
- `packages/app/PACKAGE.md` — the application in which the components really
  work.

## Pitfalls

1. **The absence of `src/` is not an error.** The core validator considers a
   package with zero lines normal: by construction it contains nothing.
2. **Storybook is on React, the components are on Solid.** The bridge is held
   by `storybook-solidjs-vite`; configuration changes break the browsing of
   components, but not the application build.
3. **The stories are not in this package.** `.stories.tsx` must be looked for
   in `ui` and `session-ui`; here there is only the environment that shows
   them.
4. **`react` in the dependencies does not mean opencode is on React** — it is
   a requirement of Storybook itself.
