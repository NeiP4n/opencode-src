# @opencode/storybook — песочница компонентов

## Что это

Пакет без единого файла `src/`: 0 строк TypeScript. Это обвязка над
Storybook — изолированная среда, где компоненты `ui` и `session-ui`
просматриваются и тестируются отдельно от приложения.

Истории (`.stories.tsx`) лежат в самих пакетах компонентов; сюда собрана
только конфигурация и прогон.

## Слои и зависимости

Слой **L6 — поверхность**: от пакетов `@opencode/*` во время выполнения
не зависит — всё в `devDependencies`.

Что подключено (из `packages/storybook/package.json`):

- `@opencode/client`, `@opencode/session-ui`, `@opencode/ui` —
  компоненты для историй;
- `storybook` 10.4.4 и аддоны (`a11y`, `docs`, `links`, `onboarding`,
  `vitest`), `storybook-solidjs-vite`, `builder-vite`;
- `vite`, `vite-plugin-solid`, `@tailwindcss/vite`;
- `@playwright/test` — скриншот/браузерные проверки (каталог
  `packages/storybook/playwright/`);
- `react`, `react-dom` — только для самого Storybook (он на React),
  интерфейс opencode на Solid.

Каталоги пакета: `playwright/`, `tsconfig.json`, `package.json` — `src/`
отсутствует.

## Подсистемы и файлы

1. `packages/storybook/playwright/` — конфигурация и тесты Playwright
   для прогонов историй в браузере.
2. `packages/storybook/tsconfig.json` — типизация конфигурации.
3. `packages/storybook/package.json` — скрипты `storybook`
   (`storybook dev -p 6006`) и `build` (`storybook build`).

Истории, которые пакет показывает, разбросаны по потребителям:
`packages/ui/src/**/*.stories.tsx`,
`packages/session-ui/src/**/*.stories.tsx` (например
`timeline/mermaid.stories.tsx`, `components/dock-prompt.stories.tsx`,
`tools/tool-group.stories.tsx`).

## Точки входа

1. `packages/storybook/package.json` → скрипт `storybook` — запуск
   dev-сервера на порту 6006.
2. `packages/storybook/package.json` → скрипт `build` — статическая сборка
   историй.
3. `packages/storybook/playwright/` — браузерные проверки собранных
   историй.

## На что смотреть дальше

- `packages/ui/PACKAGE.md` — компоненты, для которых пишутся истории.
- `packages/session-ui/PACKAGE.md` — компоненты сессии со своими
  историями.
- `packages/app/PACKAGE.md` — приложение, в котором компоненты работают
  по-настоящему.

## Ловушки

1. **Отсутствие `src/` — не ошибка.** Валидатор ядра считает пакет с нулём
   строк нормальным: он ничего не содержит по построению.
2. **Storybook на React, компоненты на Solid.** Мост держит
   `storybook-solidjs-vite`; правки конфигурации ломают просмотр
   компонентов, но не сборку приложения.
3. **Истории не в этом пакете.** Искать `.stories.tsx` нужно в `ui` и
   `session-ui`; здесь только среда их показа.
4. **`react` в зависимостях не означает, что opencode на React** — это
   требование самого Storybook.
