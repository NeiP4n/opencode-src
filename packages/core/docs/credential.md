# core/credential — хранение учётных данных интеграций в SQLite

## Что в папке

- `sql.ts` — единственный файл: схема таблицы `credential` на drizzle-orm sqlite.
- Рантайм-логики в папке нет: чтение и запись живут в корневом `packages/core/src/credential.ts`.

## Ключевые файлы

- `packages/core/src/credential/sql.ts` — `CredentialTable`.
- `packages/core/src/credential.ts` — сервис, который читает и пишет эту таблицу.

## Важные детали

- Колонки таблицы: `id` (primary key, тип `Credential.ID` из `packages/core/src/credential.ts`), `integration_id`, `label`, `value`, `connector_id`, `method_id`, `active`, плюс общий набор `Timestamps` из `packages/core/src/database/schema.sql.ts`.
- `value` — колонка `text({ mode: "json" })` с типом `Credential.Value`: секрет лежит как JSON-значение, а не как строка. Тип приходит `import type`-ом, то есть на этапе построения таблицы это только аннотация колонки.
- `label` объявлен `.notNull()`, а `integration_id`, `connector_id`, `method_id` и `active` — без обязательности. `active` при этом `integer({ mode: "boolean" })`, то есть принимает значения 0/1 и может быть `null`: в SQLite это не то же самое, что `false`.
- Схема читает только типы и ничего не импортирует сервисы: единственная зависимость папки — `packages/core/src/database/schema.sql.ts` (набор `Timestamps`).
- Таблица объявлена в терминах сущностей ядра (`Credential.ID`, `Credential.Value`), а не в терминах прикладного домена. Схема таблицы не знает, что такое интеграция и чем она авторизуется.

## Связи

- `packages/core/src/credential.ts` — единственный потребитель `CredentialTable` (проверено поиском по имени таблицы по `packages/core/src`).
- `packages/core/src/config.ts` — подписан на `Credential.Event.Switched` и перечитывает конфиг, когда сменилась учётная запись интеграции, участвующей в wellknown-конфиге.
- `packages/core/src/config.ts` — при загрузке wellknown-записи берёт последнюю учётную запись интеграции и требует, чтобы `credential.value.type === "key"`: записи других типов конфиг не подменяют.
- `packages/core/docs/permission.md` — соседний по смыслу механизм: разрешения, сохранённые пользователем, тоже живут в SQLite, но по проекту.
- `packages/core/docs/account.md` — другая таблица с токенами; она не используется (см. ловушки).

## Ловушки

- Таблица не объявляет внешних ключей на `integration_id`, `connector_id`, `method_id`: целостность связей держит код, а не СУБД.
- `active` допускает `null`. Код, читающий его как флаг, обязан сам решить, что значит отсутствие значения.
- Тип `Credential.Value` навязан аннотацией `$type`, а не проверкой: значение, записанное в таблицу вопреки схеме, декодировать потом нечем.
- Общих потребителей у таблицы ровно один, поэтому любая правка колонок ломает только `credential.ts` — но правка в обратную сторону (чтение поля, которого нет в таблице) ломается уже на уровне типов.
