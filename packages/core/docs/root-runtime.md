# core/src — шина событий, RPC, состояние, джобы и корневые сервисы ядра

## Назначение

Работающий слой ядра: как события публикуются и переигрываются, как по ним строится
локальное состояние, как внешние вызовы приходят в сервисы и уходят обратно, чем живёт
реестр инструментов и как усекается их вывод. Отдельно четыре мелочи без слота: MIME по
сигнатуре байт, переэкспорт схем, подписчик на шину и политики консоли.

## Что в папке

Четырнадцать файлов корня `src`. Сквозные сервисы: `bus`, `rpc`, `state`, `job`, `session`,
`tool`, `tool-output`, `command`, `form`, `instance`. Мелкие: `event-logger`, `mime`,
`schema`, `managed-policy`. Все сервисы на Effect: `Context.Service` + `Layer` + узел
`makeLocationNode`/`makeGlobalNode` с явными зависимостями.

## Ключевые файлы

- `bus.ts` — шина событий. Три `PubSub`: `live` (unbounded), `durable` (карта агрегат →
  набор `sliding(1)`-будильников), `typed` (карта тип → unbounded). Долговечное событие идёт
  под `KeyedMutex` агрегата в одной транзакции (`behavior: "immediate"`, без прерывания):
  последний `seq`, проекторы, `commit`-хук, обновление `EventSequenceTable` через
  `max(seq, …)` и при `persist` запись в `EventTable`. `prepareRoutes` отдаёт замыкание,
  применяемое только после коммита. `log()` при `follow: true` подписывается ДО чтения
  истории, снимает `latestSequence`, отдаёт `log.synced` и переходит в живой режим. Есть
  `replay`, `remove`, `claim` и устаревший `listen`.
- `rpc.ts` — вызовы по схеме. `register` кладёт `{definition, handlers}` в массив под
  `rpcID` и возвращает `{dispose, events.emit}`; `call` берёт последнюю регистрацию
  (`at(-1)`) и прогоняет вход и выход через `parse`/`encode`. Ошибки кодируются как
  `{type, message, data?}`: `rpc.unavailable`, `rpc.method_not_found`,
  `rpc.invalid_input`, `rpc.invalid_output`, `rpc.internal`. `close` — значение `Effect`, а не
  функция; вызовы соревнуются с `Deferred.await(closed)` через `raceFirst`, чтобы длинный
  RPC отпускал локацию. Схемы понимают схемы Effect, Standard SchemaV1 (ключ
  `~standard`) и JSON Schema (кодек кэшируется в `WeakMap`).
- `state.ts` — переигрываемое состояние. `create({initial, editor, notify})` держит набор
  transform-колбэков; `get()` пересобирает значение только при `dirty`, каждый раз создаёт
  новый объект и никогда не трогает прежние. Правки идут через `transform`, который
  цепляется финализатором `Scope`. `batch()` копит уведомления и шлёт одно в конце,
  `shutdown()` навсегда закрывает изменённые состояния. `group(report)` отвязывает State от
  идентичности плагина: исключение внутри transform отключает всю группу и зовёт `report`;
  негруппированные исключения пробрасываются. Ещё `invalidate()`, `revision()`, `inherit()`
  и `reconcile`.
- `job.ts` — реестр работ. Работа получает `Scope.fork(state.scope, "parallel")`,
  `Deferred` завершения `done`, отдельный `Deferred` фонового перевода `backgrounded` и
  счётчик `blockingSessions` с референс-счётом по сессиям. `start` не перезапускает идущую
  работу. `block` соревнует `done` и `backgrounded`; `backgroundAll` берёт только работы,
  блокирующие указанную сессию. Восстанавливаемые работы (`recovery`: `shell` или
  `subagent`) пишутся в `KV` под префиксом `job.background/` и живут до
  `completeBackground(notificationID)`. История израсходованных работ без `notificationID`
  ограничена 25 записями.
