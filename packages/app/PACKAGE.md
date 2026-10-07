# @opencode/app — браузерное приложение

## Что это

Самый большой пакет: 515 файлов, ~121 тыс. строк в `src/`. Веб-приложение
opencode: домашний экран, создание сессии, рабочие пространства, настройки,
композер, панели серверов и оболочка (shell).

Собирается Vite (см. `index.html`, `manifest.json` в корне пакета) и
встраивается в desktop-приложение.

## Слои и зависимости

Слой **L6 — поверхность**: зависит от `client`, `gui-extensions`,
`schema`, `session-ui`, `ui`, `util`.

Кто подключает: `packages/desktop`, `packages/session-ui` — оба берут
части приложения. Корневой `src` — точка входа самого приложения.

Экспорт (`packages/app/package.json`):

```json
".": "./src/index.ts",
"./desktop": "./src/desktop.ts",
"./desktop-menu": "./src/shell/commands/desktop-menu.ts",
"./vite": "./vite.js",
"./index.css": "./src/index.css"
```

## Подсистемы и файлы

Каталоги `packages/app/src/`:

- `home/` — домашний экран со списком сессий;
- `new-session/` — создание сессии;
- `session/` — рабочая область сессии;
- `composer/` — ввод сообщения (композер);
- `workspaces/` — рабочие пространства;
- `servers/` — панель серверов (подключение к чужим инстансам);
- `settings/` — настройки;
- `shell/` — оболочка и команды, включая `commands/desktop-menu.ts`;
- `providers/` — Solid-провайдеры состояния;
- `runtime/` — рантайм-обвязка (включая `i18n/desktop-native.ts`);
- `app.tsx`, `entry.tsx`, `index.ts`, `index.css`, `desktop.ts`.

**Тесты** — `packages/app/component-tests/` и `packages/app/e2e/`
(E2E-прогоны), `theme-preload.test.ts` в `src/`.

## Точки входа

1. `packages/app/src/index.ts` (экспорт `"."`) — корень приложения.
2. `packages/app/src/entry.tsx` — точка входа рендера.
3. `packages/app/src/desktop.ts` (экспорт `./desktop`) — вариация для
   desktop-сборки.
4. `packages/app/src/index.css` (экспорт `./index.css`) — стили, если
   приложение встраивается без своего HTML.

## На что смотреть дальше

- `packages/session-ui/PACKAGE.md` — компоненты ленты сессии, из которых
  собран `session/session`.
- `packages/gui-extensions/PACKAGE.md` — расширения, подключаемые в
  приложении.
- `packages/ui/PACKAGE.md` — базовые компоненты.
- `packages/desktop/PACKAGE.md` — обёртка Electron.

## Ловушки

1. **`"./vite"` указывает на `vite.js` в корне пакета**, а не в `src/` —
   это хост-плагин сборки.
2. **Две точки входа (`index.ts` и `entry.tsx`)** — модуль и рендер;
   путаница между ними даёт «приложение не стартует».
3. **`desktop.ts` — не копия, а ветка поведения** для Electron: часть
   браузерного API там отключена или заменена
   (`runtime/i18n/desktop-native.ts`).
4. **E2E и component-tests лежат вне `src/`** и не входят в подсчёт строк
   пакета — но ломаются первыми при правке UI.
