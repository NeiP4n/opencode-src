# @opencode/desktop — десктопное приложение (Electron)

## Что это

Обёртка Electron: 142 файла, ~9.6 тыс. строк в `src/`. Три части
классического Electron — главный процесс (`main/`), прелоад
(`preload/`), рендер (`renderer/`) — плюс общий код (`shared/`).

Собирается `electron-vite`, упаковывается `electron-builder`
(конфиги в корне пакета), обновляется через `electron-updater`.

## Слои и зависимости

Слой **L6 — поверхность**: в манифесте зависимостей от `@opencode/*` нет
(пакет использует workspace-пакеты через devDependencies и сборку), но по
коду связан с `app`, `cli`, `client`, `gui-extensions`.

Потребителей в `packages/*/src` нет — пакет запускается сам.

## Подсистемы и файлы

Каталоги `packages/desktop/src/`:

- `main/` — главный процесс Electron: окна, системный трей, IPC;
- `preload/` — мост между рендером и главным процессом;
- `renderer/` — окно приложения (сюда встраивается `@opencode/app`);
- `shared/` — общие типы и утилиты для обеих половин.

Конфигурация в корне пакета:

- `electron.vite.config.ts` (+тест `electron.vite.config.test.ts`) —
  сборка;
- `electron-builder.config.ts` (+тест) — упаковка дистрибутивов;
- `drizzle.config.ts` — миграции локальной базы;
- `icons/` — иконки.

Скрипты (`packages/desktop/package.json`): `dev`, `build`
(`electron-vite build`), `package:mac` / `package:win` /
`package:linux`, `bench:startup`, `migration`.

Зависимости: `electron-updater` (обновления), `electron-log`,
`electron-context-menu`, `@zip.js/zip.js`, `lighthouse`.

## Точки входа

1. `packages/desktop/package.json` → `"main": "./out/main/index.js"` —
   точка входа Electron после сборки.
2. `packages/desktop/src/main/` — главный процесс, с него начинается
   разработка.
3. `packages/desktop/src/renderer/` — окно, куда встраивается приложение.
4. `electron.vite.config.ts` — как собираются три части.

## На что смотреть дальше

- `packages/app/PACKAGE.md` — приложение внутри рендерера.
- `packages/gui-extensions/PACKAGE.md` — расширения, которые desktop
  подключает.
- `packages/cli/PACKAGE.md` — CLI, запускаемый из десктопа.
- `packages/desktop/README.md` — заметки самого пакета.

## Ловушки

1. **`src/` не равно коду главного процесса после сборки:** результат
   лежит в `out/` (`out/main/index.js`); правки в `src/` требуют
   пересборки.
2. **Конфиги тоже тестируются** (`electron-builder.config.test.ts`,
   `electron.vite.config.test.ts`) — их правка ломает тесты, а не только
   сборку.
3. **`drizzle.config.ts` — про базу данных десктопа**, не про базу
   ядра opencode (`packages/core/src/database`); два разных файла.
4. **`main`, `preload`, `renderer` — разные контексты.** Общее — только
   `shared/`; попытка использовать DOM в `main/` или Node-API в
   `renderer/` без прелоада упадёт.