- `session.ts` — сервис сессий. `CreateInput` — союз: либо `location`, либо `parentID`, но не
  оба; отсутствие обоих даёт `Effect.die`, повторный `create` с тем же id возвращает уже
  записанную сессию. `fork` берёт последнее сообщение по убыванию `seq` и наследует
  `InstructionState` и `InstructionEntry` родителя одной транзакцией — новейшие значения, а
  не те, что действовали на границе. Остальное делегировано пообъектно:
  `sessions.forSession(id).*` — `prompt`, `shell`, `skill`, `synthetic`, `compact`, `wait`,
  `resume`, `interrupt`, `revert`, `inbox`. Узел глобальный, шестнадцать зависимостей.
- `tool.ts` — реестр инструментов. Регистрация проверяет сегменты namespace, имя
  `/^[A-Za-z0-9_-]{1,128}$/`, запрет `execute` при `codemode: false` и собирает
  `ToolDefinition`; ошибка не бросается, а копится в `Data.errors` и уходит в лог.
  `snapshot(permissions)` отсекает полностью запрещённые правилами действия, делит
  инструменты на прямые и code-mode и возвращает `definitions` вместе с `execute`. Та зовёт
  хуки `tool.execute.before` и `tool.execute.after`. Картинки проходят `normalizeImages`:
  нечитаемые заменяются строкой с числом пропущенных файлов.
- `tool-output.ts` — усечение вывода. Пределы `MAX_LINES = 2_000` и `MAX_BYTES = 50 * 1024`,
  полный текст хранится 7 дней в подкаталоге `tool-output` глобальных данных. `truncate` —
  no-op, если `metadata.truncated` уже задан; иначе склеивает текстовые части, пишет ПОЛНЫЙ
  текст в файл `Identifier.ascending("tool")` и вставляет маркер вида `lines 1-N of M`.
  Элементы типа `file` не урезаются никогда. Уборка раз в час отдельным глобальным узлом.
- `command.ts` — именованные команды. Ключ реестра — `definition.name`, поэтому повторная
  регистрация с тем же именем заменяет предыдущую; публикуется `Command.Event.Updated`,
  неизвестное имя даёт `Command.NotFoundError`, ошибка исполнения логируется и
  оборачивается в `Command.ExecutionError`.
- `form.ts` — формы для вопросов пользователю. Живут в `Cache` с бесконечным TTL, пока
  статус `pending`, и с retention 10 минут после. `create` и `reply` непрерываемы; `ask`
  ждёт `Deferred` под маской и при прерывании отменяет форму. `validateFields` требует
  хотя бы одно поле, уникальные ключи и условия `when`, ссылающиеся только на более ранние
  поля, с типом значения, совпадающим с типом целевого поля. `close` отменяет все висящие
  формы и навешен как финализатор слоя.
- `instance.ts` — сборка графа локации. Массив `nodes` перечисляет 53 узла с сервисами
  локации; `Services` и `Error` выводятся из `LayerNode.group(nodes)`.
  `Options.discovery: false` подменяет `Config` и `InstructionDiscovery` на не сканирующие
  (`{project: false, global: false}`), но НЕ отключает подмешивание вложенных `AGENTS.md`
  при чтении файла. Порядок подмен: ванильные значения, подмены вызывающего, затем
  привязки локации и списка плагинов. Глобальные узлы шарятся между инстансами через
  `shared: Node.tags.values.global`.
- `event-logger.ts` — подписчик на шину. Через устаревший `listen` логирует в
  `Effect.logInfo` только пять типов: `agent.updated`, `provider.updated`, `model.updated`,
  `command.updated`, `config.updated`. Финализатор снимает подписку.
- `mime.ts` — определение типа по сигнатуре: PNG, JPEG, GIF, BMP, PDF, WEBP (`RIFF` +
  `WEBP` со смещения 8) и AVIF (`ftyp` со смещения 4 плюс `avif`/`avis` со смещения 8).
  Дальше `text/plain`, если байты похожи на текст, иначе `application/octet-stream`. Текстом
  считается непустой буфер без нулевых байт, строгая расшифровка UTF-8 и не более 30%
  управляющих байт.
- `schema.ts` — переэкспорт `AbsolutePath`, `DateTimeUtcFromMillis`, `NonNegativeInt`,
  `optional`, `PositiveInt`, `RelativePath`, `statics` и тип `DeepMutable`; кода нет.
