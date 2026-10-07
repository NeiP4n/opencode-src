# @opencode/tui — интерфейс в терминале

## Что это

TUI: 281 файл, ~62 тыс. строк в `src/` — второй по объёму пакет после
`app`. Полноценный терминальный интерфейс opencode: сессии, вкладки,
промпт, диалоги, темы, звуки внимания, интеграция с редактором.

Запускается командой `opencode tui` из `packages/cli`.

## Слои и зависимости

Слой **L6 — поверхность**: зависит от `client`, `core`, `latex`, `merman`,
`plugin`, `schema`, `simulation`, `theme`, `ui`, `util`.

Кто подключает: `packages/cli` — единственный импортёр в `src`
(плюс сам `tui` внутри себя).

Карта экспорта большая (45 путей в `package.json`), основные:

```json
".": "./src/index.tsx",
"./config": "./src/config/index.tsx",
"./context/client": "./src/context/client.tsx",
"./context/storage": "./src/context/storage.tsx",
"./mini": "./src/mini/index.ts",
"./runtime": "./src/runtime.tsx",
"./theme/discovery": "./src/theme/discovery.ts"
```

## Подсистемы и файлы

**Крупные каталоги `packages/tui/src/`** (по размеру):

| Каталог | Строк | Содержимое |
| --- | --- | --- |
| `mini/` | 18.2k | отдельный фронтенд-рантайм, запускается командой CLI `mini` |
| `component/` | 14.0k | ~50 виджетов: `dialog-*.tsx`, `session-tabs.tsx`, промпт |
| `routes/` | 8.9k | `home.tsx` и `session/index.tsx` (3610 строк) |
| `feature-plugins/` | 4.9k | `home/`, `prompt/`, `sidebar/`, `system/` |
| `context/` | 3.8k | ~30 Solid-контекстов: `client.tsx`, `data.tsx`, `permission.tsx`, `keymap.tsx`, `theme.tsx` |

**Подключение к серверу** — `packages/tui/src/context/client.tsx`
(61 строка) — единственная точка, где TUI подключается к API.

**Конфигурация** — `packages/tui/src/config/` (включая `keybind.ts`,
`v1/` для старого формата) — настройки и раскладка клавиш.

**Темы** — `packages/tui/src/theme/` (плюс экспорт `./theme/discovery`) —
работа с `@opencode/theme`.

**Редактор** — `editor.ts`, `editor-zed.ts`, `editor-zed-sqlite.bun.ts` /
`editor-zed-sqlite.node.ts` (варианты под рантайм), `context/editor.ts`.

**Звук и внимание** — `attention.ts`, `audio.ts`,
`attention-sounds.bun.ts` / `attention-sounds.node.ts`.

**Рендер** — `app.tsx`, `index.tsx`, `runtime.tsx`, каталоги `ui/`
(`dialog.tsx`, `spinner.ts`, `toast.tsx`), `component/`,
`prompt/` (`content.ts`, `display.ts`), `devtools/`, `simulation/`,
`plugin/` (плагины интерфейса, `discovery.ts`).

**Прочее** — `clipboard.ts`, `logo.ts`, `model-preference.ts`,
`parsers-config.ts` (tree-sitter парсеры), `util/` (7 файлов: `session.ts`,
`form.ts`, `string-width.ts`, `persistence.ts`, …), `terminal-win32.ts`.

## Точки входа

1. `packages/tui/src/index.tsx` (экспорт `"."`) — корень интерфейса.
2. `packages/tui/src/context/client.tsx` — подключение к серверу; менять
   здесь способ связи.
3. `packages/tui/src/runtime.tsx` (экспорт `./runtime`) — рантайм рендера.
4. `packages/tui/src/mini/index.ts` (экспорт `./mini`) — отдельный
   мини-фронтенд.
5. `packages/tui/src/config/index.tsx` (экспорт `./config`) — настройки.

## На что смотреть дальше

- `packages/cli/PACKAGE.md` — команды, запускающие TUI (`tui`, `mini`).
- `packages/theme/PACKAGE.md` — схемы тем, которые здесь применяются.
- `packages/latex/PACKAGE.md`, `packages/merman/PACKAGE.md` — рендереры
  кодовых блоков, подключаемые через плагины.
- `packages/client/PACKAGE.md` → `./solid` — источник данных.

## Ловушки

1. **`mini/` — не «урезанный TUI».** Это самостоятельный фронтенд-рантайм
   на 18 тыс. строк со своим рендером, запускаемый отдельной командой
   (`packages/cli/src/commands/handlers/mini.ts`).
2. **Рантайм-варианты рядом:** `attention-sounds.bun.ts` /
   `attention-sounds.node.ts`, `editor-zed-sqlite.bun.ts` /
   `editor-zed-sqlite.node.ts`. Правка одного не правит другой.
3. **Слой declared L6 не отражает связность:** `mini/` тянет ядро напрямую,
   мимо `context/client.tsx`. Проверяй конкретный файл.
4. **45 экспортов — не публичное API для плагинов.** Для плагинов есть
   отдельный `./plugin` и `@opencode/plugin/tui`; остальные пути —
   внутренние.
5. **`context/storage.tsx` и `component/session-tabs.tsx`** в этом дереве
   изменены локально (правки прошлой работы владельца) — не перезаписывать.
