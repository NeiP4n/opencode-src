# @opencode/tui — the terminal interface

## What This Is

TUI: 281 files, ~62k lines in `src/` — the second largest package after
`app`. A full terminal interface for opencode: sessions, tabs, prompt, dialogs,
themes, attention sounds, editor integration.

Started with the `opencode tui` command from `packages/cli`.

## Layers and Dependencies

Layer **L6 — surface**: depends on `client`, `core`, `latex`, `merman`,
`plugin`, `schema`, `simulation`, `theme`, `ui`, `util`.

Who imports it: `packages/cli` — the only importer in `src`
(plus `tui` itself internally).

The export map is large (45 paths in `package.json`), the main ones:

```json
".": "./src/index.tsx",
"./config": "./src/config/index.tsx",
"./context/client": "./src/context/client.tsx",
"./context/storage": "./src/context/storage.tsx",
"./mini": "./src/mini/index.ts",
"./runtime": "./src/runtime.tsx",
"./theme/discovery": "./src/theme/discovery.ts"
```

## Subsystems and Files

**The large directories of `packages/tui/src/`** (by size):

| Directory | Lines | Contents |
| --- | --- | --- |
| `mini/` | 18.2k | a separate frontend runtime, started by the CLI command `mini` |
| `component/` | 14.0k | ~50 widgets: `dialog-*.tsx`, `session-tabs.tsx`, prompt |
| `routes/` | 8.9k | `home.tsx` and `session/index.tsx` (3610 lines) |
| `feature-plugins/` | 4.9k | `home/`, `prompt/`, `sidebar/`, `system/` |
| `context/` | 3.8k | ~30 Solid contexts: `client.tsx`, `data.tsx`, `permission.tsx`, `keymap.tsx`, `theme.tsx` |

**Server connection** — `packages/tui/src/context/client.tsx`
(61 lines) — the single point where the TUI connects to the API.

**Configuration** — `packages/tui/src/config/` (including `keybind.ts`,
`v1/` for the old format) — settings and key layout.

**Themes** — `packages/tui/src/theme/` (plus the `./theme/discovery` export) —
work with `@opencode/theme`.

**Editor** — `editor.ts`, `editor-zed.ts`, `editor-zed-sqlite.bun.ts` /
`editor-zed-sqlite.node.ts` (per-runtime variants), `context/editor.ts`.

**Sound and attention** — `attention.ts`, `audio.ts`,
`attention-sounds.bun.ts` / `attention-sounds.node.ts`.

**Rendering** — `app.tsx`, `index.tsx`, `runtime.tsx`, the `ui/` directories
(`dialog.tsx`, `spinner.ts`, `toast.tsx`), `component/`,
`prompt/` (`content.ts`, `display.ts`), `devtools/`, `simulation/`,
`plugin/` (interface plugins, `discovery.ts`).

**Misc** — `clipboard.ts`, `logo.ts`, `model-preference.ts`,
`parsers-config.ts` (tree-sitter parsers), `util/` (7 files: `session.ts`,
`form.ts`, `string-width.ts`, `persistence.ts`, …), `terminal-win32.ts`.

## Entry Points

1. `packages/tui/src/index.tsx` (the `"."` export) — the root of the interface.
2. `packages/tui/src/context/client.tsx` — server connection; change the way
   the connection works here.
3. `packages/tui/src/runtime.tsx` (the `./runtime` export) — the render runtime.
4. `packages/tui/src/mini/index.ts` (the `./mini` export) — a separate
   mini-frontend.
5. `packages/tui/src/config/index.tsx` (the `./config` export) — settings.

## Where to Look Next

- `packages/cli/PACKAGE.md` — the commands that start the TUI (`tui`, `mini`).
- `packages/theme/PACKAGE.md` — the theme schemas applied here.
- `packages/latex/PACKAGE.md`, `packages/merman/PACKAGE.md` — code block
  renderers plugged in through plugins.
- `packages/client/PACKAGE.md` → `./solid` — data source.

## Pitfalls

1. **`mini/` is not a "cut-down TUI".** It is an independent frontend runtime
   of 18k lines with its own renderer, started by a separate command
   (`packages/cli/src/commands/handlers/mini.ts`).
2. **Runtime variants sit side by side:** `attention-sounds.bun.ts` /
   `attention-sounds.node.ts`, `editor-zed-sqlite.bun.ts` /
   `editor-zed-sqlite.node.ts`. Editing one does not edit the other.
3. **The declared L6 layer does not reflect coupling:** `mini/` pulls the core
   directly, bypassing `context/client.tsx`. Check the specific file.
4. **The 45 exports are not the public plugin API.** Plugins have a separate
   `./plugin` and `@opencode/plugin/tui`; the other paths are internal.
5. **`context/storage.tsx` and `component/session-tabs.tsx`** in this tree
   were changed locally (edits from the owner's earlier work) — do not
   overwrite them.
