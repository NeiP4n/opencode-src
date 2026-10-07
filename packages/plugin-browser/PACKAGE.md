# @opencode/plugin-browser — плагин доступа к браузеру

## Что это

Плагин `opencode.browser`: 7 файлов, ~1.5 тыс. строк в `src/`. Даёт модели
инструменты для работы с браузером — открыть страницу, прочитать файл,
показать вкладку — и держит соединение с браузером через прокси и туннель.

Пакет подключается как плагин (`export default Plugin.define(...)`), а
также отдаёт два отдельных модуля для низкоуровневого доступа.

## Слои и зависимости

Слой **L2**: зависит от `plugin` (хост) и `schema` (типы, включая
`TabID` и `Ref` — regex-проверенные строки).

Кто подключает:

- `packages/core` — регистрация плагина в сессии;
- `packages/gui-extensions` — инструменты браузера в расширениях.

Экспорт (`packages/plugin-browser/package.json`):

```json
".": "./src/index.ts",
"./rpc": "./src/rpc.ts",
"./proxy": "./src/proxy.ts"
```

## Подсистемы и файлы

**Точка подключения** — `packages/plugin-browser/src/index.ts` (13 строк):
`Plugin.define({ id: "opencode.browser", effect: ... })`; внутри
`BrowserConnection.make(ctx)` открывает соединение, затем
`BrowserTools.register(ctx, connection)` регистрирует инструменты.

**Соединение** — `packages/plugin-browser/src/connection.ts` →
`BrowserConnection.make(...)`, тип `Connection` выведен из результата
(`Effect.Success<ReturnType<typeof make>>`).

**Инструменты** — `packages/plugin-browser/src/tools.ts`:
`BrowserTools.register(...)` и `normalizeAction(action)` — приведение
действий к единому виду.

**RPC-схема** — `packages/plugin-browser/src/rpc.ts` (namespace `Browser`):
константы `MAX_FILE_BYTES` (5 МБ), `TUNNEL_CHUNK_BYTES` (64 КБ),
`MAX_TEXT` (100 000 символов) и схемы `TabID`
(`/^tab_[a-f0-9-]{36}$/`), `Ref` (`/^@?e[1-9][0-9]*$/`).

**Прокси** — `packages/plugin-browser/src/proxy.ts` → `BrowserProxy.make(
transport)`: тип `Transport`, тип `Proxy`. В комментарии к файлу прямо
сказано: desktop-only, серверный плагин его не загружает.

**Файлы** — `packages/plugin-browser/src/files.ts` → `BrowserFiles.read`,
`BrowserFiles.save`, `captureName(name)`: файлы переезжают между машинами
как байты, пути interpreтит только этот endpoint; `captureName` отсекает
`.`/`..` и Windows-устройства вроде `CON.txt`.

**Туннель** — `packages/plugin-browser/src/tunnel.ts` →
`BrowserTunnel.make()`: один инстанс на одно подключение desktop;
backpressure дают сокеты, а не буфер в памяти.

## Точки входа

1. `packages/plugin-browser/src/index.ts` — `export default`, так плагин
   попадает в сессию.
2. `packages/plugin-browser/src/rpc.ts` — типы и лимиты протокола
   (экспорт `./rpc`).
3. `packages/plugin-browser/src/proxy.ts` — транспорт прокси (экспорт
   `./proxy`), только для desktop-части.

## На что смотреть дальше

- `packages/plugin/PACKAGE.md` — `Plugin.define`, контекст и Effect-вариант.
- `packages/core/PACKAGE.md` — где плагин подключается к сессии.
- `packages/gui-extensions/PACKAGE.md` — потребитель инструментов.
- `packages/schema/PACKAGE.md` — типы, которые сидят в RPC-схеме.

## Ловушки

1. **`proxy.ts` — desktop-only.** Импорт его из серверного кода не даст
   рабочего подключения: слушатель там специально не загружается.
2. **Лимиты объявлены в `rpc.ts` и не обсуждаются.** Файл больше 5 МБ
   или текст длиннее 100 000 символов будет отклонён на уровне схемы —
   ошибки ищутся здесь, а не в `files.ts`.
3. **`TabID` и `Ref` — не обычные строки.** Схема с regex: неверный формат
   не пройдёт валидацию до отправки; в тестах это выглядит как «строка
   не принимается».
4. **`files.ts` — единственное место, где трактуются пути.** Файлы приходят
   как байты; попытка обработать путь на другой стороне даёт неверный
   результат, это прямо помечено комментарием в файле.
