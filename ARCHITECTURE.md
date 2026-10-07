# Ядро OpenCode — карта репозитория

Репозиторий: `github.com/sst/opencode`, лицензия MIT, релиз **v2.0.22**
(`git describe` → `v2.0.22`, HEAD `527f0b931d`). Каждый пакет описан в своём файле
`packages/<пакет>/PACKAGE.md` — с этого файла и начинай, если знаешь, какой пакет нужен.

Всего 35 каталогов в `packages/`, из них 30 с `package.json` (у `console`, `stats`,
`containers`, `identity`, `effect-drizzle-sqlite` своего манифеста нет). Строки и число
файлов — по `src/`, без тестов.

## Карта слоёв

Слои с ссылками на документ каждого пакета (порядок — от фундамента к поверхности):

| Слой | Пакеты и их документы |
| --- | --- |
| L0 — листья | [schema](packages/schema/PACKAGE.md), [util](packages/util/PACKAGE.md), [codemode](packages/codemode/PACKAGE.md), [theme](packages/theme/PACKAGE.md), [ui](packages/ui/PACKAGE.md), [http-recorder](packages/http-recorder/PACKAGE.md), [httpapi-codegen](packages/httpapi-codegen/PACKAGE.md), [web](packages/web/PACKAGE.md), [script](packages/script/PACKAGE.md), [function](packages/function/PACKAGE.md), [posts](packages/posts/PACKAGE.md) |
| L1 | [protocol](packages/protocol/PACKAGE.md), [ai](packages/ai/PACKAGE.md), [latex](packages/latex/PACKAGE.md), [merman](packages/merman/PACKAGE.md) |
| L2 | [client](packages/client/PACKAGE.md), [plugin-browser](packages/plugin-browser/PACKAGE.md) |
| L3 | [plugin](packages/plugin/PACKAGE.md) |
| L4 — ядро | [core](packages/core/PACKAGE.md), [simulation](packages/simulation/PACKAGE.md) |
| L5 — транспорт | [server](packages/server/PACKAGE.md), [session-ui](packages/session-ui/PACKAGE.md) |
| L6 — поверхности | [cli](packages/cli/PACKAGE.md), [tui](packages/tui/PACKAGE.md), [sdk](packages/sdk/PACKAGE.md), [app](packages/app/PACKAGE.md), [gui-extensions](packages/gui-extensions/PACKAGE.md), [enterprise](packages/enterprise/PACKAGE.md), [desktop](packages/desktop/PACKAGE.md), [storybook](packages/storybook/PACKAGE.md) |

## Как всё запускается

Один короткий путь, который стоит запомнить:

```
opencode (packages/cli/src/index.ts)
  └─ команда (serve, run, tui, pair, service, …)
      └─ сервер (packages/server/src/routes.ts) — HTTP + SSE
          └─ ядро (packages/core/src) — сессии, инструменты, провайдеры
              └─ база (packages/core/src/database) и конфиг (packages/core/src/config.ts)
```

Клиент (TUI, приложение, SDK) через этот сервер ходит по эндпоинтам, объявленным
в `packages/protocol/src/api.ts`. Типы данных живут отдельно — в `packages/schema/src`.

Три места, где это можно перечитать в коде:

- `packages/cli/src/index.ts` — реестр команд; каждая команда подгружается лениво
  через динамический импорт, в таблице `Handlers`.
- `packages/server/src/routes.ts:176` — `HttpApiBuilder.layer(Api, …)` монтирует API;
  ниже идёт `Layer.provide` со слоями авторизации, ошибок и ~35 слоёв ядра.
- `packages/core/src/instance.ts:114` — `export const graph = LayerNode.group(nodes)`:
  граф слоёв ядра. Это точка сборки зависимостей, а не «объект инстанса».
  Таких графов в ядре три: ещё два собирают требования плагинов —
  `packages/core/src/plugin/host.ts:574` и `packages/core/src/plugin/internal.ts:160`.

## Слои зависимостей

Слои посчитаны по полю `dependencies` в `packages/*/package.json` (только пакеты
`@opencode/*`). Пакет в строке не может зависеть от пакета выше по списку.

