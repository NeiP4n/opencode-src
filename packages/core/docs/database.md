# core/database — доступ к SQLite на Drizzle и Effect: сервис базы, адаптеры рантаймов, миграции и перенос данных V1 → V2

## Что в папке

77 файлов `.ts` в четырёх слоях:

- сервис и запуск: `database.ts`, `sqlite.ts`, `sqlite.bun.ts`, `sqlite.node.ts`, `sqlite.workerd.ts`.
- типы колонок и общие куски схемы: `path.ts`, `schema.sql.ts`.
- форк Drizzle под Effect: `drizzle.ts`, `drizzle/index.ts`, `drizzle/effect-sqlite/`, `drizzle/internal/`, `drizzle/sqlite-core/effect/`.
- миграции и перенос данных: `migration.ts`, `migration.gen.ts`, `schema.gen.ts`, `migration/`, `v1-migration.ts`, `v1-migration.bun.ts`, `v1-migration.noop.ts`.

## Ключевые файлы

- `database.ts` — сервис `Database.Service` (токен `@opencode/storage/Database`, `Interface` с полем `db`), слои `layer`, `layerFromClient`, `configured`, `configuredClient`, `node`; прагмы при старте, `restrictToOwner`, семафоры по пути файла.
- `sqlite.ts` — общий каркас адаптеров: сервис `Sqlite.Native`, `makeConnection`, `makeClient` (семафор, `acquirer`, `transactionAcquirer`, `spanAttributes` с `db.system.name = sqlite`).
- `sqlite.bun.ts`, `sqlite.node.ts`, `sqlite.workerd.ts` — три реализации поверх `bun:sqlite`, `node:sqlite` и хранилища Durable Object; каждая объявляет `supportsTuningPragmas` и `supportsForeignKeyToggle`.
- `migration.ts` — `apply` и `applyOnly`, ведение журнала в таблице `migration`, перенос отметок из `__drizzle_migrations`.
- `migration.gen.ts` — массив `migrations` из 48 миграций (`m00`…`m47`), порядок применения.
- `migration/` — 58 файлов миграций, каждый экспортирует `{ id, foreignKeys?, up }` и выполняет SQL через `tx.run`.
- `schema.gen.ts` — bootstrap-схема целиком: 19 таблиц и 16 индексов, одной функцией `up`.
- `v1-migration.bun.ts` — перенос V1-базы (таблицы `message`, `part`) в V2 (`session_message`), плюс импорт соседнего `opencode-next.db`.
- `path.ts` — колонки `absoluteColumn`, `directoryColumn`, `pathColumn`, `absoluteArrayColumn`.
- `schema.sql.ts` — `Timestamps` с `time_created` и `time_updated`.
- `drizzle/effect-sqlite/driver.ts` — `make` и `makeWithDefaults`, `DefaultServices`.
- `drizzle/effect-sqlite/session.ts` — `EffectSQLiteSession`, `EffectSQLiteTransaction`, `managesTransactionsNatively`.
- `drizzle/sqlite-core/effect/` — билдеры `select`, `insert`, `update`, `delete`, `count`, `query`, `raw`, `session`, `db`.
- `drizzle/internal/drizzle-utils.ts` — работа с приватными символами Drizzle и JIT-проверка среды.

## Важные детали

