# @opencode/merman — рендер диаграмм Mermaid в терминале

## Что это

Рендер диаграмм Mermaid внутри TUI: 88 файлов, ~21 тыс. строк в `src/`
(значительная часть — тесты). Пакет разбирает текст диаграммы, раскладывает
узлы и связи, рисует в символьной сетке терминала. Регистрируется как
плагин с одним рендерером кода — `mermaid`.

Поддерживаемые типы диаграмм видны по каталогам: `flowchart`, `sequence`,
`state`, `gantt`, `gitgraph`, `timeline`.

## Слои и зависимости

Слой **L1**: зависит от `plugin` (хост расширений TUI). Других пакетов
`@opencode/*` в зависимостях нет.

Единственный потребитель — `packages/tui`.

Экспорт — три пути (из `packages/merman/package.json`):

```json
"./markdown": "./src/markdown.ts",
"./palette": "./src/palette.ts",
"./plugin": "./src/plugin.ts"
```

## Подсистемы и файлы

**Плагин** — `packages/merman/src/plugin.ts`: `Plugin.define` с id
`opencode.merman`; в `setup` регистрирует рендерер под именем `mermaid`
через `context.markdown.registerCodeBlockRenderer("mermaid", ...)`. Цвета
берутся из палитры: `resolveOpenCodeDiagramPalette(context.theme,
context.themeMode)`.

**Точка входа рендера** — `packages/merman/src/markdown.ts` →
`createMermaidCodeBlockRenderer`.

**Палитра** — `packages/merman/src/palette.ts` →
`resolveOpenCodeDiagramPalette(theme, mode)` — цвета диаграмм под светлую
и тёмную схему (тест `palette.test.ts`).

**Ядро рендера** — каталог `packages/merman/src/core/`:
`canvas.ts` (символьный холст), `drawing.ts` (примитивы отрисовки),
`geometry.ts` (геометрия), `spatial.ts` (пространственные структуры),
`text.ts` и `text-lines.ts` (текст и переносы), `color/style.ts` (стили
цветов), `render-grid.ts` (сетка вывода), `mermaid.ts` (общее для
диаграмм). Отдельно, в корне `src/`, — `detect.ts`: определение типа
диаграммы по тексту.

**Типы диаграмм** — каталоги с единым набором файлов (`diagram.ts` /
`parser.ts` / `layout.ts` / `drawing.ts` / `render-grid.ts` / `style.ts` /
`types.ts`):
- `flowchart/` плюс `routing.ts`, `labels.ts`, `options.ts`;
- `sequence/` плюс `placement.ts`, `note.ts`, `endpoint.ts`;
- `state/` плюс `routing.ts`, `search.ts`, `visible-model.ts`;
- `gantt/`, `gitgraph/`, `timeline/`.

**Диагностика** — `packages/merman/src/diagnostics.ts` (ошибки разбора),
`packages/merman/src/plugin.ts`.

**Markdown-обвязка** — `packages/merman/src/markdown.ts`.

**Тесты** — `packages/merman/src/test/` (включая `layout-audit/` с
fixture'ами и harness'ем), плюс `*.test.ts` рядом с кодом.

## Точки входа

1. `packages/merman/src/plugin.ts` — `export default`, подключение как
   плагина.
2. `packages/merman/src/markdown.ts` → `createMermaidCodeBlockRenderer(...)`
   — рендерер без регистрации.
3. `packages/merman/src/detect.ts` — определить тип диаграммы по тексту.
4. `packages/merman/src/palette.ts` → `resolveOpenCodeDiagramPalette(...)` —
   цвета под тему.

## На что смотреть дальше

- `packages/latex/PACKAGE.md` — соседний рендерер формул, тот же паттерн
  (`plugin` + `markdown`).
- `packages/plugin/PACKAGE.md` — `Plugin.define` и контекст `setup`.
- `packages/tui/PACKAGE.md` — потребитель, где живёт рендер Markdown.
- `packages/theme/PACKAGE.md` — темы, из которых берётся палитра.

## Ловушки

1. **Реализация — не браузерный Mermaid.** Это свой парсер и своя раскладка
   под терминал: синтаксис поддерживается выборочно, экзотика уйдёт в
   `diagnostics.ts`.
2. **Три точки входа не взаимозаменяемы:** `plugin` регистрирует,
   `markdown` рендерит, `palette` красит. Корневого `exports` нет.
3. **`state/routing.ts` и `flowchart/routing.ts` — разный код.**
   Прокладка линий у каждого типа диаграммы своя; правка одного не чинит
   другой.
4. **Тесты лежат в `src/`**, а не в `test/`: `*.test.ts` и каталог
   `src/test/` входят в `src/` и в подсчёт строк — цифры «21 тыс. строк»
   включают их.
