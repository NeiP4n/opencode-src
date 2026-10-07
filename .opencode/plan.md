# План: раскрыть ядро OpenCode в .md-файлах рядом с каждой папкой

## Цель
Одной фразой: описать ядро OpenCode (`/home/isako/opencode-src`, релиз v2.0.22) в файлах
`.md`, лежащих рядом с каждой папкой пакета, чтобы ИИ, открыв любой каталог, сразу понимала
что там за код и куда копать дальше.

## Задача
TASK-DOC-CORE. Проект: `/home/isako/opencode-src` (OC_SPACE пуст → основной ПК, S-работа).
Это клон `github.com/sst/opencode`, лицензия MIT, HEAD = `527f0b931d` (тег `v2.0.22`),
ветка ОТСОЕДИНЁННАЯ (detached HEAD).

## Решение владельца (ответы на вопросы, 2026-10-06)
- Документируем **исходники** opencode, а не `~/.config/opencode`.
- Файлы `.md` лежат **рядом с каждой нужной папкой**, а не свалкой в одном каталоге:
  ИИ открывает `packages/core/` и сразу видит, что это за пакет.
- Охват: всё ядро. Порядок планирует лид сам.
- Сеть для lan-rooms считается доверенной (домашняя Wi-Fi) — решение принято, но работа
  по lan-rooms отложена и в эту задачу не входит.

## Критерии готовности (команда → ожидаемый результат)
1. `cd ~/opencode-src && python3 .opencode/doc_check.py` → код 0: у каждого пакета из
   `.opencode/doc_manifest.txt` есть `PACKAGE.md`, все они непустые, в каждом есть
   обязательные разделы, и ни один не содержит заглушек (`TODO`, `заглушка`, `Lorem`).
2. `cd ~/opencode-src && python3 .opencode/doc_check.py --links` → код 0: все пути,
   упомянутые в `.md` как `packages/...`, существуют на диске.
3. `cd ~/opencode-src && bash .opencode/doc_check.sh` → код 0: отрицательный контроль
   (мутация) валидатора ловит сломанный документ.
4. `cd ~/opencode-src && head -40 ARCHITECTURE.md` → карта слоёв со ссылками на PACKAGE.md.
5. `~/.config/opencode/bin/dod-check .` → `ИТОГ: OK`.

## Установленные факты (проверены лично в этой сессии)
- `opencode --version` → `v0.0.0-local-202610052358`; бинарник
  `~/.npm-global/bin/opencode` → симлинк на `~/.local/bin/oc-core/opencode-fixed`.
- `~/opencode-src` — клон `https://github.com/sst/opencode.git`, 3.8 ГБ (3.1 ГБ — node_modules).
- 35 пакетов в `packages/*`, ~833 тыс. строк TS/tsx, из них в `*/src/*` — 491 тыс.
- HEAD `527f0b931d`, тег `v2.0.22`, **detached HEAD**, дерево грязное на 3 файла
  (`packages/script/src/index.ts`, `packages/tui/src/component/session-tabs.tsx`,
  `packages/tui/src/context/storage.tsx`) — это правки прошлой работы по пульту, не эта задача.
- `LICENSE` = MIT (Copyright (c) 2025 opencode) — документация не меняет лицензию.
- 14 пакетов уже имеют свой `README.md` (ai, app, client, codemode, containers, core,
  desktop, enterprise, httpapi-codegen, http-recorder, plugin-browser, sdk, stats, web).
  Их **не трогаем**: свои файлы называются `PACKAGE.md` и не конфликтуют.
- `packages/*/PACKAGE.md` не существует нигде — имена свободны.
- В репозитории уже есть `AGENTS.md` (канон проекта) и `V2_HTTP_API_AUDIT.md`.
- `.opencode/` в репозитории содержит `agent/`, `command/`, `glossary/` и свой `.gitignore`;
  наш DoD и план туда же, они не в индексе git.

## Слои зависимостей (прочитано из packages/*/package.json, не из памяти)
- **L0 — листья**: schema, util, ui, codemode, theme, http-recorder, httpapi-codegen,
  web, script, posts, function, desktop, storybook
- **L1**: protocol ← schema; ai ← schema; latex, merman ← plugin
- **L2**: client ← protocol, schema; plugin-browser ← plugin, schema
- **L3**: plugin ← ai, client, protocol, schema, util (хост расширений)
- **L4 — ядро**: core ← ai, codemode, plugin, plugin-browser, schema, util;
  simulation ← core, ai, plugin
