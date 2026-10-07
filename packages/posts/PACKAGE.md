# @opencode/posts — блог opencode на Astro

## Что это

Сайт с записями блога: Astro + MDX, деплой на Cloudflare. Пакет не связан
с ядром CLI — ни один пакет `@opencode/*` его не импортирует, и он ни кого
не импортирует. В подсчёт строк `src/` попадает только `content.config.ts`
(14 строк): `.astro` и `.mdx` в статистику `*.ts` не считаются.

Пакет `private: true`, публикуется только как сайт.

## Слои и зависимости

Слой **L0 — лист**: от пакетов `@opencode/*` не зависит. Сторонние
зависимости: `astro` и `@astrojs/mdx` (сборка), `@fontsource/commit-mono`
(шрифт), для деплоя — `wrangler` и `@astrojs/cloudflare`.

Потребителей в дереве пакетов нет — это самостоятельный веб-проект внутри
монорепозитория.

## Подсистемы и файлы

**Контент** — `packages/posts/src/content/posts/`: три записи MDX
(`hello.mdx`, `inside-the-loop.mdx`, `tools-should-disappear.mdx`).

**Схема контента** — `packages/posts/src/content.config.ts` (14 строк):
объявляет коллекцию `posts` через `defineCollection`, единственный `.ts`-файл
пакета.

**Страницы** — `packages/posts/src/pages/`:
- `index.astro` — список записей;
- `[...slug].astro` — страница одной записи по пути.

**Каркас** — `packages/posts/src/layouts/Layout.astro` (общий HTML-каркас),
`packages/posts/src/components/Counter.astro` (пример компонента),
`packages/posts/src/styles/global.css` (стили).

**Сборка и деплой** — манифест пакета:
- `bun run dev` — astro dev-сервер;
- `bun run build` — `astro build && bun script/prepare-cloudflare.ts`;
- `bun run deploy` — `wrangler deploy --config dist/server/wrangler.json`.

## Точки входа

1. `packages/posts/src/pages/index.astro` — корень сайта.
2. `packages/posts/src/content.config.ts` — точка, где описывается, какие
   записи и с какими полями существуют.
3. Скрипты `dev` / `build` / `deploy` из манифеста пакета.

## На что смотреть дальше

- `packages/web/PACKAGE.md` — основной сайт opencode, тот же стиль деплоя.
- `packages/console` — инфраструктура SST/Astro вокруг проекта.
- `AGENTS.md` в корне репозитория — правила монорепозитория.

## Ловушки

1. **`Counter.astro` — пример компонента из шаблона Astro**, не часть
   продукта; его правка на контент не влияет.
2. **Строки `.astro` и `.mdx` не входят в статистику `src/`** — цифры
   «14 строк» из манифеста не описывают размер контента.
3. **`bun run build` пишет в `dist/` и готовит Cloudflare-конфиг** — сборка
   без `script/prepare-cloudflare.ts` даст нерабочий деплой.
4. **Пакет не тестируется и не typecheck-ится в общем `bun run check`**
   в том же объёме, что ядро: у него свой скрипт `typecheck`
   (`astro check`).
