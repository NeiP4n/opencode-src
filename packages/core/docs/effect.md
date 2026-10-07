# core/effect — сборка графа слоёв: подстановка per-location сервисов и платформенные реализации

## Что в папке

- `app-node-builder.ts` — функция `build`: превращает граф узлов в готовый `Layer`, подменив узел `Instance` и карту сервисов по location.
- `app-node-platform.ts` — готовые платформенные узлы: исполнитель HTTP-запросов, клиент LLM и конструктор WebSocket.
- `websocket-constructor.ts` — реализация конструктора WebSocket с учётом прокси и переменных окружения.
- `keyed-mutex.ts` — блокировки по ключу: одна очередь на ключ, независимые ключи выполняются параллельно.
- Все файлы — точки сборки внедрения зависимостей. Здесь нет бизнес-логики ядра.

## Ключевые файлы

- `packages/core/src/effect/app-node-builder.ts` — `build`, приватный узел `instances`.
- `packages/core/src/effect/app-node-platform.ts` — `requestExecutor`, `llmClient`, `webSocketConstructor`.
- `packages/core/src/effect/keyed-mutex.ts` — `makeUnsafe`, `make`, `KeyedMutex`.
- `packages/core/src/effect/websocket-constructor.ts` — `WebSocketConstructor` с полями `layer` и `proxy`.

## Важные детали

- `build(root, replacements)` формирует две подстановки: собственную реализацию `Instance.Service` и переданные вызывающим замены. Собственная реализация поднимается из `LocationServiceMap.Service` и отдаёт `Effect.provide(locations.get(session.location))` — ровно та подстановка, которую объявляет контракт в `packages/core/src/instance/service.ts`.
- Подмены применяются дважды и по-разному: `LocationServiceMap.node.replace(buildLocationServiceMap(bindings))` собирает карту сервисов с учётом замен, а `Instance.node.replace(instances)` — сам узел инстанса. Пропуск любой из двух подстановок оставит в графе несвязанный узел.
- Замены кладутся в один массив `bindings`, который одновременно является и списком для карты сервисов, и набором подмен самого `Instance`. Экономия достигается тем, что сервисы, заменённые снаружи, видны и в карте location, и в инстансе.
- `app-node-platform.ts` объявляет три узла с явными зависимостями: `requestExecutor` требует `httpClient` из `@opencode/util/effect/app-node-platform`, `llmClient` — `requestExecutor`, `webSocketConstructor` — ничего.
- Конструктор WebSocket выбирает реализацию по наличию глобального `Bun`. В Bun используется `globalThis.WebSocket` с полями `headers`, `protocols` и опциональным `proxy`. В Node — `NodeWS.WebSocket` из `@effect/platform-node/NodeSocket` с агентом прокси и `followRedirects: false`. Отключение редиректов объяснено комментарием: иначе заголовки могут пересечь границу origin, и вызывающий безопасно откатится на HTTP.
- Выбор прокси учитывает `WS_PROXY`/`WSS_PROXY`, затем `HTTP_PROXY`/`HTTPS_PROXY`, затем `ALL_PROXY`. Имя переменной ищется сначала как есть, потом в нижнем регистре — на Windows это важно.
- `NO_PROXY` разбирается вручную: список через пробелы и запятые, `*` означает «всё», запись `host:port` сравнивается с портом, а ведущая точка в имени означает суффиксное совпадение. Отдельный случай: `127.0.0.1`, `localhost` и `::1` проксируются всегда, независимо от `NO_PROXY`.
- Агент прокси выбирается по схеме: `wss:` или прокси с `https:` дают `HttpsProxyAgent`, иначе `HttpProxyAgent`. Это важное отличие от большинства клиентов, где `wss` сам по себе не требует HTTPS-прокси, но здесь решение принимается по обоим признакам.
- В Bun доверие остаётся в хранилище времени выполнения, чтобы `NODE_EXTRA_CA_CERTS` продолжал работать как дополнение. Это же зафиксировано комментарием.
- `constructorOptions` приводит вход Effect, который приходит браузероподобным объектом, к `{ headers, protocols }`. Строка и массив строк трактуются как список протоколов, всё прочее — как опции рукопожатия.
- `WebSocketConstructor.proxy` вынесен наружу вместе со слоем: правила выбора прокси можно проверить без запуска сокета.
- `KeyedMutex.makeUnsafe` хранит `Map` вида ключ → `{ semaphore, users }`. Счётчик `users` растёт на каждом входе в `withLock` и падает в `Effect.ensuring`, поэтому запись удаляется из карты только когда не осталось ни владельцев, ни ожидающих. Это и есть защита от того, что ожидающий воспользуется уже удалённой записью.
- Тело критической секции всегда оборачивается в `semaphore.withPermit(effect)`, то есть блокировка покрывает и успех, и отказ. Снятие блокировки происходит в `ensuring`, а не в успешном пути.
- `size` отдаёт `Effect.sync(() => locks.size)` — это синхронный снимок, который сам по себе не гарантирует, что следующая операция увидит ровно столько же записей.
- В шапке `websocket-constructor.ts` зафиксирована причина узкой реализации: платформенный barrel ещё экспортирует Redis с опциональным нативным загрузчиком хэшей, который workerd не может разобрать. Поэтому этот файл импортирует `@effect/platform-node/NodeSocket` напрямую.

