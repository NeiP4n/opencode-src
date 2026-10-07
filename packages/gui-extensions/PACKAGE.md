# @opencode/gui-extensions — расширения интерфейса

## Что это

Набор расширений для браузерного приложения: 799 файлов, ~45 тыс. строк в
`src/` (много мелких файлов). Каждый каталог — отдельная возможность:
браузер, обзор изменений (review), терминал, SSH, WSL, пары устройств,
обновления, статистика использования и другие.

## Слои и зависимости

Слой **L6 — поверхность**: зависит от `client`, `plugin-browser`,
`schema`, `session-ui`, `ui`, `util`.

Кто подключает: `packages/app` и `packages/desktop`.

Экспорт (`packages/gui-extensions/package.json`):

```json
"./renderer": "./src/renderer.ts",
"./main": "./src/main.ts",
"./sdk": "./src/sdk/index.ts",
"./sdk/main": "./src/sdk/main.ts",
"./sdk/bridge": "./src/sdk/bridge.ts",
"./updater": "./src/updater/contract.ts"
```

## Подсистемы и файлы

Каталоги `packages/app`-стиля в `packages/gui-extensions/src/`:

- `browser/` — инструменты браузера (работают с
  `@opencode/plugin-browser`);
- `review/` — обзор изменений, ревью файлов;
- `terminal/` — терминал в интерфейсе;
- `file/` — работа с файлами;
- `pair/` — пары устройств (доступ с телефона);
- `ssh/`, `wsl/` — удалённые окружения;
- `updater/` — обновления (`contract.ts` вынесен отдельным экспортом);
- `usage/` — статистика использования;
- `summary/` — сводки;
- `debug/` — отладочные панели;
- `btw/`, `sdk/` — служебные модули;
- `main.ts`, `renderer.ts` — две половины: главный процесс и рендер.

## Точки входа

1. `packages/gui-extensions/src/main.ts` (экспорт `./main`) — главный
   процесс расширений.
2. `packages/gui-extensions/src/renderer.ts` (экспорт `./renderer`) —
   рендер-часть.
3. `packages/gui-extensions/src/sdk/index.ts` (экспорт `./sdk`) — API для
   написания своих расширений.
4. `packages/gui-extensions/src/updater/contract.ts` (экспорт `./updater`) —
   контракт обновлений.

## На что смотреть дальше

- `packages/app/PACKAGE.md` — приложение, куда расширения собираются.
- `packages/plugin-browser/PACKAGE.md` — серверная сторона инструментов
  браузера.
- `packages/session-ui/PACKAGE.md` — компоненты, переиспользуемые
  расширениями.
- `packages/ui/PACKAGE.md` — базовые компоненты.

## Ловушки

1. **Корневого экспорта нет.** Только `./main`, `./renderer`, `./sdk`
   и т. д.; импорт `@opencode/gui-extensions` не работает.
2. **799 файлов при 45 тыс. строк** — средний файл мелкий: правки обычно
   локальны, но поиск по имени надёжнее, чем по памяти.
3. **`main` и `renderer` — разные процессы** (паттерн Electron):
   общий код живёт в `sdk/`, а не в одном из двух.
4. **`updater/contract.ts` вынесен отдельно**, чтобы потребитель брал
   только типы, не подтягивая реализацию обновления.
