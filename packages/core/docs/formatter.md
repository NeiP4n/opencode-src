# core/formatter — встроенные форматтеры исходников по расширениям файлов

## Что в папке

Один файл `packages/core/src/formatter/builtins.ts`: список из 25 форматтеров
(gofmt, mix, oxfmt, prettier, biome, zig, clang-format, ktlint, ruff, air, uv,
rubocop, standardrb, htmlbeautifier, dart, ocamlformat, terraform, latexindent,
gleam, shfmt, nixfmt, rustfmt, pint, ormolu, cljfmt, dfmt). Каждый описан
интерфейсом `Info` — имя, список расширений и `enabled`.

`Info.enabled` — это `Effect<string[] | false>`: либо массив аргументов
командной строки с подстановкой `$FILE`, либо `false`, если форматтер для
этого проекта не подходит. Выбор ленивый, поэтому проверки окружения
(поиск бинарника, чтение конфигов) не выполняются при импорте модуля.

## Ключевые файлы

- `packages/core/src/formatter/builtins.ts` — функция `make(input)`, собирающая
  весь список. Принимает `directory`, `worktree`, сервисы `fs`, `npm`,
  `processes` и `bin` (каталог с бинарниками).
- Хелпер `executable(name, extensions, args, findExecutable)` — базовый
  конструктор для большинства форматтеров: нашёл бинарник в PATH → вернул
  `[path, ...args]`, не нашёл → `false`.
- Хелперы `hasDependency`, `hasRecordKey`, `isRecord` — безопасная проверка
  полей в распарсенном JSON без утверждений типов.

## Важные детали

- Список возвращается в фиксированном порядке, первым идёт `gofmt`.
  Порядок — часть контракта для вызывающей стороны.
- Три стратегии определения «форматтер применим»:
  1. по наличию бинарника в PATH (`gofmt`, `mix`, `zig`, `ktlint`, `rubocop`,
     `standardrb`, `htmlbeautifier`, `dart`, `terraform`, `latexindent`,
     `gleam`, `shfmt`, `nixfmt`, `rustfmt`, `ormolu`, `cljfmt`, `dfmt`);
  2. по конфигурационному файлу, найденному вверх по дереву (`biome` ищет
     `biome.json`/`biome.jsonc`, `clang-format` — `.clang-format`,
     `ocamlformat` — `.ocamlformat`);
  3. по зависимости проекта (`prettier`, `oxfmt` смотрят в `package.json`,
     `pint` — в `composer.json`).
- `ruff` требует и бинарник, и подтверждение настройки: `pyproject.toml`
  подходит, только если в его тексте есть секция `[tool.ruff]`; для
  `ruff.toml` и `.ruff.toml` этого не требуется. Второй путь — упоминание
  `ruff` в `requirements.txt`, `pyproject.toml` или `Pipfile`.
- `air` (R) проверяет не только код возврата `air --help`, но и текст первой
  строкиhelp: там должны быть подстроки `R language` и `formatter`. Иначе
  форматтер считается неподходящим. `uv` проверяет только `uv format --help`.
- `prettier`, `oxfmt` и `biome` объявляют `environment: { BUN_BE_BUN: "1" }` —
  это подсказка вызывающей стороне, а не переменная, которую модуль сам
  выставляет.
- Разрешения файлов подставляются по расширению, сравнение чувствительно к
  регистру. У `clang-format` список содержит и строчные, и заглавные
  варианты (`.c` и `.C`), у `pint` — только `.php`.
- Почти у всех `enabled` стоит `.pipe(Effect.orElseSucceed(() => disabled))`:
  любая ошибка чтения или запуска превращается в «форматтер выключен», а не
  в исключение. Исключение — `air`, у него обработки ошибки нет.
- Путь к `pint` жёстко задан как `./vendor/bin/pint`: бинарник ищется не в
  PATH, а в каталоге `vendor/bin` текущего проекта.
- `Formatter` — папка с одним файлом: подкаталогов нет, тестов рядом нет.

## Связи

- `packages/core/src/util/which.ts` — функция `which(name, undefined, bin)`,
  единственный источник пути к бинарнику для `executable`-форматтеров.
- `@opencode/util/fs-util` — `fs.findUp` (поиск конфигов и `package.json`
  вверх от `directory` до `worktree`) и `fs.readFileString` / `fs.readJson`.
- `@opencode/util/npm` — `npm.which("prettier")`, `npm.which("oxfmt")`,
  `npm.which("@biomejs/biome")`: npm-зависимые форматтеры ищутся через
  установленный пакет, а не через PATH.
- `@opencode/util/process` (`AppProcess`) и `effect/unstable/process`
  (`ChildProcess`) — запуск с `--help` для `air` и `uv`.
- `packages/core/src/v1/config/formatter.ts` — конфигурация старого формата
  с настройками форматтеров приходит оттуда (по именам, не по этому списку).

## Ловушки

- `Effect.orElseSucceed` скрывает настоящую ошибку: если `fs.readJson` падает
  на невалидном `package.json`, результат — `false`, и форматтер молча
  выключается без диагностики.
- `air` — единственный без `orElseSucceed`: сбой `air --help` уходит наружу
  эффектом, а не превращается в выключение.
- У `prettier` проверка идёт по всем найденным `package.json` с фильтром
  `continue`, а у `pint` — с возвратом на первом подходящем `composer.json`.
  Поведение при нескольких манифестах различается.
- `mix` попал в список с расширениями Elixir/EEx-шаблонов (`.ex`, `.exs`,
  `.eex`, `.heex`, `.leex`, `.neex`, `.sface`), хотя проверяется только
  наличие бинарника `mix` — версия Elixir и наличие проекта не смотрятся.
- `findUp` ограничен `worktree`: выше границы worktree поиск не поднимается,
  поэтому проект без `package.json` внутри worktree не найдёт форматтер
  на npm-зависимостях.
