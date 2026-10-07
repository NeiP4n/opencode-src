# @opencode/theme — схема и разрешение тем интерфейса

## Что это

Темы терминального интерфейса: 10 файлов, ~1.6 тыс. строк в `src/tui/`.
Пакет описывает, из чего состоит тема (цвета, оттенки, состояния кнопок),
как её разрешить в конкретные цвета, как мигрировать старый формат и как
переключать светлую/тёмную схему.

`src` лежит целиком в подкаталоге `tui/` — это темы именно для TUI, других
поверхностей в пакете нет.

## Слои и зависимости

Слой **L0 — лист**: от пакетов `@opencode/*` не зависит, схемы описаны на
`effect` `Schema`.

Кто подключает (два потребителя):

- `packages/tui` — рендерит интерфейс в выбранных цветах;
- `packages/plugin` — отдаёт темы наружу, чтобы плагины могли их читать.

Карта экспортируемых путей в `packages/theme/package.json`:

```json
"./tui": "./src/tui/index.ts",
"./tui/v1": "./src/tui/v1.ts"
```

## Подсистемы и файлы

**Схема темы** — `packages/theme/src/tui/schema.ts`: константы-типы на
Effect Schema: `HueStep` (100…900), `SemanticHue`
(`accent` | `interactive` | `neutral`), `ActionVariant`
(`primary` | `secondary` | `destructive`), `ActionState`
(`disabled` | `pressed` | `focused` | `selected` | `hovered`),
`SurfaceName` (только `dialog`), `FeedbackKind`
(`error` | `warning` | `success` | `info`), `CategoricalDefinition`.
Это словарь, на котором стоит весь остальной код темы.

**Разрешение** — `packages/theme/src/tui/resolve.ts`: `parseThemeDocument`,
`resolveTheme`, `resolveThemeDocument`, `themeDecodeError` — превращение
описания темы в готовые значения, плюс ошибка декодирования.

**Расширение** — `packages/theme/src/tui/expand.ts` → `expandTheme`:
разворачивание темы-шаблона в полный набор цветов.

**Выбор схемы** — `packages/theme/src/tui/select.ts`: `selectTheme`,
`selectThemeMode`, `supportsThemeMode`, `themeModes` — светлая/тёмная схема
и поддерживаемые режимы.

**Цвет** — `packages/theme/src/tui/color.ts` → `rgbToOklch`; сопутствуют
`packages/theme/src/tui/syntax.ts` (→ `generateSyntax` — цвета подсветки
синтаксиса) и `packages/theme/src/tui/types.ts`.

**Миграция** — `packages/theme/src/tui/v1.ts` и
`packages/theme/src/tui/v1-migrate.ts` (→ `migrateV1`): старый формат
темы v1 переводится в текущий.

**Сборка пакета** — `packages/theme/src/tui/index.ts`: реэкспорт всего
вышеописанного (строки 1–49), это и есть публичное лицо.

## Точки входа

1. `packages/theme/src/tui/index.ts` — весь API (`resolveTheme`,
   `expandTheme`, `selectTheme`, `generateSyntax`, `migrateV1`,
   `rgbToOklch` и типы).
2. `packages/theme/src/tui/v1.ts` — отдельный экспорт `./tui/v1` для чтения
   тем старого формата.
3. `packages/theme/src/tui/resolve.ts` → `resolveTheme` — с неё начинается
   применение темы.

## На что смотреть дальше

- `packages/tui/PACKAGE.md` — потребитель: где цвета попадают в отрисовку.
- `packages/plugin/PACKAGE.md` — второй потребитель, доступ к темам из плагинов.
- `packages/ui/PACKAGE.md` — веб-компоненты, у которых своя тематизация.
- `themes/` в `.opencode` конфига владельца — реальные файлы тем.

## Ловушки

1. **Весь `src` — подкаталог `tui/`.** Файла `index.ts` в корне `src` нет:
   точка входа задана в `exports` как `./tui`.
2. **`v1-migrate.ts` и `v1.ts` — не одно и то же:** первый мигрирует,
   второй описывает старый формат. Подключение `./tui/v1` не мигрирует тему,
   а только читает её старым кодом.
3. **Схема жёсткая:** `HueStep` допускает только девять значений, а
   `SurfaceName` — только `dialog`. Своя тема с любым другим оттенком не
   пройдёт декодирование, упадёт `themeDecodeError`.
4. **`generateSyntax` — производная.** Цвета подсветки синтаксиса считаются
   из базовых оттенков; правка одного поля темы меняет и их.