- Старт файловой базы: при `supportsTuningPragmas` выполняются `PRAGMA journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout = 5000`, `cache_size = -64000`, `wal_checkpoint(PASSIVE)`; при `supportsForeignKeyToggle` — `PRAGMA foreign_keys = ON`. Дальше под локом применяются миграции.
- Лок базы привязан к конкретной базе, а не к модулю: файловые базы делят семафор по пути из `Map`, `:memory:` получает свой. Причина в комментарии — в workerd у всех объектов изолята общее состояние модуля, и освобождение общего семафора будит ожидающий fiber в контексте чужого I/O.
- `restrictToOwner` выставляет `0600` на файл и на `-wal`/`-shm`; на win32 ничего не делает. Отсутствующий файл создаётся синхронно (`openSync`/`closeSync`), иначе другое волокно успеет его открыть; комментарий отмечает, что открытие и закрытие готовой базы снимают POSIX-блокировки чужого соединения.
- `apply` выбирает ветку по таблице `session` или `session_v2`: если такой таблицы нет и база непустая — `Effect.die` с сообщением «Database is not empty and has no session table»; если таблиц нет вообще — выполняется полный bootstrap: `schema.gen.ts`, таблица `migration` и отметка всех миграций сразу. Системные таблицы и имена с ведущим подчёркиванием игнорируются — namespace без префикса принадлежит OpenCode.
- `applyOnly` при пустом журнале один раз переносит отметки из `__drizzle_migrations`: либо напрямую из колонки `name`, либо сопоставляя `created_at` с префиксом `id` вида `ГГГГММДДЧЧММСС`; несовпадение — `Effect.die`. Дальше каждая незаписанная миграция выполняется в транзакции вместе с записью её `id` и временем.
- Миграции с `foreignKeys: false` идут с ослаблением проверки: `PRAGMA foreign_keys = OFF` там, где переключение разрешено, иначе `PRAGMA defer_foreign_keys = ON`, с восстановлением в `ensuring`.
- Миграция `20260804233008_loose_psylocke` — развилка: при наличии в журнале маркера `20260730195856_optional_session_title` она переименовывает `session` в `session_v2` на месте (проверяя, что нет V1-истории без V2-проекции), иначе собирает весь V2-набор таблиц и индексов.
- Миграция `20260805200742_import_legacy_credentials` читает `auth.json` из `Global.data`, переносит записи `oauth`, `api`, `wellknown` в `credential`, а источники wellknown складывает в `kv` по ключу `wellknown:sources`; метод OAuth выбирается по имени интеграции: `openai` → `chatgpt-browser`, `github-copilot`, `opencode`, `xai` → `device`, иначе `oauth`.
- `schema.gen.ts` создаёт `account`, `account_state`, `control_account`, `credential`, `event`, `event_sequence`, `kv`, `permission`, `project`, `project_directory`, `instruction_blob`, `instruction_entry`, `instruction_state`, `session_inbox`, `session_message`, `session_pending`, `session_v2`, `workspace`, `worktree`. Уникальные индексы: `event_aggregate_seq_idx`, `session_message_session_seq_idx`, `session_pending_session_admitted_seq_idx`, `session_inbox_session_enqueued_seq_idx`, `permission_project_action_resource_idx`. Частичные: `session_pending_session_compaction_idx` (по `type = 'compaction'`) и `session_v2_time_suspended_idx`.
- `v1-migration.bun.ts` считает миграцию нужной по наличию таблицы `session` в `sqlite_master`; состояние лежит в `kv` по ключу `migration.v1-v2` с курсором по `session.id`. Старая таблица `event` чистится порциями по 1000 строк. `transformSession` собирает сообщения типов `user`, `assistant`, `compaction`, `synthetic`, `system`, проставляет `seq` и водяной знак в `event_sequence`; битые строки не роняют перенос, а попадают в `warnings` и в лог. Переименования инструментов V1 → V2: `bash` → `shell`, `task` → `subagent`, `apply_patch` → `patch`, аргумент `filePath` → `path`, у `skill` аргумент `name` → `id`, старый инструмент списка дел упразднён; о переименованиях, встреченных в видимой истории, добавляется системное сообщение.
- Импорт `opencode-next.db` идёт только для чтения, проверяет наличие `project`, `session`, `session_message`, а отсутствующие колонки проецирует через fallback или `NULL` (`icon_url_override` берётся из `icon_url`).
- `path.ts`: `absolute` бросает исключение на не-абсолютном пути и понимает windows-пути на любой ОС; `directoryColumn` пропускает пустую строку ради легаси-сессий; `pathColumn` только меняет разделители; `absoluteArrayColumn` хранит JSON-массив и декодирует синхронной схемой.
- Bun и Node читают целые по-разному: Bun — `statement.safeIntegers`, Node — `setReadBigInts` плюс `setReturnArrays(true)` для запросов значениями; оба берут флаг из сервиса `SqlClient.SafeIntegers`. В workerd этот флаг игнорируется, а `ArrayBuffer` из blob приводится к `Uint8Array`.
- workerd-клиент помечен `transactionStatements: false`, поэтому сессия Drizzle не шлёт `BEGIN`/`COMMIT`/`SAVEPOINT`, а зовёт `withTransaction` поверх `storage.transaction`; вложенные транзакции — ошибка. В обычной сессии вложенность сделана через savepoint с ростом номера и честным `rollback to savepoint`.
- Форк Drizzle: каждый класс-билдер в конце файла проходит через `applyEffectWrapper`, поэтому билдер сам является `Effect`. В `SQLiteEffectPreparedQuery` результат маппится JIT-маппером либо построчно; внутри транзакции кеш всегда выключен; ошибка оборачивается в `EffectDrizzleQueryError`. `SQLiteEffectTransaction.rollback()` возвращает `EffectTransactionRollbackError`.
- `drizzle/internal/drizzle-utils.ts` достаёт приватные данные Drizzle через символы `Columns`, `IsAlias`, `Name`, `BaseName` и `ViewBaseConfig`; `jitCompatCheck` выключает JIT-мапперы, если в среде запрещён `new Function`.

## Связи

