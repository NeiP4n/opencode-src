# @opencode/latex — rendering formulas in the terminal

## What This Is

Rendering of LaTeX formulas inside the TUI: 14 files, ~2.6 thousand lines in `src/`
(half of them are tests). The package parses a formula, breaks it down into a
character grid and draws it in the terminal, registering itself as a plugin with
two code renderers — `latex` and `math`.

## Layers and Dependencies

Layer **L1**: depends on `plugin` (the TUI extension host). There are no further
internal dependencies on other `@opencode/*` packages.

The only consumer is `packages/tui`.

Exports — two paths (from `packages/latex/package.json`):

```json
"./markdown": "./src/markdown.ts",
"./plugin": "./src/plugin.ts"
```

## Subsystems and Files

**Plugin** — `packages/latex/src/plugin.ts` (54 lines): `Plugin.define`
with the id `opencode.latex`; in `setup` it creates a renderer through
`createLatexCodeBlockRenderer(context.renderer, ...)` and registers it
under the names `latex` and `math`
(`context.markdown.registerCodeBlockRenderer(...)`). The colors come from
the theme: `context.theme.text.base` and `context.theme.text.muted`.

**Renderer entry point** — `packages/latex/src/markdown.ts` →
`createLatexCodeBlockRenderer` — the bridge between a Markdown code block and
the parser.

**Parser** — `packages/latex/src/parser.ts`: parsing a formula into a tree
(tests nearby: `parser.test.ts`, `parser-render.test.ts`).

**Layout and drawing** — `packages/latex/src/layout.ts` (placement of
characters, fractions, indices) and `packages/latex/src/render.ts` (output into
a character grid); tests — `layout.test.ts`, `render.test.ts`,
`root.test.ts`.

**Symbols and limits** — `packages/latex/src/symbols.ts` (the LaTeX symbol
table) and `packages/latex/src/limits.ts` (complexity limits,
so that a formula does not hang the renderer).

**Types** — `packages/latex/src/types.ts`.

## Entry Points

1. `packages/latex/src/plugin.ts` — `export default`, this is how the package is
   plugged in as a plugin.
2. `packages/latex/src/markdown.ts` → `createLatexCodeBlockRenderer(...)` —
   if you need the renderer itself without registration.
3. `packages/latex/src/parser.ts` — if you only need the formula parsing.

## Where to Look Next

- `packages/plugin/PACKAGE.md` — `Plugin.define` and the context that is
   passed into `setup`.
- `packages/tui/PACKAGE.md` — the consumer: where Markdown blocks turn into
   rendering.
- `packages/merman/PACKAGE.md` — a sibling renderer (Mermaid diagrams),
   the same attachment pattern.

## Pitfalls

1. **This is not a LaTeX compiler.** It is a subset of commands meant for terminal
   display; exotic `amsmath` packages are not supported and end up either in a
   `limits.ts` restriction or in unreadable output.
2. **`./markdown` and `./plugin` are different things**: the plugin registers a
   renderer, `markdown` returns the factory. Importing the package root does not
   work — there is no root `exports`.
3. **Half of the lines are tests.** Looking for logic in `*.test.ts` is useless:
   the working code is in `parser.ts`, `layout.ts`, `render.ts`.
4. **The `latex` and `math` code blocks behave identically** — they are registered
   with one line in `plugin.ts`; editing the registration happens in the same
   place, in the two calls.
