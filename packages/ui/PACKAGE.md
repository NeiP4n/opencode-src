# @opencode/ui — interface component library

## What This Is

Web components on Solid.js: 214 files, ~35k lines in `src/`. Buttons,
dialogs, tables, icons, themes, styles — the whole visual set for opencode's
browser surfaces (app, extensions, session page).

The package is published (`publishConfig.access: public`) and imported
component by component: `exports` contains dozens of entries of the form
`"./button": "./src/actions/button/button.tsx"`.

## Layers and Dependencies

Layer **L0 — leaf**: it does not depend on any `@opencode/*` packages. It
relies on `solid-js` (peer) and `@kobalte/core` (headless components), plus
`shiki`/`marked`/`katex` (highlighting, Markdown, formulas), `motion`,
`fuzzysort`, `solid-sonner`.

Who imports it (number of files with an `@opencode/ui` import):

| Package | Files |
| --- | --- |
| `packages/app/src` | 133 |
| `packages/gui-extensions/src` | 44 |
| `packages/session-ui/src` | 35 |
| `packages/ui/src` | 26 (internal imports) |
| `packages/desktop/src` | 4 |
| `packages/tui/src` | 3 |
| `packages/enterprise/src` | 3 |
| `packages/cli/src` | 1 |

## Subsystems and Files

The directories of `packages/ui/src/` are laid out by purpose:

**Component categories:**
- `actions/` — `button/`, `icon-button/`, `split-button/` (plus `submit.css`);
- `data-display/` — `accordion/`, `avatar/`, `badge/`, `card/`,
  `animated-number/`, `collapsible/`, tables and lists;
- `overlays/` — `dialog/`, `tooltip/`;
- `forms/`, `feedback/`, `navigation/`, `layout/`, `typography/` —
  the remaining groups;
- `components/` — components broader than the categories: `app-icon.tsx`,
  `card.tsx`, `animated-number.tsx`, sprites `app-icons/`, `file-icons/`,
  `provider-icons/`.

**Themes and styles** — `packages/ui/src/theme/` (including `themes/*.json`),
`packages/ui/src/styles/`. The CSS sits next to the component
(`button/button.css`), and `sideEffects: ["**/*.css"]` tells the bundler that
the styles must be included.

**Icons and assets** — `packages/ui/src/icons/`, `packages/ui/src/assets/`
(icons, fonts, sounds), the sprites are built by `vite-plugin-icons-spritesheet`.

**Internationalization and demo** — `packages/ui/src/i18n/`,
`packages/ui/src/storybook/` (stories), `*.stories.tsx` next to the
components.

**Hooks and context** — `packages/ui/src/hooks/`, `packages/ui/src/context/`;
`custom-elements.d.ts` — declaration of custom elements.

## Entry Points

1. `packages/ui/package.json` → `exports` — the component map; the path
   `@opencode/ui/button` opens `src/actions/button/button.tsx`.
2. `packages/ui/src/actions/button/button.tsx` — shows the component style:
   Kobalte's `Root`, the `size` / `variant` props, local `.css`.
3. `packages/ui/src/theme/` — when you need a theme, not a component.

## Where to Look Next

- `packages/app/PACKAGE.md` — the main consumer (133 files).
- `packages/session-ui/PACKAGE.md` — the session page built on these
  components.
- `packages/gui-extensions/PACKAGE.md` — extensions that import `ui`
  directly.
- `packages/theme/PACKAGE.md` — terminal interface themes (a different
  surface, do not confuse them with `ui/theme`).

## Pitfalls

1. **Each component is a separate export.** An `"@opencode/ui"` import does
   not exist: only `@opencode/ui/button`, `@opencode/ui/icon`, and so on.
2. **CSS is part of the package.** `sideEffects` deliberately keeps
   `**/*.css`; disabling tree-shaking of the styles gives you a "button
   without styles".
3. **Tests and stories are not published:** `files` in `package.json` excludes
   `*.test.ts(x)` and `*.stories.ts(x)` — they do not end up in `dist`.
4. **`ui/theme` (web themes) ≠ `@opencode/theme` (TUI themes).** Two different
   packages with similar names.
5. **Icon sprites are produced by the build** (`app-icons/sprite.svg`,
   `file-icons/sprite.svg` in `files`) — they cannot be edited by hand,
   they are generated from `src/assets`.