- **L5 — транспорт**: server ← core, protocol, schema, simulation, util;
  session-ui ← client, ui, util
- **L6 — поверхности**: cli, tui, sdk, app, enterprise, gui-extensions;
  console/stats — сервисы (Astro/SST), desktop/web/posts — Electron/Astro

## Подсистемы `packages/core/src` (по коду, не по названию папки)
- `instance` (`instance.ts:171`, `instance/service.ts`) — Effect-граф слоёв всего ядра
  (`export const graph = LayerNode.group(nodes)`), ~45 импортов сервисов; `location*.ts` —
  per-location скоупы. Это точка сборки DI, а не «объект инстанса».
- `session` (`session/session.ts:427` + 40 файлов) — хранение и проекция
  (`projector.ts:790`), LLM-раннер (`runner/llm.ts`, `step.ts`,
  `publish-llm-event.ts:630`), `compaction.ts:951`, `transfer.ts`, `inbox.ts`.
- `tool` (`tool/runtime.ts:279`) — Effect-Schema → ToolDefinition для провайдера;
  `tool/plugin/*.ts` — встроенные инструменты (edit, glob, grep, file-diff, mcp-resource).
- `config` (`config.ts:374`, `config/normalize.ts:804`, `discovery.ts`, `watch.ts`, `variable.ts`).
- `database` (`database/database.ts:122`) — drizzle + Effect sqlite, три рантайма
  (`sqlite.bun/node/workerd.ts`), `schema.gen.ts`, `migration/`, `v1-migration.bun.ts:1135`.
- `event` — папка содержит только `event/sql.ts` (таблицы). Реальный движок — `bus.ts:908`:
  долговременный event-log + PubSub, `latestSequence`, KeyedMutex.
- `provider` — не папка, а `provider.ts:468` + `plugin/provider/` (35 провайдеров:
  openai, anthropic-совместимые, chatgpt, github-copilot, ollama…).
- `permission` (`permission.ts:347` + `permission/saved.ts:88`).
- `snapshot` (`snapshot.ts:233`) — git-снапшоты файлов: `capture|files|diff|restore`.
- `formatter` (`formatter.ts:104` + `formatter/builtins.ts:297`).
- `filesystem` (`filesystem.ts:211` + `filesystem/{fff,watcher,search,ignore,protected}.ts`).
- `instruction` (`instruction-discovery.ts:149` — поиск AGENTS.md по дереву;
  `instructions/index.ts:256` — сборка и хеширование в системный промпт).
- `credential` (`credential.ts:325`), `job` (`job.ts:482`), `kv` (`kv.ts:92`),
  `codemode` (обёртка одноимённого пакета в один tool), `effect` (хелперы слоёв/DI).

## Передача данных protocol → server → client → tui
1. `packages/protocol/src/api.ts` собирает один `HttpApi` из 30 групп в `groups/*.ts`;
   типы — Effect Schema в `HttpApiEndpoint`. Группы ↔ хендлеры почти 1:1.
2. `packages/server/src/routes.ts` монтирует Api через `HttpApiBuilder` и склеивает ~35
   core-слоёв; `server/src/handlers/*.ts` (32 файла) — реализации; `event-feed.ts` — SSE.
3. `packages/client/src` — тонкий транспорт: `contract.ts` реэкспортирует `ClientApi`;
   три варианта API — `{effect,promise,solid}/`.
4. `packages/tui/src/context/client.tsx` (61 строка) — единственная точка подключения TUI.
5. Данные (не API) объявлены в `packages/schema/src/*` — ~70 файлов.

## Крупные части TUI (packages/tui/src, 105 тыс. строк)
| Каталог | Строк | Содержимое |
| --- | --- | --- |
| `mini/` | 18.2k | отдельный фронтенд-рантайм, запускается отдельной командой CLI |
| `component/` | 14.0k | ~50 виджетов: 25+ `dialog-*.tsx`, `session-tabs.tsx`, `prompt/index.tsx` |
| `routes/` | 8.9k | `home.tsx` и `session/index.tsx` (3610 строк) |
| `feature-plugins/` | 4.9k | `home/`, `prompt/`, `sidebar/`, `system/` |
| `context/` | 3.8k | ~30 Solid-контекстов: `client.tsx`, `data.tsx`, `permission.tsx`, `keymap.tsx`, `theme.tsx` |

