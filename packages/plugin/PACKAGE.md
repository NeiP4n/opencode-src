# @opencode/plugin — хост расширений

## Что это

Хост плагинов opencode: 60 файлов, ~3.1 тыс. строк в `src/`. Пакет отвечает
за то, как плагин находится, загружается, перезагружается при изменении
файлов и получает доступ к ядру: сессиям, инструментам, командам, событиям,
разрешениям, MCP, навыкам.

У пакета три «лица» под разные рантаймы — промис, Effect и TUI — плюс
собственный серверный API.

## Слои и зависимости

Слой **L3**: зависит от `ai`, `client`, `protocol`, `schema`, `util`.

Кто подключает: `cli`, `core`, `gui-extensions`, `latex`, `merman`,
`sdk`, `simulation`, `tui`, `plugin-browser` и сам `plugin`.

Экспорт (`packages/plugin/package.json`):

```json
".": "./src/promise/index.ts",
"./effect": "./src/effect/index.ts",
"./host": "./src/host.ts",
"./tui": "./src/tui/index.ts",
"./*": "./src/*.ts"
```

Плюс условный импорт `#plugin-source`: на bun — `source.bun.ts`,
на node и по умолчанию — `source.node.ts`.

## Подсистемы и файлы

**Загрузчик плагина** — `packages/plugin/src/host.ts` → namespace `Host`:
типы `Target` (каталог и опциональное имя) и `Entrypoints`
(`server` / `tui` / `rpc`), функция `resolve(target)` ищет точки входа
через `resolveModule` из `@opencode/util/runtime-import`, пропуская
`ENOENT`.

**Чтение исходников** — `packages/plugin/src/source.ts` →
`createPluginSources(watch)`: берёт хеш файлов (`@opencode/util/hash`),
следит за изменениями и перезагружает только изменённый граф. Рантайм-варианты
лежат в `source.bun.ts` и `source.node.ts`, общий — `source.package.ts`.

**Серверный API плагина** — `packages/plugin/src/app.ts`: интерфейс `App`
(`name`, `version`, `channel`) и остальная часть файлов корня — `options.ts`,
`rpc.ts`, `storage.ts`, `worktree.ts`.

**Серверная поверхность (Effect)** — каталог
`packages/plugin/src/effect/`: по файлу на каждую возможность —
`session.ts`, `tool.ts`, `command.ts`, `agent.ts`, `event.ts`,
`permission.ts`, `provider.ts`, `model.ts`, `mcp.ts`, `skill.ts`,
`shell.ts`, `vcs.ts`, `worktree.ts`, `websearch.ts`, `reference.ts`,
`integration.ts`, `storage.ts`, `registration.ts`, `aisdk.ts`,
`rpc.ts`, `plugin.ts` — и `index.ts` сверху.

**Та же поверхность на промисах** — каталог
`packages/plugin/src/promise/` (зеркальный набор + `adapter.ts`,
`types.ts`), это корневой экспорт `"."`.

**TUI-поверхность** — каталог `packages/plugin/src/tui/`: `index.ts`,
`plugin.ts`, `context.ts`, `solid.ts` — что плагин может менять в
интерфейсе; экспорт `./tui`.

## Точки входа

1. `packages/plugin/package.json` → `"."` — `Plugin.define(...)`, так
   плагин пишется по умолчанию (промис-вариант).
2. `packages/plugin/src/effect/index.ts` — тот же API на `effect`
   (`@opencode/plugin/effect`).
3. `packages/plugin/src/host.ts` → `Host.resolve(...)` — поиск точек входа
   плагина на диске.
4. `packages/plugin/src/tui/index.ts` — регистрация в интерфейсе
   (именно его используют `latex`, `merman`).

## На что смотреть дальше

- `packages/core/PACKAGE.md` — где хост встраивается в сессию
  (`plugin/host.ts` и `plugin/internal.ts` собирают графы).
- `packages/latex/PACKAGE.md`, `packages/merman/PACKAGE.md`,
  `packages/plugin-browser/PACKAGE.md` — три реальных плагина как примеры.
- `packages/util/PACKAGE.md` — `runtime-import`, на котором стоит загрузка.
- `packages/ai/PACKAGE.md` — `@ai-sdk/provider` и инструменты модели.

## Ловушки

1. **Три варианта API не взаимозаменяемы.** `"."` — промисы,
   `"./effect"` — Effect, `"./tui"` — интерфейс. Плагин на `Plugin.define`
   из `@opencode/plugin/tui` и плагин из `@opencode/plugin/effect` —
   разные форматы (`id` + `setup` против `id` + `effect`).
2. **`#plugin-source` выбирается сборщиком.** Код, написанный под
   `source.bun.ts`, на node получит `source.node.ts` — поведение горячей
   перезагрузки отличается.
3. **Хеши в `source.ts` держат отслеживание.** Если перезагрузка не
   срабатывает, причина обычно в том, что хеш файла не изменился — watch
   отрабатывает, а перезагрузка не нужна.
4. **`host.ts` молча пропускает отсутствующие точки входа** (`ENOENT` —
   нормальный путь). Плагин без `tui`-точки входа не упадёт, а просто
   ничего не покажет в интерфейсе.