## Связи

- `packages/core/src/instance/service.ts` — контракт, который реализует `app-node-builder.ts`.
- `packages/core/src/location-service-map.ts` и `packages/core/src/location-services.ts` — карта сервисов по location, из которой `build` собирает подстановку.
- `packages/util/src/effect/app-node.ts` и `packages/util/src/effect/layer-node.ts` — конструкторы `makeGlobalNode`, `LayerNode.unbound`, `LayerNode.compile`, `LayerNode.replace` и `Node.tags`, на которых стоит вся папка.
- `packages/util/src/effect/app-node-platform.ts` — источник `httpClient`, от которого зависит `requestExecutor`.
- `packages/core/src/effect/keyed-mutex.ts` — потребители найдены поиском по `KeyedMutex`: `packages/core/src/bus.ts`, `packages/core/src/file-mutation.ts`, `packages/core/src/git.ts`, `packages/core/src/mcp/index.ts`, `packages/core/src/plugin/update.ts`, `packages/core/src/session/inbox.ts`, `packages/core/src/workspace.ts`. То есть блокировка по ключу нужна везде, где один и тот же ресурс могут править два потока.
- `packages/ai/src/route` — источник `LLMClient` и `RequestExecutor`, которые объявляются узлами в `app-node-platform.ts`.
- `effect/unstable/socket` — тип `Socket.WebSocketConstructor`, который реализует слой.
- `packages/core/docs/instance.md` — документ по контракту, который здесь реализуется.

## Ловушки

- `build` требует подменять и `Instance`, и карту сервисов. Замена только одного из них даст граф, который компилируется и падает при первом `provide` в середине работы.
- На Bun путь через `globalThis.WebSocket` расширяется полем `proxy`, которого нет в стандартном типе. В коде это подавление проверки типов с объяснением в комментарии; удалять комментарий и подавление нельзя, пока код обращается к нестандартному полю.
- В Node отключены редиректы. Клиент, который полагался на автоматическое следование редиректу, получит ответ с кодом перенаправления и должен обработать его сам — с безопасным откатом на HTTP.
- `NO_PROXY` парсится вручную и не понимает записи сCIDR или без точки в начале. Домен, который пользователь записал как `example.com`, совпадёт только с этим доменом, а не с поддоменами: для поддоменов нужна ведущая точка.
- `KeyedMutex` удаляет запись, когда счётчик `users` падает до нуля. Между удалением и следующим входом карта снова создаст семафор, поэтому две последовательные критические секции по одному ключу не гарантированно попадут в одну очередь — это не блокировка уровня транзакции.
- `makeUnsafe` не имеет области жизни: блокировки живут, пока жив объект. Создавать его на каждый запрос нельзя, иначе сериализация перестанет работать.