| Слой | Пакеты | Зависит от |
| --- | --- | --- |
| **L0 — листья** | `schema`, `util`, `codemode`, `theme`, `ui`, `http-recorder`, `httpapi-codegen`, `web`, `script`, `function`, `posts` | — |
| **L1** | `protocol`, `ai`, `latex`, `merman` | `schema`, `plugin` |
| **L2** | `client`, `plugin-browser` | `protocol`, `schema`, `plugin` |
| **L3** | `plugin` | `ai`, `client`, `protocol`, `schema`, `util` |
| **L4 — ядро** | `core`, `simulation` | `ai`, `codemode`, `plugin`, `schema`, `util`, `core` |
| **L5 — транспорт** | `server`, `session-ui` | `core`, `protocol`, `schema`, `simulation`, `util`, `client`, `ui` |
| **L6 — поверхности** | `cli`, `tui`, `sdk`, `app`, `gui-extensions`, `enterprise`, `desktop`, `storybook` | всё вышеперечисленное |

**Оговорка, важная для чтения:** слои взяты из манифестов, а не из графа импортов,
поэтому реальная связность шире. Два примера, которые это видят:

- `packages/tui` объявлен на L6 и зависит от `core`, но `packages/tui/src/mini/`
  тянет ядро напрямую, минуя `packages/tui/src/context/client.tsx`.
- `packages/latex` и `packages/merman` стоят на L1, но зависят от `plugin` (L3) —
  то есть ссылка идёт вниз по слоям. Проверяй конкретный файл, а не только пакет.

## Пакеты по слоям

| Пакет | Строк в src | Файлов | Документ |
| --- | --- | --- | --- |
| `schema` | 5 785 | 102 | `packages/schema/PACKAGE.md` |
| `util` | 4 565 | 44 | `packages/util/PACKAGE.md` |
| `codemode` | 10 764 | 45 | `packages/codemode/PACKAGE.md` |
| `theme` | 1 592 | 10 | `packages/theme/PACKAGE.md` |
| `ui` | 35 114 | 214 | `packages/ui/PACKAGE.md` |
| `http-recorder` | 1 601 | 14 | `packages/http-recorder/PACKAGE.md` |
| `httpapi-codegen` | 1 977 | 1 | `packages/httpapi-codegen/PACKAGE.md` |
| `web` | 2 649 | 18 | `packages/web/PACKAGE.md` |
| `script` | 88 | 1 | `packages/script/PACKAGE.md` |
| `function` | 402 | 2 | `packages/function/PACKAGE.md` |
| `posts` | 14 | 1 | `packages/posts/PACKAGE.md` |
| `protocol` | 4 201 | 36 | `packages/protocol/PACKAGE.md` |
| `ai` | 29 218 | 201 | `packages/ai/PACKAGE.md` |
| `latex` | 2 646 | 14 | `packages/latex/PACKAGE.md` |
| `merman` | 21 359 | 88 | `packages/merman/PACKAGE.md` |
| `client` | 16 722 | 30 | `packages/client/PACKAGE.md` |
| `plugin-browser` | 1 530 | 7 | `packages/plugin-browser/PACKAGE.md` |
| `plugin` | 3 089 | 60 | `packages/plugin/PACKAGE.md` |
| `core` | 65 299 | 431 | `packages/core/PACKAGE.md` |
| `simulation` | 2 182 | 13 | `packages/simulation/PACKAGE.md` |
| `server` | 3 883 | 52 | `packages/server/PACKAGE.md` |
| `session-ui` | 24 443 | 113 | `packages/session-ui/PACKAGE.md` |
| `cli` | 12 297 | 109 | `packages/cli/PACKAGE.md` |
| `tui` | 62 303 | 281 | `packages/tui/PACKAGE.md` |
| `sdk` | 647 | 15 | `packages/sdk/PACKAGE.md` |
| `app` | 121 153 | 516 | `packages/app/PACKAGE.md` |
| `gui-extensions` | 44 877 | 799 | `packages/gui-extensions/PACKAGE.md` |
| `enterprise` | 1 466 | 13 | `packages/enterprise/PACKAGE.md` |
| `desktop` | 9 569 | 142 | `packages/desktop/PACKAGE.md` |
| `storybook` | 0 | 0 | `packages/storybook/PACKAGE.md` |

## Где что искать

