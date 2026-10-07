# @opencode/core — ядро opencode

## Что это

Сердце системы: 431 файл, ~65 тыс. строк в `src/` (плюс ~96 тыс. строк
тестов в `core/test/` — логика живёт в `src/`). Здесь всё, что делает
opencode opencode: сессии, инструменты модели, провайдеры, разрешения,
база данных, конфигурация, плагины, файловая система, git, MCP, навыки.

Слой `server` монтирует эти подсистемы в HTTP-API, а `tui` показывает их
пользователю; сам `core` о них ничего не знает.

## Слои и зависимости

Слой **L4 — ядро**: зависит от `ai`, `codemode`, `plugin`,
`plugin-browser`, `schema`, `util`.

Кто подключает: `server`, `cli`, `sdk`, `tui`, `simulation`, `client`
(тесты), `enterprise`.

## Подсистемы и файлы

**Сборка графа** — `packages/core/src/instance.ts`, строка 114:
`export const graph = LayerNode.group(nodes)` — точка сборки зависимостей
ядра. Ещё два похожих графа собирают требования плагинов:
`packages/core/src/plugin/host.ts` (строка 574) и
`packages/core/src/plugin/internal.ts` (строка 160).

**Шина событий** — `packages/core/src/bus.ts` (908 строк) — реальный
движок событий. Каталог `packages/core/src/event/` содержит только
`sql.ts` (таблица), не ищи логику там.

**База данных** — каталог `packages/core/src/database/` (77 файлов).
Три рантайм-варианта: `sqlite.bun.ts`, `sqlite.node.ts`,
`sqlite.workerd.ts` — правка одного не правит остальные.

**Сессии** — `packages/core/src/session.ts` (483 строки) и каталог
`packages/core/src/session/` (49 файлов): жизненный цикл, сообщения,
fork/revert, компакция, инбокс.

**Инструменты** — `packages/core/src/tool.ts` (332 строки) и каталог
`packages/core/src/tool/` (20 файлов): `bash`, `edit`, `read`, `write`,
`grep`, `glob`, `patch`, `task`, `todowrite`, `webfetch`, `lsp`, `skill`,
`session`, `snapshot`, `formatter`, `filesystem`, `instruction`,
`credential`, `job`, `kv`, `codemode`, `effect`.

**Плагины ядра** — каталог `packages/core/src/plugin/` (67 файлов):
`host.ts`, `internal.ts` (графы), плюс хосты инструментов и регистраций.

**Конфигурация** — `packages/core/src/config.ts` (374 строки) и каталог
`packages/core/src/config/` (26 файлов): схемы конфига, агентов, команд,
вопросов.

**Провайдеры и модели** — `provider.ts` (468), `model.ts` (299),
`model-resolver.ts` (470), `models-dev.ts` (439), каталог
`github-copilot/` (24 файла), `oauth/`, `credential.ts`.

**Вызов модели** — `aisdk.ts` (1082 строки) и `aisdk-native.ts` (321)
— мост к AI SDK.

**Файлы и поиск** — `filesystem.ts` + каталог `filesystem/` (11 файлов:
`watcher.ts`, `search.ts`, `ignore.ts`, `protected.ts`, `fff.ts`),
`ripgrep.ts`, `file-access.ts`, `file-mutation.ts`, `file-retention.ts`.

**Git** — `git.ts` (758 строк), `snapshot.ts` (снапшоты файлов
`capture|files|diff|restore`), `repository.ts`, `repository-cache.ts`,
каталоги `vcs/`, `worktree/`.

**Разрешения** — `permission.ts` (347) + `permission/` (включая
`permission/saved.ts`), `managed-policy.ts`.

**Разное** — `shell.ts` (455), `job.ts` (482), `kv.ts`, `form.ts` (370),
`instruction-discovery.ts` (поиск AGENTS.md по дереву) +
`instructions/` (сборка и хеширование в системный промпт),
`skill.ts` + `skill/`, `mcp/`, `pty.ts` + `pty/` + `persistent-pty/`,
`websearch.ts`, `image.ts`, `location*.ts`, `project.ts`, `workspace.ts`,
`variant.ts` (608), `rpc.ts` (289), `bus.ts`.

**Прочее** — `effect/` (хелперы слоёв), `environment/`, `util/`, `id/`,
`modal/`, `v1/` (16 файлов миграций), `account/` (мёртвый код — импортов
ноль).

## Точки входа

1. `packages/core/src/instance.ts` → `graph` — сборка всех слоёв ядра.
2. `packages/core/src/config.ts` — чтение и валидация конфигурации.
3. `packages/core/src/session.ts` — работа с сессиями.
4. `packages/core/src/tool.ts` — реестр инструментов.
5. `packages/core/src/bus.ts` — подписка на события ядра.

## На что смотреть дальше

- `packages/server/PACKAGE.md` — как эти слои становятся HTTP-API.
- `packages/protocol/PACKAGE.md` и `packages/schema/PACKAGE.md` — контракт
  и типы.
- `packages/ai/PACKAGE.md` — провайдеры, которые `aisdk.ts` вызывает.
- `packages/plugin/PACKAGE.md` — как расширять ядро без правки его кода.
- `packages/core/test/session-runner-recorded.test.ts` — пример прогона
  сессии с записью трафика.

## Ловушки

1. **Папка не равна подсистеме.** `provider/`, `event/`, `credential/`,
   `permission/` — это одиночные `.ts` рядом с одноимёнными каталогами,
   которые существуют ради `sql.ts`. Ищи файл, а не папку.
2. **События — в `bus.ts`, а не в `event/`.** `event/sql.ts` — только
   таблица для журнала.
3. **Три рантайма базы:** `sqlite.bun.ts` / `sqlite.node.ts` /
   `sqlite.workerd.ts`. Правка одного не переносится на другие.
4. **`test/` больше `src/`.** 96.5 тыс. строк тестов против 65 тыс.
   логики — не ищи реализацию в тестах.
5. **`account/sql.ts` — мёртвый код:** импортов ноль, таблица существует
   отдельно в `console/core/src/schema/account.sql`.
6. **`node-ffi.d.ts` и `markdown.d.ts` — декларации типов**, а не код;
   `models-dev/` пуст (логика в `models-dev.ts`).
