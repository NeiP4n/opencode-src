# @opencode/merman — rendering Mermaid diagrams in the terminal

## What This Is

Rendering of Mermaid diagrams inside the TUI: 88 files, ~21 thousand lines in `src/`
(a significant part are tests). The package parses diagram text, lays out
nodes and edges, and draws them in the terminal's character grid. It registers
as a plugin with a single code renderer — `mermaid`.

The supported diagram types are visible from the directories: `flowchart`, `sequence`,
`state`, `gantt`, `gitgraph`, `timeline`.

## Layers and Dependencies

Layer **L1**: depends on `plugin` (the TUI extension host). No other
`@opencode/*` packages in the dependencies.

The only consumer is `packages/tui`.

Exports — three paths (from `packages/merman/package.json`):

```json
"./markdown": "./src/markdown.ts",
"./palette": "./src/palette.ts",
"./plugin": "./src/plugin.ts"
```

## Subsystems and Files

**Plugin** — `packages/merman/src/plugin.ts`: `Plugin.define` with the id
`opencode.merman`; in `setup` it registers a renderer under the name `mermaid`
through `context.markdown.registerCodeBlockRenderer("mermaid", ...)`. The colors
come from the palette: `resolveOpenCodeDiagramPalette(context.theme,
context.themeMode)`.

**Renderer entry point** — `packages/merman/src/markdown.ts` →
`createMermaidCodeBlockRenderer`.

**Palette** — `packages/merman/src/palette.ts` →
`resolveOpenCodeDiagramPalette(theme, mode)` — diagram colors for the light
and dark schemes (test `palette.test.ts`).

**Rendering core** — the directory `packages/merman/src/core/`:
`canvas.ts` (character canvas), `drawing.ts` (drawing primitives),
`geometry.ts` (geometry), `spatial.ts` (spatial structures),
`text.ts` and `text-lines.ts` (text and line breaks), `color/style.ts` (color
styles), `render-grid.ts` (output grid), `mermaid.ts` (common to all
diagrams). Separately, in the `src/` root — `detect.ts`: determining the
diagram type from the text.

**Diagram types** — directories with a uniform set of files (`diagram.ts` /
`parser.ts` / `layout.ts` / `drawing.ts` / `render-grid.ts` / `style.ts` /
`types.ts`):
- `flowchart/` plus `routing.ts`, `labels.ts`, `options.ts`;
- `sequence/` plus `placement.ts`, `note.ts`, `endpoint.ts`;
- `state/` plus `routing.ts`, `search.ts`, `visible-model.ts`;
- `gantt/`, `gitgraph/`, `timeline/`.

**Diagnostics** — `packages/merman/src/diagnostics.ts` (parse errors),
`packages/merman/src/plugin.ts`.

**Markdown wrapper** — `packages/merman/src/markdown.ts`.

**Tests** — `packages/merman/src/test/` (including `layout-audit/` with
fixtures and a harness), plus `*.test.ts` next to the code.

## Entry Points

1. `packages/merman/src/plugin.ts` — `export default`, attaching as
   a plugin.
2. `packages/merman/src/markdown.ts` → `createMermaidCodeBlockRenderer(...)`
   — the renderer without registration.
3. `packages/merman/src/detect.ts` — determine the diagram type from the text.
4. `packages/merman/src/palette.ts` → `resolveOpenCodeDiagramPalette(...)` —
   colors for the theme.

## Where to Look Next

- `packages/latex/PACKAGE.md` — the sibling formula renderer, the same pattern
   (`plugin` + `markdown`).
- `packages/plugin/PACKAGE.md` — `Plugin.define` and the `setup` context.
- `packages/tui/PACKAGE.md` — the consumer, where Markdown rendering lives.
- `packages/theme/PACKAGE.md` — the themes the palette is taken from.

## Pitfalls

1. **The implementation is not browser Mermaid.** It is its own parser and its own
   layout for the terminal: syntax is supported selectively, exotic constructs
   end up in `diagnostics.ts`.
2. **The three entry points are not interchangeable:** `plugin` registers,
   `markdown` renders, `palette` colors. There is no root `exports`.
3. **`state/routing.ts` and `flowchart/routing.ts` are different code.**
   Line routing is its own thing for each diagram type; editing one does not fix
   the other.
4. **The tests live in `src/`**, not in `test/`: `*.test.ts` and the directory
   `src/test/` are inside `src/` and inside the line count — the figure
   "21 thousand lines" includes them.
