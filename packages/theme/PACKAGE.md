# @opencode/theme — interface theme schema and resolution

## What This Is

Terminal interface themes: 10 files, ~1.6k lines in `src/tui/`.
The package describes what a theme consists of (colors, hues, button states),
how to resolve it into concrete colors, how to migrate the old format, and how
to switch between the light and dark schemes.

`src` lies entirely in the `tui/` subdirectory — these are themes for the TUI
specifically, the package has no other surfaces.

## Layers and Dependencies

Layer **L0 — leaf**: it does not depend on any `@opencode/*` packages, the
schemas are described on `effect` `Schema`.

Who imports it (two consumers):

- `packages/tui` — renders the interface in the selected colors;
- `packages/plugin` — exposes themes outward, so that plugins can read them.

The map of exported paths in `packages/theme/package.json`:

```json
"./tui": "./src/tui/index.ts",
"./tui/v1": "./src/tui/v1.ts"
```

## Subsystems and Files

**Theme schema** — `packages/theme/src/tui/schema.ts`: type constants on
Effect Schema: `HueStep` (100…900), `SemanticHue`
(`accent` | `interactive` | `neutral`), `ActionVariant`
(`primary` | `secondary` | `destructive`), `ActionState`
(`disabled` | `pressed` | `focused` | `selected` | `hovered`),
`SurfaceName` (only `dialog`), `FeedbackKind`
(`error` | `warning` | `success` | `info`), `CategoricalDefinition`.
This is the vocabulary all the rest of the theme code is built on.

**Resolution** — `packages/theme/src/tui/resolve.ts`: `parseThemeDocument`,
`resolveTheme`, `resolveThemeDocument`, `themeDecodeError` — turning a theme
description into ready values, plus the decoding error.

**Expansion** — `packages/theme/src/tui/expand.ts` → `expandTheme`:
unfolding a theme template into the full set of colors.

**Scheme selection** — `packages/theme/src/tui/select.ts`: `selectTheme`,
`selectThemeMode`, `supportsThemeMode`, `themeModes` — the light/dark scheme
and the supported modes.

**Color** — `packages/theme/src/tui/color.ts` → `rgbToOklch`; accompanied by
`packages/theme/src/tui/syntax.ts` (→ `generateSyntax` — syntax highlighting
colors) and `packages/theme/src/tui/types.ts`.

**Migration** — `packages/theme/src/tui/v1.ts` and
`packages/theme/src/tui/v1-migrate.ts` (→ `migrateV1`): the old theme format
v1 is converted to the current one.

**Package assembly** — `packages/theme/src/tui/index.ts`: a re-export of
everything described above (lines 1–49), this is the public face.

## Entry Points

1. `packages/theme/src/tui/index.ts` — the whole API (`resolveTheme`,
   `expandTheme`, `selectTheme`, `generateSyntax`, `migrateV1`,
   `rgbToOklch` and the types).
2. `packages/theme/src/tui/v1.ts` — the separate `./tui/v1` export for reading
   themes of the old format.
3. `packages/theme/src/tui/resolve.ts` → `resolveTheme` — theme application
   starts here.

## Where to Look Next

- `packages/tui/PACKAGE.md` — consumer: where the colors reach the drawing.
- `packages/plugin/PACKAGE.md` — second consumer, theme access from plugins.
- `packages/ui/PACKAGE.md` — web components, which have their own theming.
- `themes/` in the owner's `.opencode` config — real theme files.

## Pitfalls

1. **All of `src` is the `tui/` subdirectory.** There is no `index.ts` in the
   root of `src`: the entry point is declared in `exports` as `./tui`.
2. **`v1-migrate.ts` and `v1.ts` are not the same thing:** the first migrates,
   the second describes the old format. Importing `./tui/v1` does not migrate
   a theme, it only reads it with the old code.
3. **The schema is strict:** `HueStep` allows only nine values, and
   `SurfaceName` — only `dialog`. A custom theme with any other hue will not
   pass decoding, `themeDecodeError` will be thrown.
4. **`generateSyntax` is derived.** Syntax highlighting colors are computed
   from the base hues; editing one field of the theme changes them too.
