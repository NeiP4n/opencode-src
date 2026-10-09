# @opencode/web — site, documentation and lander

## What This Is

An Astro site: the lander, the documentation and the session sharing page.
The package has 2 649 `*.ts` lines in `src/` (the content itself is `.astro`
and `.mdx`, which is not counted in `*.ts`), 18 TS files.

This is the showcase of opencode: marketing pages (`lander`), documentation
(`content/docs`, translations `content/i18n`) and the public session page
`pages/s/[id].astro`. The package is not part of the CLI binary.

## Layers and Dependencies

Layer **L0 — leaf**: it does not depend on any `@opencode/*` packages. There
is no `exports` in `package.json` — the package is not consumed as a module,
it is built as a site. It relies on Astro and Starlight (documentation).

There are no consumers in `packages/*/src`.

## Subsystems and Files

**Pages** — `packages/web/src/pages/`:
- `s/[id].astro` — the published session page;
- `[...slug].md.ts` — serving Markdown by path.

The documentation pages do not live in `pages/`: Starlight serves them
according to the configuration from `packages/web/src/content.config.ts` and
`astro.config.mjs` (both at the root of the package).

**Content** — `packages/web/src/content/`:
- `docs/` — documentation in dozens of languages (`en`, `ru`, `zh-cn`,
  `zh-tw`, `ja`, `ko`, `de`, `fr`, `es`, …), topics include `cli`, `config`,
  `plugins`, `providers`, `models`, `permissions`, `share`, `themes`, `tools`,
  `tui`, `zen`;
- `i18n/*.json` — translations of the site interface (18 files).

**Components** — `packages/web/src/components/`: `Head.astro`,
`Header.astro`, `Footer.astro` — the skeleton of the pages.

**Translations** — `packages/web/src/i18n/locales.ts` and
`packages/web/src/middleware.ts` — language detection and substitution.

**Assets** — `packages/web/src/assets/` (logos `logo-dark.svg`,
`logo-light.svg`, screenshots `lander/` and `web/`).

**Styles and types** — `packages/web/src/styles/custom.css`,
`packages/web/src/types/lang-map.d.ts`, `packages/web/src/types/starlight-virtual.d.ts`.

## Entry Points

1. `packages/web/src/content.config.ts` — the documentation collections
   configuration, the routed serving starts from it.
2. `packages/web/src/middleware.ts` — the point where the language of the
   request is determined.
3. `packages/web/src/i18n/locales.ts` — the list of supported locales.
4. The package scripts (`dev`, `build`) from `packages/web/package.json` —
   starting and building the site.

## Where to Look Next

- `packages/posts/PACKAGE.md` — the second site in the repository (the blog),
  the same deployment approach.
- `packages/theme/PACKAGE.md` — the themes that the documentation describes in
  words.
- `AGENTS.md` at the repository root — the monorepo rules.
- `packages/console`, `packages/stats` — SST infrastructure around the sites.

## Pitfalls

1. **`src/` lines barely enter the statistics:** 2 649 lines is `.ts`
   (`i18n`, `middleware`, types), while all the documentation is `.mdx` and
   does not get into the `*.ts` count. The number does not reflect the volume
   of the content.
2. **Translations of different ages.** There are more translations than
   updated articles: part of the `ru`/`zh-cn` pages diverges from `en`. They
   have to be checked against `en`.
3. **The documentation routes and Markdown do not conflict in `pages/`.**
   Starlight serves `.mdx` according to the configuration, and
   `pages/[...slug].md.ts` serves Markdown — the resolution order is set by
   Astro, not by the package code.
4. **Starlight typing is fragile:** `types/starlight-virtual.d.ts` is a
   declaration over virtual modules, changing the structure of the
   documentation can break it, and that will only surface when the site is
   built.
