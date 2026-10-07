# @opencode/server — HTTP-сервер opencode

## Что это

Транспортный слой: 52 файла, ~3.9 тыс. строк в `src/`. Пакет монтирует
контракт `protocol` на Effect `HttpApiBuilder`, реализует эндпоинты хендлерами
из `core` и отдаёт поток событий по SSE. Здесь нет бизнес-логики — она
в ядре; здесь — маршруты, авторизация, опции сервера и интеграция слоёв.

## Слои и зависимости

Слой **L5 — транспорт**: зависит от `core`, `protocol`, `schema`,
`simulation`, `util`.

Кто подключает: `cli` (запуск сервера), `sdk`, `session-ui` (прямые
вызовы), сам `server`.

Экспорт только поимённый: `"./*": "./src/*.ts"` — корня нет.

## Подсистемы и файлы

**Сборка API** — `packages/server/src/routes.ts`, строка 176:
`HttpApiBuilder.layer(Api, ...)` монтирует контракт; ниже идёт
`Layer.provide` с авторизацией, обработкой ошибок и ~35 слоями ядра.
Это центральный файл пакета.

**Хендлеры** — `packages/server/src/handlers/`, 32 файла, почти 1:1 с
группами `protocol`: `session.ts`, `message.ts`, `generate.ts`, `model.ts`,
`provider.ts`, `event.ts`, `permission.ts`, `form.ts`, `fs.ts`,
`command.ts`, `skill.ts`, `rpc.ts`, `agent.ts`, `plugin.ts`, `server.ts`,
`debug.ts`, `pty.ts`, `pty-socket.ts`, `persistent-pty.ts`, `shell.ts`,
`reference.ts`, `location.ts`, `integration.ts`, `websearch.ts`, `mcp.ts`,
`credential.ts`, `config.ts`, `vcs.ts`, `worktree.ts`, `project.ts`,
`migration.ts`, `session-error.ts`. Сводный файл —
`packages/server/src/handlers.ts`.

**Авторизация** — `packages/server/src/auth.ts`: авторизация, пары
(pairing), привязка портов и адреса сервера.

**События** — `packages/server/src/event-feed.ts` — SSE-поток, через
который интерфейс получает обновления.

**Middleware** — каталог `packages/server/src/middleware/`:
`authorization.ts`, `schema-error.ts`, `session-location.ts`,
`form-location.ts`.

**Опции и окружение** — `options.ts`, `cors.ts`, `fetch.ts`,
`request-tracing.ts`, `process.ts`, `pty-environment.ts`,
`server-info.ts`, `service-status.ts`, `location.ts`, `api.ts`.

**Альтернативный рантайм** — `packages/server/src/workerd.ts` (сборка
под Cloudflare), скрипт `probe:workerd` проверяет его.

## Точки входа

1. `packages/server/src/routes.ts` → слой `Api` — монтаж всего API.
2. `packages/server/src/auth.ts` — как получить доступ к серверу (токены,
   pairing).
3. `packages/server/src/event-feed.ts` — подписка на события (SSE).
4. `packages/server/src/handlers/` — реализация конкретной группы
   эндпоинтов.

## На что смотреть дальше

- `packages/protocol/PACKAGE.md` — контракт, который здесь реализуется.
- `packages/core/PACKAGE.md` — слои, подключаемые через `Layer.provide`.
- `packages/client/PACKAGE.md` — потребитель API на клиенте.
- `packages/cli/src/services/service-config.ts` — каналы и порты службы.

## Ловушки

1. **Корневого экспорта нет.** Импорт вида `@opencode/server` невозможен,
   только `@opencode/server/routes` и т. п.
2. **`routes.ts` не читается линейно.** Хендлеры объявлены отдельно
   (`handlers/`), монтаж — отдельно; «эндпоинта нет» обычно значит, что
   группа не подключена в `Layer.provide`.
3. **`simulation` — зависимость не для тестов.** `simulationReplacements`
   подмешиваются в сборку при включённом режиме симуляции — по этому пути.
4. **PTY ходит отдельным сокетом** (`handlers/pty-socket.ts`), а не через
   обычный HTTP; проблемы терминала ищутся там, а не в `pty.ts`.
5. **`workerd.ts` — не дубликат, а другой рантайм.** Правка `routes.ts`
   требует проверки и его (`bun run probe:workerd`).
