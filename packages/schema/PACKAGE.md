# @opencode/schema — типы данных всего opencode

## Что это

Самый массовый по охвату пакет ядра: 102 файла, ~5.8 тыс. строк в `src/`.
Здесь объявлены все данные, которые ходят между частями opencode, — на
Effect Schema. Ни логики, ни сети, ни файлов: только типы, их валидация и
сериализация.

Пакет подключается поимённо (`exports` в `packages/schema/package.json`):

```json
".": "./src/index.ts",
"./*": "./src/*.ts"
```

## Слои и зависимости

Слой **L0 — лист**: от других пакетов `@opencode/*` не зависит (в `dependencies`
их нет), опора — `effect`.

Кто им пользуется (число файлов в `packages/*/src`, где есть импорт
`@opencode/schema`):

| Пакет | Файлов |
| --- | --- |
| `packages/core/src` | 132 |
| `packages/plugin/src` | 34 |
| `packages/protocol/src` | 30 |
| `packages/tui/src` | 16 |
| `packages/app/src` | 14 |
| `packages/cli/src` | 11 |
| `packages/ai/src` | 9 |
| `packages/client/src` | 7 |
| `packages/sdk/src` | 6 |
| `packages/plugin-browser/src` | 4 |
| `packages/server/src` | 3 |
| `packages/gui-extensions/src` | 2 |
| `packages/desktop/src` | 1 |
| `packages/enterprise/src` | 1 |

Правка здесь меняет контракт всех 14 пакетов.

## Подсистемы и файлы

**Публичное лицо** — `packages/schema/src/index.ts`: реэкспорт namespace'ов
(`Agent`, `Command`, `Config`, `Connection`, `Credential`, `Event`,
`FileSystem`, `Form`, `Integration`, `LLM`, `Location`, `Mcp`, `Model`,
`Money`, `Permission`, `Project`, `Worktree`, `Provider`, `Reference`, `Rpc`,
`Session`, `Vcs`, `Snapshot`, …).

**Сессии** — `session-id.ts`, `session-message.ts`, `session-metadata.ts`,
`session-event.ts`, `session-compaction-event.ts`, `session-error.ts`,
`session-fork.ts`, `session-revert.ts`, `session-inbox.ts`,
`session-provider-context.ts`, `session-stats.ts`, `session-transfer.ts`.

**События** — `event.ts`, `event-manifest.ts`, `durable-event-manifest.ts`,
`event-log.ts`, `server-event.ts`, `legacy-event.ts` плюс событийные
подтипы: `ide-event.ts`, `lsp-event.ts`, `mcp-event.ts`,
`installation-event.ts`, `location-event.ts`.

**Конфигурация** — `config.ts` и каталог `packages/schema/src/config/`:
`permission.ts` / `permission-v1.ts` / `permission-saved.ts`, `agent.ts`,
`command.ts`, `plugin.ts`, `question.ts` / `question-v1.ts`.

**Провайдеры и модели** — `provider.ts`, `model.ts`, `llm.ts`,
`models-dev.ts`, `credential.ts`, `money.ts`.

**Файлы и VCS** — `filesystem.ts` / `filesystem-v1.ts`, `file-diff.ts`,
`reference.ts`, `project.ts`, `project-id.ts`, `vcs.ts`, `snapshot.ts`
(поиск в имени: `snapshot` описан в `packages/schema/src`).

**Терминал и внешние сервисы** — `pty.ts`, `persistent-pty.ts`,
`pty-ticket.ts`, `mcp.ts`, `connection.ts`, `integration.ts`,
`integration-id.ts`, `instruction.ts`, `instruction-entry.ts`.

**Идентификаторы и прочее** — `identifier.ts`, `rpc.ts`, `schema.ts`,
`prompt.ts`, `prompt-input.ts`, `websearch.ts`, `form.ts`,
`session-stats.ts`.

## Точки входа

1. `packages/schema/src/index.ts` — корневой экспорт, отсюда читают все.
2. `packages/schema/src/` — поимённый доступ `@opencode/schema/<имя>` для
   одного файла без подтягивания остальных.
3. `packages/schema/src/session-id.ts` — если нужен только формат идентификатора
   сессии.

## На что смотреть дальше

- `packages/protocol/PACKAGE.md` — эти типы оборачиваются в HTTP-контракт.
- `packages/core/PACKAGE.md` — главный потребитель (132 файла), здесь же
  хранение в `database`.
- `packages/server/PACKAGE.md` — где типы валидируются на входе и выходе.
- `packages/util/PACKAGE.md` — нижний слой, на котором типы живут на диске.

## Ловушки

1. **Версии типов живут рядом.** `filesystem.ts` и `filesystem-v1.ts`,
   `permission.ts` и `permission-v1.ts`, `question.ts` и `question-v1.ts` —
   это не дубликаты, а текущая и старая схемы; перенос данных между ними
   отдельная задача.
2. **Namespace в `index.ts` не всегда совпадает с файлом:** `WebSearch`
   экспортируется из `websearch.ts`, а `Worktree` — не в одноимённом файле.
   Ищи по реэкспорту в `index.ts`, а не по имени файла.
3. **Изменение схемы требует регенерации клиента** — см.
   `packages/httpapi-codegen/PACKAGE.md`: контракт попадает в сгенерированные
   файлы `packages/client`.
4. **`-v1` суффикс — признак миграции, а не «версии пакета».** Новые поля
   добавляются в текущий файл, старый трогать нельзя: на нём стоят данные,
   уже записанные в базе.
