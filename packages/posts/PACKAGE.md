# @opencode/posts — the opencode blog on Astro

## What This Is

A site with blog posts: Astro + MDX, deployed to Cloudflare. The package is
unrelated to the CLI core — no `@opencode/*` package imports it, and it imports
nothing. Only `content.config.ts` counts toward the `src/` line count
(14 lines): `.astro` and `.mdx` are not counted in the `*.ts` statistics.

The package is `private: true`, it is published only as a site.

## Layers and Dependencies

Layer **L0 — leaf**: does not depend on `@opencode/*` packages. Third-party
dependencies: `astro` and `@astrojs/mdx` (build), `@fontsource/commit-mono`
(font), for deployment — `wrangler` and `@astrojs/cloudflare`.

There are no consumers in the package tree — this is a standalone web project
inside the monorepo.

## Subsystems and Files

**Content** — `packages/posts/src/content/posts/`: three MDX posts
(`hello.mdx`, `inside-the-loop.mdx`, `tools-should-disappear.mdx`).

**Content schema** — `packages/posts/src/content.config.ts` (14 lines):
declares the `posts` collection via `defineCollection`, the only `.ts` file
in the package.

**Pages** — `packages/posts/src/pages/`:
- `index.astro` — the list of posts;
- `[...slug].astro` — a single post page by path.

**Scaffolding** — `packages/posts/src/layouts/Layout.astro` (the shared
HTML scaffold), `packages/posts/src/components/Counter.astro` (a component
example), `packages/posts/src/styles/global.css` (styles).

**Build and deploy** — the package manifest:
- `bun run dev` — astro dev server;
- `bun run build` — `astro build && bun script/prepare-cloudflare.ts`;
- `bun run deploy` — `wrangler deploy --config dist/server/wrangler.json`.

## Entry Points

1. `packages/posts/src/pages/index.astro` — the site root.
2. `packages/posts/src/content.config.ts` — the place where it is declared
   which posts exist and with which fields.
3. The `dev` / `build` / `deploy` scripts from the package manifest.

## Where to Look Next

- `packages/web/PACKAGE.md` — the main opencode site, the same deployment style.
- `packages/console` — SST/Astro infrastructure around the project.
- `AGENTS.md` in the repository root — the monorepo rules.

## Pitfalls

1. **`Counter.astro` is a component example from the Astro template**, not
   part of the product; editing it does not affect the content.
2. **`.astro` and `.mdx` lines are not included in the `src/` statistics** —
   the "14 lines" figure from the manifest does not describe the content size.
3. **`bun run build` writes to `dist/` and prepares the Cloudflare config** — a
   build without `script/prepare-cloudflare.ts` yields a broken deployment.
4. **The package is not tested and not typechecked in the global `bun run check`**
   to the same extent as the core: it has its own `typecheck` script
   (`astro check`).