## Порядок работ (этапы и листья — в DoD)
1. Этап 1 — каркас документации: валидатор + манифест + `ARCHITECTURE.md` (карта слоёв).
2. Этап 2 — фундамент: schema, util, protocol, client (на них стоит всё остальное).
3. Этап 3 — ядро: core (с папками), codemode, plugin.
4. Этап 4 — транспорт и модели: server, ai, sdk, session-ui.
5. Этап 5 — поверхности: tui, cli, app, ui, desktop, web, остальные.
6. Этап 6 — приёмка: отрицательный контроль, dod-check, отчёт.

## Состояние на 07.10 (проверено запуском)
- 30 пакетов из манифеста имеют `PACKAGE.md`; `doc_check.py` с `--links` и `--sample` даёт код 0.
- Папки ядра описаны в `packages/core/docs/` — 39 документов плюс `README.md`-указатель,
  проверяет `.opencode/check_core_docs.py`. Решение владельца DEC-6 от 07.10: по core
  документация папок лежит каталогом рядом с пакетом, а не файлом рядом с каждой папкой кода.
- Осталось два листа: **L-117** — шесть документов по каталогам `packages/tui/src`
  (`component`, `routes`, `context`, `mini`, `feature-plugins`, `plugin`), оракул готов;
  **L-118** — по одному `PACKAGE.md` на пять пакетов вне манифеста: `console`, `containers`,
  `effect-drizzle-sqlite`, `identity`, `stats`.
- Оракул символов `--sample` проверяет наличие `src` по манифесту, а не по факту каталога:
  пакет с кодом, но без `src`, даёт нарушение, а пакет с нулём строк (`storybook`) — нет.

## Границы
- **НЕ править код ядра.** Задача — только документация (новые файлы `.md`, `.opencode/doc_*`).
- **НЕ трогать** три уже изменённых файла (`packages/script/src/index.ts`,
  `packages/tui/src/component/session-tabs.tsx`, `packages/tui/src/context/storage.tsx`) —
  это правки прошлой работы, не наши.
- **НЕ перезаписывать** существующие `README.md` 14 пакетов.
- **НЕ коммитить и НЕ пушить** (git push запрещён правилом permissions; коммит в чужой
  репозиторий без разрешения владельца не делаем).
- **НЕ коммитить** `.opencode/plan.md`, `.opencode/dod.yaml`, `PACKAGE.md` — они остаются
  рабочими файлами в дереве.
- lan-rooms (плагин связи устройств) — **вне scope**, работа отложена по решению владельца.
- Не документировать `console`/`stats` глубоко (это инфраструктура Astro/SST, а не ядро CLI),
  достаточно поверхностной карточки.

## Допущения (записаны явно, не как факт)
- «Ядро OpenCode» = исходники в `~/opencode-src`, а не `~/.config/opencode`.
  Подтверждено ответом владельца «Исходники opencode» от 2026-10-06.
- Имя `PACKAGE.md` выбрано лидом, потому что 14 пакетов уже заняли `README.md`.
  Владелец имя не выбирал; при его несогласии переименование тривиально.
- Файл `.md` внутри `packages/*` попадёт в `git status` чужого репозитория как untracked.
  Это ожидаемо и безвредно, но владельцу сказать.

---

# Этап 7 (TASK-BUILD-VERSION): версия сборки и доступ к free-tier моделям

## Цель
Одной фразой: пересобрать локальное ядро OpenCode с настоящей версией 2.0.22, чтобы
User-Agent, уходящий провайдеру opencode.ai, содержал число ≥ 1.18.0, и открыть все
10 бесплатных моделей (сейчас работают 2 из 10).

## Факты (проверены живыми прогонами 2026-10-07, до правки)
- Бинарь `~/.local/bin/oc-core/opencode-fixed` объявлял `0.0.0-local-202610052358`:
  версия подставляется на этапе сборки (`packages/cli/script/build.ts` define
  `OPENCODE_VERSION: Script.version`, `packages/script/src/index.ts` для preview-канала
  даёт `0.0.0-${CHANNEL}-${дата}`), поэтому исходниками её не задать.
