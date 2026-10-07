# @opencode/util — служебный слой ядра

## Что это

Самый нижний слой opencode: 44 файла, ~4.5 тыс. строк в `src/`. Здесь нет ни сессий,
ни моделей, ни интерфейса — только то, что нужно любому другому пакету: где на диске
лежат данные opencode, как взять блокировку файла, как посчитать хеш, как запустить
процесс, как собирать слои Effect.

Пакет подключается поимённо: `@opencode/util/*` отдаёт любой файл из `src/`
(`@opencode/util/global`, `@opencode/util/hash`, `@opencode/util/glob`). Карта
экспортов в `packages/util/package.json`:

```json
"exports": {
  "./effect/layer-node": "./src/effect/layer-node.ts",
  "./*": "./src/*.ts"
}
```

Два условных импорта (`#global-roots`, `#runtime-import`) выбирают вариант по рантайму:
на workerd (Cloudflare) один файл, на bun/node — другой. Определения рантайма в коде
нет, только условие сборки.

## Слои и зависимости

Слой **L0 — лист**: внутри opencode не зависит ни от одного пакета `@opencode/*`
(в `dependencies` их нет). Внешних зависимостей много: `effect`, `cross-spawn`, `glob`,
`minimatch`, `open`, `pacote`, `@npmcli/arborist` — работа с npm-пакетами тоже здесь.

Кто им пользуется (число импортов `@opencode/util` в `packages/*/src`):

| Пакет | Импортов |
| --- | --- |
| `packages/core/src` | 232 |
| `packages/cli/src` | 49 |
| `packages/app/src` | 37 |
| `packages/tui/src` | 19 |
| `packages/gui-extensions/src` | 18 |
| `packages/session-ui/src` | 13 |
| `packages/server/src` | 11 |
| `packages/simulation/src` | 3 |
| `packages/sdk/src` | 3 |
| `packages/plugin/src` | 2 |
| `packages/enterprise/src` | 2 |

Правка здесь ломает всё остальное: 11 пакетов стоят на нём.

## Подсистемы и файлы

**Где живут данные opencode** — `packages/util/src/global-roots.ts` и `global.ts`.
`roots("opencode")` собирает пять каталогов из XDG-переменных:
`~/.local/share/opencode` (data), `~/.cache/opencode` (cache), `~/.config/opencode`
(config), `~/.local/state/opencode` (state), `os.tmpdir()/opencode` (tmp).
На workerd домашнего каталога нет, поэтому есть второй файл
`packages/util/src/global-roots.workerd.ts`: там все корни сводятся к одному
временному каталогу.

**Блокировки файлов** — два механизма:

- `packages/util/src/effect-flock.ts` — Effect-сервис `EffectFlock` с API
  `acquire(key, dir?, options?)` и `withLock(body, key, dir?)`. Примитив — атомарный
  `mkdir` (аналог O_EXCL в POSIX). Попытка создаёт каталог
  `<state>/locks/<sha1 от ключа>.lock` и кладёт в него `meta.json` (токен, pid,
  hostname, время) и файл `heartbeat`. Пока блокировка держится, отдельная fiber
  обновляет `heartbeat` каждые `staleMs / 3`. Если heartbeat старый, блокировка
  считается осиротевшей: снимает тот, кто первым создал каталог-выключатель
  `<lock>.breaker`, и только после повторной проверки. Снятие сверяет токен в
  `meta.json` с токеном держателя.
- `packages/util/src/flock.ts` — низкоуровневый вариант без Effect.

**Хеши** — `packages/util/src/hash.ts`: `Hash.fast` (sha1 — имена файлов и ключи
блокировок) и `Hash.sha256` (сравнения по существу).

**Файлы и пути** — `packages/util/src/fs-util.ts` (файловые операции как Effect-сервис),
`packages/util/src/path.ts` (склейка путей, тесты в `path.test.ts`),
`packages/util/src/glob.ts`, `packages/util/src/encode.ts`.

**Процессы** — `packages/util/src/cross-spawn-spawner.ts` (запуск в обход проблем
Windows), `packages/util/src/process.ts`, `packages/util/src/open.ts` (открыть файл
или URL в приложении системы).

**Работа с npm** — `packages/util/src/npm.ts` и `packages/util/src/npm-config.ts`:
конфигурация npm и разбор имён пакетов. Отсюда плагины ставят пакеты, не вызывая
npm вручную.

**Директория `effect/`** — сборка слоёв DI: `layer-node.ts` (LayerNode-граф),
`app-node.ts`, `keyed-mutex.ts`, `websocket-constructor.ts`.

**Директория `runtime/`** — загрузка модулей под конкретный рантайм;
`packages/util/src/runtime-import.ts` — точка входа к Bun-специфичным возможностям.

**Прочее** — `artifact.ts`, `binary.ts`, `bom.ts`, `activity-calendar.ts`, `patch.ts`,
`retry.ts`, `session-title-fallback.ts`, `observability.ts` и каталог
`packages/util/src/observability/`.

## Точки входа

1. `packages/util/src/global.ts` — экспортирует `Path` со всеми корнями; с него
   начинается код, которому нужен путь на диске.
2. `packages/util/src/global-roots.ts` — функция `roots(app)`, единственное место,
   где читаются переменные `XDG_*`.
3. `packages/util/src/effect-flock.ts` — `EffectFlock.Service` и `EffectFlock.withLock`.
4. `packages/util/src/hash.ts` — `Hash.fast`, `Hash.sha256`.
5. `packages/util/src/effect/layer-node.ts` — единственная подсистема, помеченная в
   `package.json` отдельной строкой `exports`.

Своих точек входа у пакета нет: он подключается только поимённо, через карту `exports`.

## На что смотреть дальше

- `packages/schema/PACKAGE.md` — типы данных: всё, что util кладёт на диск,
  описывается там.
- `packages/protocol/PACKAGE.md` — контракты эндпоинтов, через которые эти данные
  передаются наружу.
- `packages/core/PACKAGE.md` — главный потребитель (232 импорта): подсистемы
  `database` и `config` построены на этом слое.
- `packages/cli/src/services/service-config.ts` — каналы и порты службы; объясняет,
  почему состояние лежит в подкаталогах `state/`.
- `packages/core/src/database/database.ts` и `packages/core/src/config.ts` — как
  ядро применяет `global.ts` и `EffectFlock` на практике.

## Ловушки

1. **Правка `global-roots.ts` переносит все данные opencode.** Смена пути не мигрирует
   старую базу: `opencode.db` просто перестанет находиться.
2. **`EffectFlock` — не `flock(2)`.** Примитив — `mkdir`, состояние держится в
   `heartbeat`. Процесс, убитый без снятия блокировки, оставляет её висеть до
   `staleMs` (по умолчанию 60 секунд) — следующий претендент ждёт это время.
3. **Снять чужую блокировку нельзя**, а вот сломать свою можно: `release` сверяет
   токен из `meta.json` с токеном держателя и падает при несовпадении.
4. **Каналы состояния.** Файлы в `state/` разводятся по каналам; чтение не того
   подкаталога даёт правдоподобные данные из мёртвого файла. Каналы описаны в
   `packages/cli/src/services/service-config.ts`.
5. **Каталог `effect/` — не «эффекты в удобстве».** Там сборка слоёв DI: правка
   `layer-node.ts` меняет порядок инициализации сервисов ядра.
6. **`OPENCODE_TEST_HOME` подменяет домашний каталог** в `paths.home` файла
   `packages/util/src/global.ts` — на этом стоят тесты пакета.