# @opencode/web — сайт, документация и лендер

## Что это

Astro-сайт: лендер, документация и страница шаринга сессии. Пакет
2 649 строк `*.ts` в `src/` (само содержимое — `.astro` и `.mdx`, в подсчёт
`*.ts` не входит), 18 файлов TS.

Это витрина opencode: маркетинговые страницы (`lander`), документация
(`content/docs`, переводы `content/i18n`) и страница публичной сессии
`pages/s/[id].astro`. Пакет не входит в бинарник CLI.

## Слои и зависимости

Слой **L0 — лист**: от пакетов `@opencode/*` не зависит. `exports` в
`package.json` нет — пакет не подключается как модуль, он собирается как
сайт. Опора — Astro и Starlight (документация).

Потребителей в `packages/*/src` нет.

## Подсистемы и файлы

**Страницы** — `packages/web/src/pages/`:
- `s/[id].astro` — страница опубликованной сессии;
- `[...slug].md.ts` — отдача Markdown по пути.

Страницы документации не лежат в `pages/`: их раздаёт Starlight по
конфигурации из `packages/web/src/content.config.ts` и `astro.config.mjs`
(оба — в корне пакета).

**Контент** — `packages/web/src/content/`:
- `docs/` — документация на десятках языков (`en`, `ru`, `zh-cn`, `zh-tw`,
  `ja`, `ko`, `de`, `fr`, `es`, …), темы включают `cli`, `config`, `plugins`,
  `providers`, `models`, `permissions`, `share`, `themes`, `tools`, `tui`, `zen`;
- `i18n/*.json` — переводы интерфейса сайта (18 файлов).

**Компоненты** — `packages/web/src/components/`: `Head.astro`,
`Header.astro`, `Footer.astro` — каркас страниц.

**Переводы** — `packages/web/src/i18n/locales.ts` и
`packages/web/src/middleware.ts` — определение языка и подстановка.

**Ассеты** — `packages/web/src/assets/` (логотипы `logo-dark.svg`,
`logo-light.svg`, скриншоты `lander/` и `web/`).

**Стили и типы** — `packages/web/src/styles/custom.css`,
`packages/web/src/types/lang-map.d.ts`, `packages/web/src/types/starlight-virtual.d.ts`.

## Точки входа

1. `packages/web/src/content.config.ts` — конфигурация коллекций документации,
   с неё начинается маршрутная раздача.
2. `packages/web/src/middleware.ts` — точка, где определяется язык запроса.
3. `packages/web/src/i18n/locales.ts` — список поддерживаемых локалей.
4. Скрипты пакета (`dev`, `build`) из `packages/web/package.json` — запуск
   и сборка сайта.

## На что смотреть дальше

- `packages/posts/PACKAGE.md` — второй сайт в репозитории (блог), тот же
  подход к деплою.
- `packages/theme/PACKAGE.md` — темы, которые документация описывает словами.
- `AGENTS.md` в корне репозитория — правила монорепозитория.
- `packages/console`, `packages/stats` — инфраструктура SST вокруг сайтов.

## Ловушки

1. **Строки `src/` почти не входят в статистику:** 2 649 строк — это `.ts`
   (`i18n`, `middleware`, типы), а вся документация лежит `.mdx` и в подсчёт
   `*.ts` не попадает. Цифра не отражает объём контента.
2. **Переводы разного возраста.** Переводов больше, чем обновляемых статей:
   часть `ru`/`zh-cn` страниц расходится с `en`. Сверять нужно с `en`.
3. **Маршруты документации и Markdown конфликтуют не в `pages/`.** Starlight
   раздаёт `.mdx` по конфигурации, а `pages/[...slug].md.ts` отдаёт Markdown —
   порядок разрешения задаёт Astro, а не код пакета.
4. **Starlight-типизация хрупкая:** `types/starlight-virtual.d.ts` —
   декларация поверх виртуальных модулей, правка структуры документации может
   её нарушить, и это вылезет только при сборке сайта.