- Прямая проба inference тем же токеном и теми же заголовками `x-opencode-*`, что шлёт
  клиент: `space-bunny-free` отвечает при любом User-Agent; `exo-free` и
  `muse-spark-1.3-contributor-free` отдают 403 FreeTierError «can only be used from
  within OpenCode»; `fledge-alpha-free` — 403 RegionError (регион). То есть у настоящего
  клиента есть отдельный заслон «только изнутри OpenCode» (в бинаре есть заголовок
  `x-opencode-ticket`, в исходниках я его не нашёл), и падает он именно на сравнении версии.
- Исходники помечены тегом `v2.0.22`, то есть код новее 1.18.0 — не хватало только числа
  в User-Agent.

## Решение
Пересобрать CLI из текущего грязного дерева с `OPENCODE_VERSION=2.0.22
OPENCODE_CHANNEL=local` (канал `local` сохраняет БД `opencode-local.db`, имена баз,
логи и поведение, к которым привык владелец). Релизную установку через
`~/.config/opencode/bin/oc-update` не делаем: она потеряла бы патчи OpenMAMI.

## Критерии готовности (команда → ожидаемый результат)
1. `opencode --version` → `opencode v2.0.22`.
2. Цикл по 10 бесплатным моделям (`opencode run --standalone -m opencode/<модель> "ок"
   < /dev/null`) → ни одной строки «1.18.0 or newer».
3. `space-bunny-free` и `fledge-alpha-free` продолжают отвечать (регрессии нет).
4. Старый бинарь сохранён как `opencode-fixed.bak-20261007` и сам запускается.
5. `~/.config/opencode/bin/dod-check .` → ИТОГ: OK.

## Риски и то, что нельзя проверить без перезапуска
- Живой фоновый сервис (`opencode-fixed serve --stdio --port 0`) запущен ДО замены бинаря
  и держит старый код в памяти: его User-Agent останется `0.0.0-local-...`, пока сервис
  не перезапустят. Перезапуск рвёт текущую сессию агента, поэтому проверка идёт через
  `--standalone` (свой сервер из нового бинаря).
- Свободные модели и регион связаны: `fledge-alpha-free` при прямой пробе даёт RegionError,
  а `oc-netwatch` переключает страну VPN-узла (последний переход: Германия → Финляндия).
  Доступность части моделей может меняться вместе с узлом — это не дефект сборки.

## Итог (записан после прогона 15:20, версия 2.0.22)
- **Исправление в исходниках, а не только в бинаре.** `packages/script/src/index.ts`:
  функция `releaseTagVersion()` берёт `git describe --tags --abbrev=0`, отбрасывает
  префикс `v`, и если тег — валидный семвер ≥ 1.18.0, локальная сборка объявляет его
  вместо `0.0.0-local-<дата>`. Без тега или ниже порога — прежний откат.
  Проверка: `./.opencode/check_version.sh` → `version=2.0.22 channel=local` при пустом окружении.
- **Зачем это было нужно.** Первая сборка с `OPENCODE_VERSION=2.0.22` починила симптом,
  но в 14:59 параллельная пересборка (процессы `bun run dev` и сборка из второго терминала)
  заменила бинарь на `0.0.0-local-202610071056`, и на попытке 3 версионный блок вернулся
  ровно на те 8 моделей. Правка в исходниках делает симптом невозвратимым: любая
  пересборка владельца из этого дерева даст 2.0.22.
- **Факт, который не удалось доказать:** почему у провайдера второй заслон
  «free tier can only be used from within OpenCode». Заголовок `x-opencode-ticket` есть в
  бинаре, но в исходниках v2.0.22 я его не нашёл — где он ставится, не выяснено.
- **Осталось внешнее:** `exo-free` и `ling-3.0-flash-fin-free` отвечают «Upstream request
  failed: Endpoint is unavailable». Это апстрим, не локальная сборка (в 14:58 exo-free
  ответил «ок»).
- **Оракулы проекта:** `./.opencode/check_version.sh` и `./.opencode/check_free_models.sh`
  (обе через shellcheck, повторяемо из репозитория).

---

# Задача TASK-HUB-REGISTRY: панель Registry Universal Tool Hub в devtools-bar

## Цель
Одной фразой: в нижней devtools-строке TUI добавить панель Registry, которая показывает,
какие инструменты и терминалы каталога Hub установлены, какие нет, и какова готовность
записей каталога.

## Контракт (2026-10-07, продолжение работы Cline)
Критерии готовности (команда → ожидаемый результат):
1. `cd ~/opencode-src/packages/tui && bun typecheck` → код 0.
2. `cd ~/opencode-src/packages/tui && bun test test/util/hub-registry.test.ts` → 0 fail:
   юнит-тест данных панели с внедряемым probe, ≥4 теста с реальными assert.
