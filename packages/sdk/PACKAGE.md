# @opencode/sdk — программный доступ к opencode

## Что это

Маленький SDK: 15 файлов, ~647 строк в `src/`. Позволяет внешнему коду
подключиться к запущенному opencode — создавать сессии, звать инструменты,
смотреть события — не разбираясь в HTTP-контракте.

У пакета два стиля (промис и Effect) и поддержка Cloudflare Workers
(workerd).

## Слои и зависимости

Слой **L6 — поверхность**: зависит от `client`, `core`, `plugin`,
`schema`, `server`, `util`.

Кто подключает: `core` (тесты/SDK-плагины), `plugin`, `session-ui`,
сам `sdk`.

Экспорт (`packages/sdk/package.json`):

```json
".": "./src/index.ts",
"./effect": "./src/effect/index.ts",
"./workerd": "./src/workerd.ts",
"./workerd/effect": "./src/effect/workerd.ts"
```

## Подсистемы и файлы

**Клиент opencode** — `packages/sdk/src/opencode.ts` (основной класс),
`packages/sdk/src/promise.ts` (промис-обёртка),
`packages/sdk/src/index.ts` (корневой экспорт).

**Effect-вариант** — каталог `packages/sdk/src/effect/`: `index.ts`,
`opencode.ts`, `tool.ts`, `workerd.ts`.

**Инструменты** — `packages/sdk/src/tool.ts` — объявление инструмента
для внешнего использования.

**Внутреннее** — каталог `packages/sdk/src/internal/`: `fetch.ts`
(HTTP-транспорт), `host.ts` (хост), `instances.ts` (инстансы),
`workerd.ts` (вариант для воркеров).

**Контракты и логирование** — `packages/sdk/src/contracts.ts`
(типы, которые SDK отдаёт наружу) и `packages/sdk/src/logging.ts`.

**Workerd** — `packages/sdk/src/workerd.ts` (экспорт `./workerd`) —
то же SDK под Cloudflare Workers.

## Точки входа

1. `packages/sdk/src/index.ts` — корневой экспорт, промис-SDK.
2. `packages/sdk/src/effect/index.ts` (экспорт `./effect`) — SDK на `effect`.
3. `packages/sdk/src/opencode.ts` — сам класс, если нужен доступ без
   обёртки.
4. `packages/sdk/src/workerd.ts` — вариант для воркеров.

## На что смотреть дальше

- `packages/client/PACKAGE.md` — транспорт, которым SDK пользуется.
- `packages/server/PACKAGE.md` — сервер, к которому оно подключается.
- `packages/plugin/PACKAGE.md` — как плагины объявляют инструменты
  (параллельный путь `tool.ts`).
- `packages/cli/PACKAGE.md` — команды, запускающие то, к чему подключается SDK.

## Ловушки

1. **Четыре точки входа — не одно и то же.** `"."` и `"./effect"` —
   разные стили, `"./workerd"` — другой рантайм; случайная комбинация
   даёт ошибки типов, а не падение в рантайме.
2. **SDK подключается к уже запущенному opencode.** Само по себе оно
   сервер не поднимает — нужен запущенный `serve` или служба.
3. **`internal/` не публикуется как API** — импортировать
   `@opencode/sdk/internal/*` можно технически, но стабильность не
   обещана.
4. **`contracts.ts` — не `protocol`.** Это срез типов SDK, а не полный
   HTTP-контракт; отсутствие метода в `contracts.ts` не значит, что его
   нет на сервере.