- `managed-policy.ts` — политики подключённой консоли OpenCode: массив `ConfigPolicy.Info`
  и необязательное имя организации. `current()` синхронный намеренно — преобразования
  каталогов читают утверждения во время работы; `set()` заменяет состояние целиком, а
  утверждения из разных подключений не сливаются. Узел глобальный, без зависимостей.

## Важные детали

- Долговечность события задаёт само определение события: поле `durable` с именем агрегата и
  номером версии. Поле агрегата обязано быть строкой, иначе публикация падает дефектом
  `Bus.InvalidDurableEvent`.
- Нарушения инвариантов в `bus.ts` и `rpc.ts` — это `Effect.die`, а не типизированные
  ошибки: расхождение при replay, несовпадение владельца, неверная последовательность и
  необъявленный тип ошибки RPC в канал ошибок не попадают.
- `bus.ts` импортирует `Location` и `SessionTable` отложенным `import()` внутри слоя:
  статический импорт замкнул бы цикл `bus → location → project → bus` и упал на привязках
  узлов из-за temporal dead zone.
- `tool.ts` и `command.ts` не бросают исключений на плохую регистрацию: плохой инструмент
  или команда просто не появляются. Ключ реестра в `tool.ts` — не `name`, а `effectiveName`,
  а `update` жёстко возвращает прежние `name` и `namespace`.

## Связи

- `packages/core/src/event/sql.ts` и `packages/core/src/database/database.ts` — таблицы
  событий и доступ к базе для `bus.ts`.
- `packages/core/src/session/store.ts` — `ListInput` и история сообщений для `session.ts`;
  `packages/core/src/session/diff.ts` и `packages/core/src/location-service-map.ts` — дифф хода.
- `packages/core/src/session/execution.ts`, `packages/core/src/session/model-transport.ts` и
  `packages/core/src/session/projector.ts` подключены к `session.ts` как узлы;
  `packages/core/src/kv.ts` — и к нему, и к `job.ts`.
- `packages/core/src/file-retention.ts`, `packages/core/src/id/id.ts` и
  `packages/core/src/tool/runtime.ts` — зависимости `tool-output.ts` и `tool.ts`;
  `packages/core/src/plugin/hooks.ts` и `packages/core/src/image.ts` — хуки и картинки.
- `instance.ts` перечисляет `Command`, `Rpc`, `Tool`, `ToolOutput`, `Form` и `Session` среди
  прочих узлов, собирая их в один граф локации; `event-logger.ts` зависит только от шины.

## Ловушки

- `bus.ts` по умолчанию не сохраняет payloads (`persist: false`): последовательности растут,
  а историческое чтение `log` не вернёт ничего.
- `log()` в `bus.ts` пропускает типы, которых нет в манифесте долговественных событий, и
  двигает курсор по сырой последней `seq` — номер `log.synced` может быть больше последнего.
- Порядок применения маршрутов привязан к коммиту транзакции: провалившаяся транзакция
  переноса сессии не перенаправит события в сторону несуществующего места.
- `DeepMutable` в `schema.ts` — локальная замена: ветка объекта ограничена
  `extends object`, иначе `unknown` схлопывается в `{}`; примитивы проверяются первыми.
- `call` в `rpc.ts` берёт последнюю регистрацию: повторная регистрация перебивает прежнюю.
- `tool-output.ts` пишет полный вывод на диск ДО усечения и независимо от того, сколько строк
  поместилось: файл появляется даже при маркере `0 lines`.
- `form.ts` считает условие ложным для обоих операторов, если зависимое поле не ответили;
  вместе с запретом отвечать на скрытое поле это каскадом обнуляет все ссылки на него.
- `form.ts` публикует событие ответа до обновления состояния и до завершения ожидающего
  `Deferred`: подписчик на `Form.Event.Replied` ещё не увидит `answered` в кэше.
- `job.ts` не убирает завершённую восстановленную работу из памяти: запись в `KV` снимается
  только через `completeBackground` по `notificationID`.