3. `cd ~/opencode-src/packages/tui && bun test test/component/devtools-registry.test.tsx`
   → 0 fail: панель рендерится, в кадре есть «Registry», «Terminals», «Missing».
4. `cd ~/opencode-src/packages/tui && bun test --timeout 30000 --only-failures` → ни одного
   НОВОГО падения против baseline: baseline от 07.10 (до правок) — 1423 pass / 10 fail,
   лог `/tmp/opencode/tui-test-baseline.log`, падающие тесты: SIGHUP clears title…,
   vertical session tabs switch…, server plugin failures at width ×4, installation progress
   replaces checking…, falls back to OpenCode when configured V2 theme ×3. После правок —
   тот же список из 10, новых падений нет.
5. `~/.config/opencode/bin/dod-check .` → `ИТОГ: OK`.

## Факты (проверены в этой сессии, не из памяти)
- Ядро Hub уже в дереве (untracked): `packages/core/src/hub/` — catalog из 12 категорий
  (search, files, text, json, data, git, docker, systemd, process, network, system, windows),
  resolve (which/prepare/render), install (planFor → команда apt/dnf/pacman/brew/winget),
  match (переписывание узнаваемых shell-строк). `bun test test/hub.test.ts` в packages/core
  → 12 pass / 0 fail.
- hub-tool зарегистрирован: `packages/core/src/plugin/internal.ts:76` (импорт) и
  `packages/core/src/plugin/internal.ts:241` (HubTool.Plugin в pre-списке). Бейдж HUB в
  сессии уже рисуется: `packages/tui/src/routes/session/index.tsx:2820` (Hub) и
  `packages/tui/src/routes/session/message-parts.tsx:23` («hub» в toolDisplays).
- `packages/tui/src/component/devtools-bar.tsx` — 611 строк; от предыдущего ИИ осталась
  РОВНО одна строка: 25 (`type Panel` расширен на `"registry"`). Самой панели нет.
- Baseline до правок: `cd packages/tui && bun typecheck` → код 0;
  `git status --porcelain` → 389 записей (47 untracked).
- PanelBox — ширина 42 (контент 38 колонок), панели открываются по шаблону
  `<Show when={panel() === "..."}>` внутри BarItem (devtools-bar.tsx:245-437).

## Допущения (записаны явно, не как факт)
- TUI импортирует каталог Hub напрямую из `@opencode/core/hub/index`: PATH процесса TUI —
  локальная машина, devtools-панель локальная отладочная (рядом с локальными графиками
  CPU/RAM этой же панели). Remote-сервер с чужим PATH панелью не учитывается.
- «Терминалы» из слов владельца = бэкенды каталога `Hub.Backend`: bash, nu, pwsh.

## Отклонённый вариант
- Protocol endpoint + handler в server + `bun run generate` в packages/client: точен для
  remote-TUI, но добавляет группу HTTP API и регенерацию клиента ради отладочной панели.
  Если remote-точность понадобится — панель расширяется endpoint'ом, каркас не меняется.

## Границы
- Трогать: `packages/tui/src/component/devtools-bar.tsx`, новые файлы панели и данных
  (`component/devtools-registry.tsx`, `util/hub-registry.ts`), новые тесты `packages/tui/test/**`.
- НЕ трогать: `packages/core/**` (ядро Hub уже готово и протестировано), protocol/client,
  `.opencode/doc_*` и документы TASK-DOC-CORE.
- НЕ коммитить и НЕ пушить — как в TASK-DOC-CORE (detached HEAD, push запрещён permissions).

## Статус (07.10, после этапа 8)
- L-119 и L-120 — DONE, verification PASSED (мои прогоны 19:09: typecheck код 0,
  тесты 7 pass / 0 fail / 85 expect). Оракул O-HUB-REGISTRY — VERIFIED_CMD,
  negative control выполнен (EXIT=1 на файле-фикстуре, файл удалён).
- Слепое ревью: 1 важный дефект (вызов which() в теле рендера) + 3 мелочи — все исправлены
  (createMemo, условие по missing.length, токен сверен с devtools-bar.tsx:289, +2 edge-теста).
