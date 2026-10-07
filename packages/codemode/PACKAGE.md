# @opencode/codemode — интерпретатор программ модели и инструменты

## Что это

Собственный язык-обёртка над инструментами: 45 файлов, ~10.8 тыс. строк в
`src/`. Внутри — интерпретатор JavaScript-подобных программ, stdlib из
готовых функций и описание «инструментов» (tool), которые программа может
вызывать. Это слой, который ядро (`core`) подключает как один инструмент
`codemode` — модель пишет короткую программу, а она делает много шагов.

## Слои и зависимости

Слой **L0 — лист**: от других пакетов `@opencode/*` не зависит. Опора —
`effect` (`Effect`, `Schema`).

Кто подключает: `packages/core` (в манифесте стоит среди зависимостей ядра),
`packages/tui` — оттуда же идёт вызов в интерфейсе.

Точка входа одна — `exports` `".": "./src/index.ts"`.

## Подсистемы и файлы

**Публичное лицо** — `packages/codemode/src/index.ts`: namespace
`CodeMode`, `Extension`, `Namespace`, `Tool`, `OpenAPI` плюс именованные
экспорты `searchSignature`, `toolExpression`, `ToolError`, `toolError`.

**Запуск программы** — `packages/codemode/src/codemode.ts`: тип
`ExecutionLimits` (`timeoutMs` — лимит времени, `maxToolCalls` — максимум
вызовов инструментов; без значения лимита нет) и обвязка: `executeProgram`
из интерпретатора плюс `extensionGlobals` и `globalNames`.

**Интерпретатор** — каталог `packages/codemode/src/interpreter/`:
- `interpreter.ts` — обход AST (узлы `CallExpression`, `ForStatement`,
  `ArrowFunctionExpression`, …);
- `execute.ts` — выполнение программы;
- `model.ts`, `scope.ts`, `objects.ts`, `references.ts` — значения, области
  видимости, ссылки;
- `intrinsics.ts`, `native.ts`, `generators.ts` — встроенные функции,
  нативные вызовы, генераторы;
- `promises.ts`, `callback.ts` — промисы и колбэки;
- `errors.ts`, `limits.ts` — ошибки и лимиты;
- `extensions.ts`, `globals.ts` — подключение расширений и список глобалов.

**Инструменты** — `packages/codemode/src/tool.ts` (типы `Tool`,
`JsonSchema`, `SchemaType`, функция `make`), `tools.ts`, `tool-runtime.ts`
(`ToolRuntime`, `Services`, `ToolDescription`, `ToolCall`,
`ToolInvocation`, `CallResult`), `tool-schema.ts`, `tool-error.ts`
(`ToolError`, `toolError`), `namespace.ts`, `data.ts`, `extension.ts`.

**Стандартная библиотека** — каталог `packages/codemode/src/stdlib/`:
`array.ts`, `string.ts`, `object.ts`, `number.ts`, `math.ts`, `json.ts`,
`date.ts`, `regexp.ts`, `url.ts`, `headers.ts`, `iterator.ts`,
`collections.ts`, `bytes.ts`, `console.ts`, `value.ts`, `web.ts`.

**OpenAPI** — каталог `packages/codemode/src/openapi/`: `index.ts`,
`spec.ts`, `runtime.ts`, `types.ts` (там же лежит файл плана работ самого
пакета).

## Точки входа

1. `packages/codemode/src/index.ts` — единственный экспорт пакета.
2. `packages/codemode/src/index.ts` → `CodeMode` — запуск и лимиты
   (`ExecutionLimits`).
3. `packages/codemode/src/index.ts` → `Tool.make(...)` — объявление своего
   инструмента для программы.
4. `packages/codemode/src/interpreter/execute.ts` → `executeProgram` —
   нижний уровень, если нужен сам интерпретатор.

## На что смотреть дальше

- `packages/core/PACKAGE.md` — как ядро оборачивает пакет в один инструмент.
- `packages/plugin/PACKAGE.md` — хост, через который инструменты попадают
  в исполнение.
- `packages/schema/PACKAGE.md` — типы данных, включая описания инструментов.
- `packages/codemode/src/openapi/` — собственный список планов
  пакета (не относится к общей документации ядра).

## Ловушки

1. **`codemode` — не npm-скрипт, а интерпретатор.** Программа модели
   исполняется внутри процесса со своими лимитами, а не в песочнице ОС;
   `limits.ts` и `ExecutionLimits` — единственное, что её сдерживает.
2. **Лимитов по умолчанию нет.** В `ExecutionLimits` прямо написано
   «No default»: без заданного `timeoutMs` и `maxToolCalls` программа может
   работать неограниченно.
3. **`tool.ts` принимает два вида схем** — Effect `Schema` или сырой
   `JsonSchema`; смешение стилей в одном инструменте ломает валидацию на
   границе.
4. **Два разных понятия «глобалы»:** `interpreter/globals.ts` (имена,
   доступные программе) и `interpreter/extensions.ts` (глобалы, которые
   дают расширения). Путаница между ними даёт «функция не найдена».
5. **Файл плана в `openapi/`** — рабочие заметки пакета, их наличие не
   означает, что документация ядра недописана.
