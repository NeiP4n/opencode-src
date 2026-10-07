# @opencode/latex — рендер формул в терминале

## Что это

Рендер LaTeX-формул внутри TUI: 14 файлов, ~2.6 тыс. строк в `src/`
(половина — тесты). Пакет парсит формулу, раскладывает её в символьную сетку
и рисует в терминале, регистрируясь как плагин с двумя рендерерами кода —
`latex` и `math`.

## Слои и зависимости

Слой **L1**: зависит от `plugin` (хост расширений TUI). Внутренних
зависимостей от других пакетов `@opencode/*` больше нет.

Единственный потребитель — `packages/tui`.

Экспорт — два пути (из `packages/latex/package.json`):

```json
"./markdown": "./src/markdown.ts",
"./plugin": "./src/plugin.ts"
```

## Подсистемы и файлы

**Плагин** — `packages/latex/src/plugin.ts` (54 строки): `Plugin.define`
с id `opencode.latex`; в `setup` создаёт рендерер через
`createLatexCodeBlockRenderer(context.renderer, ...)` и регистрирует его
под именами `latex` и `math`
(`context.markdown.registerCodeBlockRenderer(...)`). Цвета берутся из
темы: `context.theme.text.base` и `context.theme.text.muted`.

**Точка входа рендера** — `packages/latex/src/markdown.ts` →
`createLatexCodeBlockRenderer` — мост между Markdown-кодовым блоком и
парсером.

**Парсер** — `packages/latex/src/parser.ts`: разбор формулы в дерево
(тесты рядом: `parser.test.ts`, `parser-render.test.ts`).

**Раскладка и отрисовка** — `packages/latex/src/layout.ts` (размещение
символов, дроби, индексы) и `packages/latex/src/render.ts` (вывод в
символьную сетку); проверки — `layout.test.ts`, `render.test.ts`,
`root.test.ts`.

**Символы и ограничения** — `packages/latex/src/symbols.ts` (таблица
LaTeX-символов) и `packages/latex/src/limits.ts` (лимиты сложности,
чтобы формула не вешала рендер).

**Типы** — `packages/latex/src/types.ts`.

## Точки входа

1. `packages/latex/src/plugin.ts` — `export default`, так пакет подключается
   как плагин.
2. `packages/latex/src/markdown.ts` → `createLatexCodeBlockRenderer(...)` —
   если нужен сам рендерер без регистрации.
3. `packages/latex/src/parser.ts` — если нужен только разбор формулы.

## На что смотреть дальше

- `packages/plugin/PACKAGE.md` — `Plugin.define` и контекст, который
  передаётся в `setup`.
- `packages/tui/PACKAGE.md` — потребитель: где Markdown-блоки превращаются
  в отрисовку.
- `packages/merman/PACKAGE.md` — соседний рендерер (диаграммы Mermaid),
  тот же паттерн подключения.

## Ловушки

1. **Это не LaTeX-компилятор.** Подмножество команд для терминального
   отображения; экзотические пакеты `amsmath` не поддерживаются и уйдут
   в `limits.ts`-ограничение или в нечитаемый вывод.
2. **`./markdown` и `./plugin` — разные вещи:** плагин регистрирует
   рендерер, `markdown` отдаёт фабрику. Импорт корня пакета не работает —
   корневого `exports` нет.
3. **Половина строк — тесты.** Искать логику в `*.test.ts` бесполезно:
   рабочий код в `parser.ts`, `layout.ts`, `render.ts`.
4. **Кодовые блоки `latex` и `math` ведут себя одинаково** — регистрируются
   одной строкой в `plugin.ts`; правка регистра идёт там же, в двух вызовах.