- `dod-check .` → ИТОГ: OK; `dod-check --self-test` → зелёный (46 мутантов).
- Полный прогон tui — нестабилен под нагрузкой (сегфолт bun, флаки): чанки + A/B с
  HEAD-версией devtools-bar.tsx показали, что новых падений от этой правки нет;
  записано в known_red DoD. Третья попытка единого прогона 07.10 в 19:19 (load 29–30
  при 12 ядрах) — снова exit 139 «Bun has crashed»; падения в логе — baseline-имена
  с раздутыми таймаутами (SIGHUP 30 с, остальные 2–4 с против ~1 с в baseline).
  Полная картина после правок — чанкованный прогон тестера: 1440 тестов,
  1423 pass / 2 skip / 15 fail, каждое новое падение атрибутировано (flaky под
  нагрузкой, параллельные правки дерева, или падает одинаково и с HEAD-версией).

---

# Задача TASK-HUB-CONTROL (этап 9, 07.10)

## Цель
Панель Registry получает кнопки действий: у каждого инструмента — вкл/выкл (включённый
автоматически попадает с подсказкой в промпт модели, т.к. АИ не знает о возможностях ядра)
и Install/Remove (выполняет команду установки/удаления под платформой). Вся логика —
на уровне ядра `packages/core`; панель только вызывает и показывает результат.

## Ответы владельца (2026-10-07, инструмент question)
- Вкл/выкл = «функцию работы этих инструментов … когда включен то добавляет промпт
  автоматически (так как ии не знает что у него в ядре эти инструменты), если есть идеи
  то предлагай» → состояние вкл/выкл у инструмента, влияющее на содержимое промпта.
- Кнопки: «просто будет кнопка install справа от левого текста … нажимаешь Remove, и
  тогда оно выполнит команду по удалению, но в зависимости от Windows Linux» →
  построчная кнопка справа, без ввода текста подтверждения, команда по платформе.
- Риск (назван владельцу одной строкой): Remove без подтверждения может снять пакет,
  от которого что-то зависит; владелец выбрал прямое выполнение.

## Критерии готовности (команда → ожидаемый результат)
1. `cd ~/opencode-src/packages/core && bun typecheck` → код 0.
2. `cd ~/opencode-src/packages/core && bun test <тесты ядра этапа 9>` → 0 fail
   (состояние: чтение/запись/дефолт; промпт-блок: есть для включённого доступного,
   отсутствует для выключенного/недоступного; действия: команда по платформе,
   исполнение через внедряемый runner с проверкой exit/вывода).
3. `cd ~/opencode-src/packages/tui && bun typecheck` → 0; `bun test <тесты панели>` → 0 fail
   (строки с кнопками, состояние вкл/выкл отражается, результат действия показан).
4. `cd ~/opencode-src/packages/tui && bun test test/util/hub-registry.test.ts
   test/component/devtools-registry.test.tsx` → 0 fail (регрессия этапа 8).
5. Промпт-инъекция: юнит-тест ядра на рендер Instructions-source доказывает присутствие
   текста включённого инструмента и отсутствие выключенного (negative control — мутация).
6. `~/.config/opencode/bin/dod-check .` → `ИТОГ: OK`.

## Факты (разведка 07.10, файл:строка)
- Каталог статический TS-бандл: `packages/core/src/hub/catalog/index.ts:19-47`;
  запись `Entry{requires?,danger?,platforms?,templates}` — `hub/types.ts:26-44`.
  Состояния вкл/выкл НЕТ, выполнения install НЕТ (`install.ts:66-72` — только plan),
  uninstall НЕТ нигде.
- Промпт собирается каждый шаг: `session/model-request.ts:100-120` →
  `session/system-prompt.ts:5-28`; части — `session/context.ts:130-157`
  (`Instructions.combine([...])`), автоматической интеграции hub в промпт сейчас нет
  (grep hub вне src/hub/ — только регистрация тулзы `plugin/internal.ts:76,241`).
- Точка врезки (совпадение с прецедентом CodeModeCatalog): `session/context.ts:150-157`;
  альтернатива — хук `event.system[0]` как `plugin/optimize.ts:76-96`; hub-тулза уже
  подписана на хуки сессии `tool/plugin/hub.ts:301-309`.
