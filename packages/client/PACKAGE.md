# @opencode/client — клиент HTTP-API в трёх вариантах

## Что это

Тонкий транспорт к серверу opencode: 30 файлов, ~16.7 тыс. строк в `src/`.
Пакет не содержит логики ядра — только вызовы эндпоинтов, описанных в
`protocol`, в трёх flavour'ах: на промисах, на Effect и для Solid.

Большая часть строк — сгенерированный код в каталогах `generated/`:
правки руками туда не вносятся.

## Слои и зависимости

Слой **L2**: зависит от `protocol` и `schema` (а через них — от `plugin`,
`ai`).

Кто подключает: `app`, `cli`, `core`, `desktop`, `enterprise`,
`gui-extensions`, `plugin`, `sdk`, `session-ui`, `tui`, сам `client`
(внутренние импорты) и `protocol` (типы).

Карта экспорта (`packages/client/package.json`):

```json
".": "./src/promise/index.ts",
"./promise": "./src/promise/index.ts",
"./service": "./src/promise/service.ts",
"./solid": "./src/solid/index.ts",
"./effect": "./src/effect/index.ts",
"./effect/service": "./src/effect/service.ts"
```

## Подсистемы и файлы

**Контракт** — `packages/client/src/contract.ts`: одна строка реэкспорта
`ClientApi`, `groupNames`, `effectOmitEndpoints`, `promiseOmitEndpoints` из
`@opencode/protocol/client`. Это мост к `protocol`, а не своя модель.

**Промис-вариант** — каталог `packages/client/src/promise/`:
`client.ts` (реализация), `api.ts`, `rpc.ts`, `service.ts`, `index.ts` и
`generated/` (`client.ts`, `client-error.ts`, `types.ts`, `index.ts`).

**Effect-вариант** — каталог `packages/client/src/effect/`: те же файлы
(`client.ts`, `api.ts` + `api/api.ts`, `rpc.ts`, `service.ts`, `index.ts`,
`generated/client.ts`, `generated/client-error.ts`).

**Solid-вариант** — каталог `packages/client/src/solid/`: `data.ts`
(реактивные данные), `connection.ts` (состояние соединения), `pty.ts`
(терминал), `index.ts`.

**Служебное** — `packages/client/src/service.ts`,
`service-contender.ts`, `service-timing.ts`, `service-version.ts`
(версионирование и выбор службы), `shared-events.ts` (общие события),
`rpc-runtime.ts` (рантайм RPC), `pty-handoff.ts` (передача PTY между
процессами).

## Точки входа

1. `packages/client/package.json` → `"."` (то же, что `./promise`) — путь
   по умолчанию, промис-клиент.
2. `packages/client/src/promise/index.ts` → `ClientApi` — список всех
   методов.
3. `packages/client/src/effect/index.ts` — Effect-вариант для кода на
   `effect`.
4. `packages/client/src/solid/index.ts` — реактивные подписки для UI.
5. `packages/client/script/build.ts` — сборка сгенерированных файлов
   (`bun run generate`).

## На что смотреть дальше

- `packages/protocol/PACKAGE.md` — контракт, из которого клиент собран.
- `packages/httpapi-codegen/PACKAGE.md` — генератор `generated/`.
- `packages/server/PACKAGE.md` — тот же API на стороне сервера.
- `packages/cli/src/services/server-connection.ts` — подключение к чужому
  серверу.

## Ловушки

1. **Сгенерированные каталоги не правятся.** Правило репозитория: после
   изменения `HttpApi` запускать `bun run generate` из
   `packages/client`; файлы в `generated/` перезаписываются.
2. **Три варианта — один API, но разные типы возврата.** `promise` отдаёт
   `Promise`, `effect` — `Effect`, `solid` — реактивный сигнал. Перенос
   кода между ними не тривиален.
3. **`"."` и `"./promise"` — один и тот же файл.** Импорт `@opencode/client`
   и `@opencode/client/promise` не различаются; путаница возникает, когда
   ждут Effect, а получают промис.
4. **`contract.ts` не является клиентом** — это реэкспорт типов из
   `protocol`; методов вызова в нём нет.
5. **`service-version.ts` сверяет версию службы.** Подключение клиента к
   серверу другой версии может быть отклонено — смотреть в
   `service-contender.ts`.
