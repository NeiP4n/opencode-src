# @opencode/session-ui — компоненты страницы сессии

## Что это

Веб-часть интерфейса сессии: 113 файлов, ~24 тыс. строк в `src/`. Solid-ком
поненты для отображения хода работы: лента сообщений, отрисовка инструментов,
diff'ы, Markdown, таймлайн, обсуждения по строкам кода.

Пакет не запускается сам — его собирают в себя `app`, `gui-extensions`
и `enterprise`.

## Слои и зависимости

Слой **L5**: зависит от `client`, `ui`, `util`.

Кто подключает:

- `packages/app` — основное приложение;
- `packages/gui-extensions` — расширения интерфейса;
- `packages/enterprise` — корпоративная поверхность.

Карта экспорта (`packages/session-ui/package.json`) — отдельные части:

```json
"./actions": "./src/actions.ts",
"./document": "./src/document.ts",
"./message": "./src/message/current-message.tsx",
"./timeline": "./src/timeline/session-timeline.tsx",
"./timeline/projection": "./src/timeline/projection.ts",
"./basic-tool": "./src/components/basic-tool.tsx"
```

## Подсистемы и файлы

**Лента сессии** — каталог `packages/session-ui/src/timeline/`:
`session-timeline.tsx` (лента), `session-timeline-row.tsx` (строка),
`projection.ts` (проекция событий в строки), `detail.ts`,
`timeline-row.ts`, плюс `*.stories.tsx` и `projection.test.ts`.

**Сообщения** — каталог `packages/session-ui/src/message/`:
`current-message.tsx` (текущее сообщение), `message-content.tsx`,
`attachment-card.tsx`, `comment-card.tsx`,
`current-tool-state.ts` (+тест).

**Инструменты** — каталог `packages/session-ui/src/tools/`:
`tool-renderer.tsx` (отрисовка вызова инструмента), `shell-output.ts`
(вывод команды) и `*.stories.tsx`.

**Компоненты** — каталог `packages/session-ui/src/components/`:
`file.tsx`, `file-search.tsx`, `file-media.tsx`, `image-preview.tsx`,
`line-comment.tsx` (+ `line-comment-annotations.tsx`,
`line-comment-styles.ts`), `markdown-cache.tsx`,
`markdown-code-state.ts`, `markdown-image.ts`, `apply-patch-file.ts`,
`dock-prompt.tsx`, `basic-tool.tsx`, `file-ssr.tsx`.

**Diff'ы** — каталог `packages/session-ui/src/pierre/` (интеграция с
`@pierre/diffs`): `commented-lines.ts`, `comment-hover.ts`,
`diff-selection.ts`, `file-find.ts`, `file-runtime.ts`,
`file-selection.ts`, `media.ts`, `selection-bridge.ts`, `virtualizer.ts`,
`worker.ts`, `index.ts`.

**Контекст** — каталог `packages/session-ui/src/context/` (включая
`data.tsx`, `markdown.tsx`, `index.ts`).

**Прочее** — `actions.ts`, `document.ts`, `file-presentation.ts` и
каталог `packages/session-ui/src/v2/` (новая версия панелей ревью:
`session-review-v2.tsx`, `session-file-panel-v2.tsx`,
`session-progress-indicator-v2.tsx`), `storybook/` (фикстуры сценариев).

## Точки входа

1. `packages/session-ui/src/timeline/session-timeline.tsx` (экспорт
   `./timeline`) — лента, с которой начинается страница сессии.
2. `packages/session-ui/src/message/current-message.tsx` (экспорт
   `./message`) — отрисовка одного сообщения.
3. `packages/session-ui/src/actions.ts` (экспорт `./actions`) — действия
   пользователя из интерфейса.
4. `packages/session-ui/src/timeline/projection.ts` (экспорт
   `./timeline/projection`) — превращение событий в строки ленты.

## На что смотреть дальше

- `packages/app/PACKAGE.md` — приложение, куда компоненты собираются.
- `packages/ui/PACKAGE.md` — базовые компоненты (кнопки, диалоги),
  из которых собран `session-ui`.
- `packages/client/PACKAGE.md` — `./solid`-вариант, откуда приходят данные.
- `packages/gui-extensions/PACKAGE.md` — вторая поверхность сборки.

## Ловушки

1. **Нет корневого экспорта.** Только отдельные пути (`./timeline`,
   `./message`, `./actions`); импорт `@opencode/session-ui` не работает.
2. **`v2/` — не мусор и не единственный вариант.** Старые и новые панели
   ревью сосуществуют; при правке проверяй обе ветки.
3. **`pierre/` — обвязка вокруг чужой библиотеки `@pierre/diffs`** из
   `packages/ui`-зависимостей: её worker и virtualizer живут здесь, а
   рендер диффа — там.
4. **Истории и тесты лежат в `src/`** (`*.stories.tsx`, `*.test.ts`),
   поэтому строк пакета больше, чем «видимого» кода.
5. **`file-ssr.tsx` — вариант для серверного рендера**, не путать с
   `file.tsx`: у них разные предпосылки (DOM есть/нет).