- Состояние: TUI-конфиг (`tui/src/config/index.tsx:353-358` → cli.json) — НЕ подходит
  (серверный `config.update` принимает только `{shell}`, `schema/src/config.ts:112-114`);
  свой JSON — прецедент `tui/src/util/persistence.ts:22` + `model-preference.ts:1-5`,
  пути даёт `util/src/global.ts:35-44`; `util/src/fs-util.ts:111-120` readJson/writeJson
  (writeJson не атомарен).
- Выполнение: серверный `client.api.shell.create` (`client/src/effect/api/api.ts:2178-2225`),
  прецедент запуска из хаба `tool/plugin/hub.ts:240-256`; локальный spawn в TUI — только
  editor.ts (node:child_process); прямого вызова core-действия из панели ещё не было.
- Кнопки TUI: примитив `Action` (`devtools-bar.tsx:484-502`, onMouseUp, disabled, hover),
  чекбокс-образец `:337-339`, async-образец dump() `:145-231` + toast (`ui/toast.tsx`),
  вывод shell-диалог `ui/dialog-shell-output.tsx`; панель шириной 42 колонки
  (`devtools-panel.tsx:18`).

## Допущения
- PATH/TUI и сервер работают на одной локальной машине (как в этапе 8).
- sudo может запросить пароль (проверить из сессии нельзя — sudo запрещён правилами):
  падение с выводом «password required» показывается в UI, рядом остаётся текст команды.
- Состояние вкл/выкл по умолчанию: выбирает архитектор (on/off для установленных),
  обоснование размера промпта — обязательный пункт.

## Границы
- Трогать: `packages/core/src/hub/**` (+ точка врезки `session/context.ts` или хук — по
  решению архитектора), `packages/tui/src/component/devtools-registry.tsx`,
  `packages/tui/src/util/hub-registry.ts`, новые тесты в `packages/core/test` и
  `packages/tui/test`.
- НЕ трогать: protocol/client/schema (без `bun run generate`), пакеты вне списка,
  чужие параллельные правки, документы TASK-DOC-CORE.
- Не коммитить/не пушить (detached HEAD, договорённость этапа 8).

## Совет ИИ по плану этапа 9 (07.10; deepseek + gemini, chatgpt — нет полей ввода, qwen — нет вкладки)
- ИИ: DeepSeek — core-first верен; state хранит ТОЛЬКО enabled (installed — из probe, не истина);
  renderHubHints отдельным модулем, в context.ts только регистрация Source; Remove — two-step;
  массовую Install убрать; тесты: пустое состояние → промпт без изменений, cap 0/1/8/50,
  fake-runner exit 0/1, битый JSON → off.
- ИИ: Gemini — согласен по state/runner/фильтру enabled&&installed; ПРОТИВ кэша подсказок
  (installed меняется снаружи, сборка строки каждый шаг дешевле валидации кэша); ПРОТИВ
  парсинга «password required» (зависим от локали и версии sudo) — достаточно exit!=0
  и показать команду. Раунд 1 у Gemini был пустой («Wolker2000, спрашивайте!»), позиция — в раунде 2.
Итог (лид): беру — разделение state/runtime, отдельный модуль рендера, отказ от парсинга
stderr (по exit-коду), Remove в ДВА клика (без ввода текста — как просил владелец), без кэша.
Не беру — argv-переустройство planFor (команды собираются только из фиксированного кода
каталога, пользовательского ввода нет — инъекции неоткуда; правило AGENTS: не усложнять
ради гипотетического края), lock/fsync (принят last-write-wins при temp+rename),
клавиатурная навигация (весь devtools-бар мышиный, выделение scope).

## Статус: этап 9 СДАН (07.10 22:54, лид)
- L-121..L-125 — DONE/PASSED; оракулы O-HUB-STATE, O-HUB-PROMPT, O-HUB-CONTROL —
  VERIFIED_CMD, отрицательные контроли выполнены (exit 1, фикстуры удалены).
- Полный O-HUB-CONTROL 07.10 22:50 → exit 0: core 24 pass / 0 fail, tui 17 pass / 0 fail.
- @tester: 8/8 PASS (включая честность якорей dod и opt-in-тесты). Слепое @reviewer:
  1 MAJOR (имя вне каталога дошло бы до sh -c — allowlist KNOWN в actions.ts + тест
  hub-actions.test.ts:112), 2 MINOR (мёртвый selected, параллельные записи hub.json) —
  все исправлены, повторный визит: «ЗАКРЫТА» ×3. dod-check → OK.
- L-125 лид доделал сам: 5 запусков сабагентов подряд убиты рестартами сервера.
