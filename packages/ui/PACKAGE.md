# @opencode/ui — библиотека компонентов интерфейса

## Что это

Веб-компоненты на Solid.js: 214 файлов, ~35 тыс. строк в `src/`. Кнопки,
диалоги, таблицы, иконки, темы, стили — весь визуальный набор для браузерных
поверхностей opencode (приложение, расширения, страница сессии).

Пакет публикуется (`publishConfig.access: public`) и подключается
по компонентам: в `exports` десятки строк вида `"./button":
"./src/actions/button/button.tsx"`.

## Слои и зависимости

Слой **L0 — лист**: от пакетов `@opencode/*` не зависит. Опора — `solid-js`
(peer) и `@kobalte/core` (headless-компоненты), плюс `shiki`/`marked`/`katex`
(подсветка, Markdown, формулы), `motion`, `fuzzysort`, `solid-sonner`.

Кто подключает (число файлов с импортом `@opencode/ui`):

| Пакет | Файлов |
| --- | --- |
| `packages/app/src` | 133 |
| `packages/gui-extensions/src` | 44 |
| `packages/session-ui/src` | 35 |
| `packages/ui/src` | 26 (внутренние импорты) |
| `packages/desktop/src` | 4 |
| `packages/tui/src` | 3 |
| `packages/enterprise/src` | 3 |
| `packages/cli/src` | 1 |

## Подсистемы и файлы

Каталоги `packages/ui/src/` разложены по назначению:

**Категории компонентов:**
- `actions/` — `button/`, `icon-button/`, `split-button/` (плюс `submit.css`);
- `data-display/` — `accordion/`, `avatar/`, `badge/`, `card/`,
  `animated-number/`, `collapsible/`, таблицы и списки;
- `overlays/` — `dialog/`, `tooltip/`;
- `forms/`, `feedback/`, `navigation/`, `layout/`, `typography/` —
  остальные группы;
- `components/` — компоненты шире категорий: `app-icon.tsx`, `card.tsx`,
  `animated-number.tsx`, спрайты `app-icons/`, `file-icons/`,
  `provider-icons/`.

**Темы и стили** — `packages/ui/src/theme/` (включая `themes/*.json`),
`packages/ui/src/styles/`. CSS лежит рядом с компонентом
(`button/button.css`), а `sideEffects: ["**/*.css"]` говорит сборщику,
что стили подключать обязательно.

**Иконки и ассеты** — `packages/ui/src/icons/`, `packages/ui/src/assets/`
(иконки, шрифты, звуки), спрайты собирает `vite-plugin-icons-spritesheet`.

**Интернационализация и демо** — `packages/ui/src/i18n/`,
`packages/ui/src/storybook/` (истории), `*.stories.tsx` рядом с
компонентами.

**Хуки и контекст** — `packages/ui/src/hooks/`, `packages/ui/src/context/`;
`custom-elements.d.ts` — декларация кастомных элементов.

## Точки входа

1. `packages/ui/package.json` → `exports` — карта компонентов; путь
   `@opencode/ui/button` открывает `src/actions/button/button.tsx`.
2. `packages/ui/src/actions/button/button.tsx` — показывает стиль компонента:
   `Root` из Kobalte, пропсы `size` / `variant`, локальный `.css`.
3. `packages/ui/src/theme/` — если нужна тема, а не компонент.

## На что смотреть дальше

- `packages/app/PACKAGE.md` — главный потребитель (133 файла).
- `packages/session-ui/PACKAGE.md` — страница сессии, построенная на этих
  компонентах.
- `packages/gui-extensions/PACKAGE.md` — расширения, подключающие `ui`
  напрямую.
- `packages/theme/PACKAGE.md` — темы терминального интерфейса (другая
  поверхность, не путать с `ui/theme`).

## Ловушки

1. **Каждый компонент — отдельный экспорт.** Импорта `"@opencode/ui"` не
   существует: только `@opencode/ui/button`, `@opencode/ui/icon` и т. д.
2. **CSS — часть пакета.** `sideEffects` намеренно сохраняет `**/*.css`;
   отключение tree-shaking стилей даёт «кнопку без стилей».
3. **Тесты и истории не публикуются:** `files` в `package.json` исключает
   `*.test.ts(x)` и `*.stories.ts(x)` — в `dist` они не попадают.
4. **`ui/theme` (веб-темы) ≠ `@opencode/theme` (TUI-темы).** Два разных
   пакета с похожими именами.
5. **Спрайты иконок собираются сборкой** (`app-icons/sprite.svg`,
   `file-icons/sprite.svg` в `files`) — их нельзя править руками,
   они генерируются из `src/assets`.
