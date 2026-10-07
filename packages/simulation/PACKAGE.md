# @opencode/simulation — режим Drive: симулированный запуск

## Что это

Симуляция opencode без реальной модели и реального терминала: 13 файлов,
~2.2 тыс. строк в `src/`. Пакет состоит из двух половин — «frontend»
(рендер интерфейса с управлением извне) и «backend» (подмена слоёв сервера
на симулированные), соединённых манифестом `Drive` и своим протоколом.

Назначение — воспроизводимые прогоны: тест или инструмент управляет
интерфейсом, а все исходящие запросы уходят в таблицу маршрутов вместо
сети.

## Слои и зависимости

Слой **L4**: зависит от `ai`, `core`, `plugin`, `protocol`, `util`.

Кто подключает:

- `packages/server` — подмена слоёв при старте в режиме симуляции;
- `packages/tui` — frontend-часть;
- сам `packages/simulation`.

Нет корневого `exports`, только отдельные пути:

```json
"./backend": "./src/backend/index.ts",
"./frontend": "./src/frontend/simulation.ts",
"./protocol": "./src/protocol/index.ts",
"./recording": "./src/recording.ts"
```

## Подсистемы и файлы

**Манифест** — `packages/simulation/src/manifest.ts`: `Manifest` на
Effect Schema с двумя endpoint'ами (`ui`, `backend`) — оба обязаны быть
`ws://127.0.0.1:<порт>` (loopback и явный порг проверяются схемой), плюс
`InstanceName` (regex `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`) и абсолютные
пути. `DriveManifest.resolve()` читает его с диска.

**Frontend** — каталог `packages/simulation/src/frontend/`:
- `simulation.ts` → `Drive.create(options, version)`: выбирает рендер
  (`createCliRenderer` из `@opentui/core` или headless по переменной
  `OPENCODE_DRIVE_RENDERER=headless`), поднимает `SimulationServer` на
  endpoint'е `manifest.endpoints.ui` и пишет адрес в stderr;
- `renderer.ts` (headless-рендер, умеет воспроизводить recording),
  `server.ts`, `actions.ts` (`createHarness(renderer)`), `semantics.ts`.

**Backend** — каталог `packages/simulation/src/backend/`:
`index.ts` → `simulationReplacements(...)` — слои, которые сервер
подмешивает при включённой симуляции (через динамический импорт, чтобы
модуль не грузился зря); `network.ts` — таблица маршрутов, неизвестные
назначения запрещены; `openai.ts` — endpoint, отвечаемый драйвером;
`simulated-provider.ts` — подменённый провайдер.

**Контроль и протокол** — `packages/simulation/src/control-server.ts`,
`packages/simulation/src/protocol/index.ts`.

**Запись** — `packages/simulation/src/recording.ts` (экспорт `./recording`):
таймлайн, по которому headless-рендер воспроизводит сценарий.

## Точки входа

1. `packages/simulation/src/frontend/simulation.ts` → `Drive.create(...)`
   — запуск frontend-части.
2. `packages/simulation/src/backend/index.ts` → `simulationReplacements(...)`
   — подмена слоёв сервера.
3. `packages/simulation/src/manifest.ts` → `DriveManifest.resolve()` —
   где взять манифест запуска.
4. `packages/simulation/src/protocol/index.ts` — протокол между
   драйвером и симуляцией.

## На что смотреть дальше

- `packages/server/PACKAGE.md` — где `simulationReplacements` подмешиваются
  в сборку.
- `packages/tui/PACKAGE.md` — frontend и `@opentui/core`.
- `packages/ai/PACKAGE.md` — реальные провайдеры, которых `simulated-provider`
  подменяет.
- `packages/protocol/PACKAGE.md` → `./simulation` — контракт симуляции.

## Ловушки

1. **Endpoint'ы только loopback.** Схема в `manifest.ts` принимает
   исключительно `ws:` на `127.0.0.1` с портом; внешний адрес манифест не
   пройдёт.
2. **Backend-модуль грузится динамически.** Прямой импорт
   `simulation/backend` вне режима симуляции подменит слои не вовремя —
   сервер сам решает, когда его подключить.
3. **`network.ts` запрещает неизвестные назначения.** В режиме симуляции
   реальный вызов модели молча уйдёт в отказ, если маршрут не
   зарегистрирован.
4. **Headless-режим зависит от `OPENCODE_DRIVE_RENDERER`.** Значение по
   умолчанию `visible`; для безэкранного прогона задавать явно.
