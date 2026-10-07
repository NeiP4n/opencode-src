# core/project — схема и таблица проекта, плюс перенос старой таблицы каталогов

## Что в папке

- `schema.ts` — локальные схемы поверх `@opencode/schema/project` и собственная схема `Vcs`.
- `sql.ts` — таблица `project`, помеченная устаревшей таблица `project_directory` и функция `upsertProject`.
- Логики работы с проектом в папке нет: она в корневом `packages/core/src/project.ts`.

## Ключевые файлы

- `packages/core/src/project/schema.ts` — `ProjectSchema` с `ID`, `Current`, `Info`, `UpdateInput`, `Event`, `Vcs`.
- `packages/core/src/project/sql.ts` — `ProjectTable`, `ProjectDirectoryTable`, `upsertProject`.

## Важные детали

- `ProjectTable`: `id` (тип `ProjectSchema.ID`), `worktree` — колонка пути через `absoluteColumn()`, `vcs` — тип `ProjectSchema.Vcs["type"]`, `name`, `icon_url`, `icon_url_override`, `icon_color`, `time_initialized`, `time_active`, `sandboxes` и `commands`.
- `worktree` — единственная непустая по смыслу колонка идентичности проекта: путь, а не имя. Имя и иконки — необязательные украшения.
- `time_active` объявлен `.notNull().default(0)` с `$defaultFn(() => Date.now())`. Значение по умолчанию в SQLite и значение по умолчанию в TypeScript расходятся: первое записывается базой при отсутствии поля, второе подставляется драйвером до отправки.
- `sandboxes` — `absoluteArrayColumn()`, то есть массив путей, а не JSON-строка в общем виде; типы колонок берутся из `packages/core/src/database/path.ts`.
- `commands` — `text({ mode: "json" })` с типом `{ start?: string }`: на самом деле хранится одна опция, и имя колонки во множественном числе вводит в заблуждение.
- `ProjectSchema.Vcs` — `Schema.Struct({ type: Project.Vcs, store: AbsolutePath })`: тип системы контроля версий плюс путь к её хранилищу. Это единственная схема, добавленная в папке сверх переэкспортов схемы.
- `ProjectDirectoryTable` помечена `@deprecated` с указанием замены: `WorktreeTable` из `packages/core/src/worktree/sql.ts`. Её составной первичный ключ `(project_id, directory)` выражает старую модель «у проекта много каталогов».
- `upsertProject` принимает и клиент базы, и транзакцию: тип `Transaction` выведен из сигнатуры `transaction` у клиента, а не объявлен вручную.
- Логика `upsertProject` асимметрична: при заданном `vcs` условие обновления требует, чтобы в базе было `NULL` или другое значение, а при незаданном `vcs` — чтобы значение уже было. То есть отсутствие `vcs` в аргументе означает «очистить признак», а не «не трогать».

## Связи

- `packages/core/src/project.ts` — корень подсистемы: читает и пишет `ProjectTable`.
- `packages/core/src/permission/sql.ts` — объявляет внешний ключ на `ProjectTable.id` с каскадным удалением.
- `packages/core/src/session/sql.ts` и `packages/core/src/session/projector.ts` — ссылаются на `ProjectTable` при работе с сессиями.
- `packages/core/src/worktree.ts` и `packages/core/src/worktree/sql.ts` — новое место хранения соответствия «проект ↔ каталог», вытеснившее `ProjectDirectoryTable`.
- `packages/schema/src/project.ts` — источник `Project.ID`, `Project.Current`, `Project.Info`, `Project.UpdateInput`, `Project.Event` и `Project.Vcs`.
- `packages/core/src/schema.ts` — источник `AbsolutePath`, базового типа всех колонок-путей.
- `packages/core/src/database/path.ts` — реализация `absoluteColumn()` и `absoluteArrayColumn()`.

## Ловушки

- `upsertProject` обновляет только поле `vcs`. Уже записанный `worktree` при повторном вызове не меняется, даже если в аргументе передан другой `canonical` — расхождение пути и ID останется незамеченным.
- Семантика `vcs` несимметрична: передать «без изменений» нельзя, только «поставить значение» или «очистить».
- Имя колонки `commands` во множественном числе при единственном поле `start` — при добавлении опций легко получить форму, которую старые базы читать не смогут.
- `ProjectDirectoryTable` объявлена, но помечена устаревшей. Пользоваться ею — значит писать в таблицу, которую код на новых схемах не читает.
- Разные имена полей времени в одном файле: у `ProjectTable` это `time_created`/`time_updated`/`time_initialized`/`time_active` из разных наборов, поэтому правило «время называется time_*» здесь выдержано, а правило «время приходит из Timestamps» — нет.