- Условия импортов заданы в `packages/core/package.json`: `#sqlite` → `sqlite.workerd.ts`, `sqlite.bun.ts`, `sqlite.node.ts` (по умолчанию node), `#v1-migration` → полная реализация только для bun, `v1-migration.noop.ts` для node и workerd.
- `database.ts` → `drizzle.ts` → `drizzle/index.ts` → `drizzle/effect-sqlite/driver.ts` и `session.ts` → `drizzle/sqlite-core/effect/session.ts` → `drizzle/sqlite-core/effect/db.ts` и остальные билдеры → `drizzle/internal/drizzle-utils.ts`.
- `database.ts` → `migration.ts` → `migration.gen.ts` → `migration/`; `migration.ts` → `schema.gen.ts` и `#sqlite` за флагом `supportsForeignKeyToggle`.
- `v1-migration.bun.ts` → `session/sql.ts`, `kv/sql.ts`, `event/sql.ts`, `session/schema.ts`, `session/message.ts`, `@opencode/schema/session-v1`, `@opencode/schema/project`.
- Колонки из `schema.sql.ts` и `path.ts` используют `account/sql.ts`, `credential/sql.ts`, `kv/sql.ts`, `permission/sql.ts`, `project/sql.ts`, `session/sql.ts`.
- Сервис `Database.Service` потребляют `bus.ts`, `credential.ts`, `kv.ts`, `project.ts`, `session.ts` и файлы `session/`: `session/compaction.ts`, `session/context.ts`, `session/diff.ts`, `session/execution.ts`, `session/generate.ts`, `session/history.ts`, `session/inbox.ts`, `session/instruction-entry.ts`, `session/move.ts`, `session/projector.ts`, `session/revert.ts`, `session/session.ts`, `session/stats.ts`, `session/store.ts`, `session/runner/llm.ts`.

## Ловушки

- `#sqlite` и `#v1-migration` резолвятся по рантайму: новый файл адаптера без записи в `packages/core/package.json` в сборку не попадёт.
- В workerd запрещены `journal_mode`, `synchronous`, `busy_timeout`, `cache_size`, `wal_checkpoint` и `foreign_keys`. Настраивать их можно только через флаги `supportsTuningPragmas` и `supportsForeignKeyToggle`.
- В workerd `sql.exec` отвергает `BEGIN`, `COMMIT` и `SAVEPOINT`: транзакция идёт только через `withTransaction`, вложенные транзакции не поддержаны вовсе.
- workerd-адаптер не умеет открывать файл. Для Durable Object нужен `Database.layerFromClient` вместе со `sqliteLayer({ storage })`; попытка дать путь умирает с объяснением в `Effect.die`.
- `runValues` в node требует `setReturnArrays(true)`: без флага значения приходят не массивами, и результат уезжает в типизацию.
- SQLite создаёт сайдкары с правами базы, но уже существующие не ужесточает — поэтому `restrictToOwner` chmod-ит и `-wal`, и `-shm`, а отсутствующий файл создаёт синхронно перед правами.
- Семафор из `locks` нельзя делать общим на модуль: в workerd освобождение будит ожидающий fiber в чужом контексте I/O, и его первый вызов storage отклоняется как cross-object I/O.
- `apply` умирает на непустой базе без таблицы `session`: это чужая база или не та схема.
- `id` миграции равен имени файла, а прогон определяется журналом: переименование файла заставит выполнить его повторно, а откатить уже применённые миграции нельзя.
- Часть миграций необратимо стирает данные: `20260603040000_session_message_projection_order` удаляет `session_message`, `20260604172448_event_sourced_session_input` чистит `session_input`, `session_message`, `event`, `event_sequence` и `workspace`, `20260622202450_simplify_session_input` — то же. Миграция `20260603141458` с автоинкрементом заменяется таблицей без него.
- Порядок применения задаётся только массивом `migrations` в `migration.gen.ts`: новый файл нужен и импортом, и элементом массива.
- `insert`, `update`, `delete` без `returning()` дают результат запуска; `all()`, `get()`, `values()` без `returning()` — ошибка типа `DrizzleTypeError`.
- Внутри транзакции кеш запросов всегда отключён: читать свежее состояние, а не кеш.
- `jitCompatCheck` гасит JIT-мапперы, если среда запрещает `new Function`; в этом режиме строки маппит `mapResultRow` — медленнее, но корректно.
- `drizzle/internal/drizzle-utils.ts` и весь `drizzle/sqlite-core/effect/` идут с `/* oxlint-disable */`: линтер здесь молчит, ошибки ловит только проверка типов. Плюс приватные символы Drizzle надо перепроверять после обновления `drizzle-orm`.
- Статус V1-переноса выводится из наличия таблицы `session`, а на node и workerd всегда «completed»: там работает заглушка, а не перенос.
- `directoryColumn` терпит пустую строку, `absoluteColumn` — нет: относительное значение из легаси-данных приведёт к исключению при записи.
- В базе пути лежат со слэшами независимо от ОС, а `toPlatform` превращает их в обратные слэши только на Windows при чтении.
