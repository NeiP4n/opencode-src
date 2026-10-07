# @opencode/enterprise — корпоративная поверхность

## Что это

Небольшой SSR-пакет: 12 файлов, ~1.4 тыс. строк в `src/`. Корпоративная
поверхность opencode — серверный рендер приложения с отдельными маршрутами
и ядром (`core/`).

Пакет `private`, `exports` в `package.json` нет — он собирается, а не
подключается как модуль.

## Слои и зависимости

Слой **L6 — поверхность**: зависит от `client`, `core`, `schema`,
`session-ui`, `ui`, `util`.

Потребителей в `packages/*/src` нет — пакет запускается как своё приложение.

## Подсистемы и файлы

Каталоги и файлы `packages/enterprise/src/`:

- `entry-server.tsx` — серверный рендер (точка входа SSR);
- `entry-client.tsx` — клиентская гидратация;
- `app.tsx`, `app.css` — приложение и стили;
- `routes/` — маршруты корпоративной поверхности;
- `core/` — связка с ядром (доступ к `@opencode/core`);
- `global.d.ts`, `custom-elements.d.ts` — декларации типов.

Тесты лежат рядом: `packages/enterprise/test/` и
`packages/enterprise/test-debug.ts`; скрипты сборки — в
`packages/enterprise/script/`.

## Точки входа

1. `packages/enterprise/src/entry-server.tsx` — SSR, с него начинается
   обработка запроса.
2. `packages/enterprise/src/entry-client.tsx` — гидратация на клиенте.
3. `packages/enterprise/src/routes/` — какие страницы существуют.
4. Скрипты `package.json` пакета — сборка и запуск.

## На что смотреть дальше

- `packages/app/PACKAGE.md` — браузерное приложение, с которым пакет
  пересекается по компонентам.
- `packages/session-ui/PACKAGE.md` и `packages/ui/PACKAGE.md` —
  переиспользуемые компоненты.
- `packages/core/PACKAGE.md` — ядро, к которому идёт доступ из `core/`.

## Ловушки

1. **`exports` отсутствует** — импортировать `@opencode/enterprise` из
   другого пакета нельзя; это отдельное приложение.
2. **SSR и клиент — две точки входа.** Правка `app.tsx` требует проверки
   обеих: серверного рендера и гидратации.
3. **`custom-elements.d.ts` и `global.d.ts` — декларации**, а не код;
   логики в них нет.
4. **Пакет меньше остальных поверхностей** — часть функциональности он
   берёт у `app`, а не дублирует; искать «enterprise-логику» нужно в
   `routes/`, а не в компонентах.