| Задача | Первый файл | Пакет |
| --- | --- | --- |
| как живут сессии, промпты, инструменты | `packages/core/src/session/session.ts` | `core` |
| какие инструменты у агента и как они описываются провайдеру | `packages/core/src/tool/runtime.ts` | `core` |
| откуда берутся модели и как выбирается провайдер | `packages/core/src/provider.ts` | `core` |
| где лежат данные opencode (база, кэш, состояние) | `packages/util/src/global.ts` | `util` |
| как задаётся конфиг и откуда он подхватывается | `packages/core/src/config.ts` | `core` |
| какие HTTP-эндпоинты есть и что они возвращают | `packages/protocol/src/api.ts` | `protocol` |
| авторизация, pair, порты, привязка сервера | `packages/server/src/auth.ts` | `server` |
| поток событий (SSE) | `packages/server/src/event-feed.ts` | `server` |
| как устроен интерфейс в терминале | `packages/tui/src/routes/session/index.tsx` | `tui` |
| как подключиться к чужому серверу | `packages/cli/src/services/server-connection.ts` | `cli` |
| как написать плагин (серверная часть) | `packages/plugin/src/app.ts` | `plugin` |
| как написать плагин (интерфейс) | `packages/plugin/src/tui/` | `plugin` |
| типы данных, которые ходят по API | `packages/schema/src/` | `schema` |

## Правила репозитория (из AGENTS.md)

Перед правкой любого файла прочитай `AGENTS.md` в корне. Коротко, что там важного:

- После изменения публичного `HttpApi` в `protocol` или `server` нужно
  `bun run generate` из `packages/client`; сгенерированные файлы клиента не правят руками.
- Направление зависимостей: `schema` → `core` и `protocol` → `server`. Клиентский код
  может зависеть от `schema` и `protocol`, но не от `core` и `server`.
- Изменения — в `packages/core`, `cli`, `server`, `protocol`, `schema` и сгенерированных
  поверхностях клиента.
- Changesets в этом репозитории не используются.
- Ветка по умолчанию — `v2`. Локальной `main` может не быть: для диффов берётся `v2`.
- Тесты не запускают из корня репозитория (есть guard `do-not-run-tests-from-root`),
  а из каталогов пакетов.
- Проверка целиком: `bun run check` из корня. Точечно: `bun typecheck` из каталога пакета.
  `tsc` напрямую не запускают.

## Как проверять документацию

Валидатор лежит в `.opencode/` и проверяет, что у каждого пакета из
`.opencode/doc_manifest.txt` есть непустой `PACKAGE.md` с шестью обязательными
разделами и без заглушек.

```bash
cd ~/opencode-src
./.opencode/doc_check.py            # форма и полнота по всем пакетам
./.opencode/doc_check.py --links    # плюс существование упомянутых путей
./.opencode/doc_check.py --surface  # сверка манифеста с каталогом packages/
./.opencode/doc_check.py --sample   # символы из документов против исходников
./.opencode/doc_check.sh util       # отрицательный контроль: 4 мутации должны краснеть
```

Валидатор проверяет форму документа и существование путей, но **не** проверяет, что
написанное совпадает со смыслом кода. Фактическую верность описания подтверждает
только чтение исходников и выборочная проверка `--sample`.

## Ловушки

1. **Папка — не всегда подсистема.** В `packages/core/src` подсистемы `provider`,
   `event`, `credential`, `permission` — это одиночные `.ts`-файлы, а одноимённые папки
   существуют ради `sql.ts` со схемой таблиц. Ищи файл, а не папку.
2. **Реальный движок событий — `packages/core/src/bus.ts`, а не каталог `event/`.**
   В `event/` лежит только `sql.ts`.
3. **Три рантайма в базе:** `packages/core/src/database/sqlite.bun.ts`,
   `sqlite.node.ts` и `sqlite.workerd.ts`. Правка одного из них не означает правку
   остальных.
4. **`packages/tui/src/mini/` — не «мини-версия» интерфейса.** Это отдельный
   фронтенд-рантайм на 18 тыс. строк со своим рендером, запускаемый отдельной
   командой CLI (`packages/cli/src/commands/handlers/mini.ts`).
5. **`packages/core/src/account/sql.ts` — мёртвый код:** импортов ноль, таблица в
   `console/core/src/schema/account.sql` существует отдельно. Не чинится, только
   помечено.
6. **`packages/core/test/` — 96.5 тыс. строк из 162.7 тыс. в `core`.** `src/` ядра —
   это 65 тыс. строк; остальное — тесты. Не ищи логику в тестах.
7. **Границы документации:** новые файлы в этом репозитории попадут в чужой
   `git status` как untracked. Коммитов не делается.