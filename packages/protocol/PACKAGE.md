# @opencode/protocol — контракт HTTP-API

## Что это

Контракт API opencode: 36 файлов, ~4.2 тыс. строк в `src/`. Пакет описывает
все эндпоинты сервера (методы, параметры, типы ответов и ошибок) на
Effect `HttpApi`. Здесь нет ни реализации хендлеров, ни логики ядра —
только объявление того, что сервер обязан уметь.

`packages/protocol/src/api.ts` собирает один `Api` из групп в
`packages/protocol/src/groups/` — по одной группе на область REST.

## Слои и зависимости

Слой **L1**: зависит от `schema` (типы данных). Других пакетов
`@opencode/*` в зависимостях нет.

Кто подключает:

- `packages/server` — монтирует `Api` в хендлеры;
- `packages/client` — генерирует клиент по тому же контракту;
- `packages/plugin` — читает типы контракта;
- `packages/simulation` — использует контракт в симуляции.

Экспорт поимённый: `"./*": "./src/*.ts"` плюс отдельный
`"./simulation": "./src/simulation.ts"`.

## Подсистемы и файлы

**Сборка контракта** — `packages/protocol/src/api.ts`: импортирует все
группы (`GenerateGroup`, `MessageGroup`, `ModelGroup`, `ProviderGroup`,
`makeSessionGroup`, `makePermissionGroup`, `FileSystemGroup`, `makeFormGroup`,
`CommandGroup`, `SkillGroup`, `RpcGroup`, `EventGroup`, `AgentGroup`,
`PluginGroup`, `ServerGroup`, `DebugGroup`, `PtyGroup`,
`PersistentPtyGroup`, `ShellGroup`, `ReferenceGroup`, `makeLocationGroup`,
`IntegrationGroup`, `WebSearchGroup`, `McpGroup`, `CredentialGroup`, …) и
склеивает их в единый `HttpApi`.

**Группы эндпоинтов** — каталог `packages/protocol/src/groups/`, 30 файлов:
`session.ts`, `message.ts`, `generate.ts`, `model.ts`, `provider.ts`,
`event.ts`, `permission.ts`, `form.ts`, `fs.ts`, `command.ts`, `skill.ts`,
`rpc.ts`, `agent.ts`, `plugin.ts`, `server.ts`, `debug.ts`, `pty.ts`,
`persistent-pty.ts`, `shell.ts`, `reference.ts`, `location.ts`,
`integration.ts`, `websearch.ts`, `mcp.ts`, `credential.ts`, `config.ts`,
`project.ts`, `vcs.ts`, `worktree.ts`, `migration.ts` — 30 файлов.

**Авторизация и ошибки** — каталог
`packages/protocol/src/middleware/`: `authorization.ts` (проверка доступа),
`schema-error.ts` (приведение ошибок валидации к формату API).

**Остальное** — `packages/protocol/src/client.ts` (тип клиентской стороны),
`packages/protocol/src/errors.ts` (ошибки контракта),
`packages/protocol/src/simulation.ts` (контракт симуляции, экспорт
`./simulation`).

## Точки входа

1. `packages/protocol/src/api.ts` → `Api` — единый контракт, с него
   начинается и сервер, и генерация клиента.
2. `packages/protocol/src/groups/` — конкретная группа эндпоинтов, если
   нужен раздел API целиком.
3. `packages/protocol/src/middleware/authorization.ts` — как проверяется
   доступ к запросу.

## На что смотреть дальше

- `packages/server/PACKAGE.md` — реализация контракта (`HttpApiBuilder`).
- `packages/client/PACKAGE.md` — сгенерированный клиент по этому контракту.
- `packages/httpapi-codegen/PACKAGE.md` — генератор, который превращает
  `Api` в файлы клиента.
- `packages/schema/PACKAGE.md` — типы, из которых контракт собран.

## Ловушки

1. **`protocol` не содержит логики.** Если эндпоинт «не работает», смотреть
   нужно в `server`, здесь только объявление.
2. **Правка `Api` требует регенерации клиента** — `bun run generate` из
   `packages/client`; иначе типы клиента расходятся с сервером.
3. **Группы бывают двух стилей:** готовые (`MessageGroup`) и фабрики
   (`makeSessionGroup(...)`), потому что часть эндпоинтов зависит от
   переданных опций. Не удивляйся вызову-функции в `api.ts`.
4. **Поимённый экспорт вместо корня:** `exports` не содержит `"."`,
   подключаются только пути `@opencode/protocol/<файл>` и
   `@opencode/protocol/simulation`.
