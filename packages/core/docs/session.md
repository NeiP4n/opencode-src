# core/session — сессия целиком: входящие, проекция, исполнение и сборка запроса к модели

## Что в папке

- 49 файлов `.ts` (около 10 500 строк) плюс `packages/core/src/session/runner/prompt/system.txt`.
- Подпапки: `runner/` — цикл выполнения шага (9 файлов), `execution/` — только `restart.ts` с восстановлением после перезапуска.
- Слои по назначению: публичный фасад (`session.ts`), проекция событий в БД (`projector.ts`, `message-updater.ts`), хранение (`sql.ts`, `store.ts`, `info.ts`), входящие (`inbox.ts`), исполнение (`execution.ts`, `run-coordinator.ts`), сборка запроса (`model-request.ts`, `model-transport.ts`, `provider-context.ts`, `affinity.ts`), история (`history.ts`, `compaction.ts`, `instruction-state.ts`, `instruction-entry.ts`, `instructions.ts`), прочее (`usage.ts`, `diff.ts`, `revert.ts`, `title.ts`, `stats.ts`, `transfer.ts`, `subagent-job.ts`, `subagent-completion.ts`, `move.ts`, `generate.ts`, `system-prompt.ts`, `command.ts`, `shell.ts`, `skill.ts`, `environment.ts`, `error.ts`, `to-session-error.ts`, `schema.ts`, `event.ts`, `message.ts`).
- Общий принцип: `session.ts` только публикует события через шину, а единственный код, который пишет в таблицы во время работы, — проектор `projector.ts`.

## Ключевые файлы

- `packages/core/src/session/session.ts` — фасад. `make()` собирает сервис один раз в host Scope, `forSession(id)` возвращает ручку с уже привязанным `sessionID`.
- `packages/core/src/session/projector.ts` — все `bus.project(...)`: создание, переименование, форк, доставка входа, терминалы исполнения, откат, суммы токенов.
- `packages/core/src/session/message-updater.ts` — чистая функция: событие плюс адаптер дают новое сообщение; вся работа с БД живёт в адаптере проектора.
- `packages/core/src/session/sql.ts` — таблицы `session_v2`, `session_message`, `session_pending`, `session_inbox`, `instruction_entry`, `instruction_blob`, `instruction_state`.
- `packages/core/src/session/store.ts` — чтение сессий и сообщений плюс «claim» исполнения (`claim`, `release`, `releaseChildClaims`, `countResume`, `listSuspended`).
- `packages/core/src/session/inbox.ts` — приём входа, переключение `steer`/`queue`, выборка promotable, проекции строк.
- `packages/core/src/session/execution.ts` — маршрутизация по `Session ID` в раннер выбранного Location и терминальные события.
- `packages/core/src/session/run-coordinator.ts` — одна fiber на «занятый период», дверной колокольчик `pendingWake`.
- `packages/core/src/session/execution/restart.ts` — восстановление сессий с невыпущенным claim после падения или перезапуска.
- `packages/core/src/session/runner/llm.ts` — цикл `drain`: вход → контекст → шаг → шаг; выход `Complete`/`Moved`/`Reloaded`.
- `packages/core/src/session/runner/step.ts` — одна попытка шага: стрим провайдера, инструменты, расчёт ошибок и результат `Outcome`.
- `packages/core/src/session/runner/publish-llm-event.ts` — перевод событий провайдера в события сессии с батчингом дельт.
- `packages/core/src/session/model-request.ts` — сборка запроса, лимит ответа, фильтры медиа, крюки плагинов, HTTP- и WebSocket-обёртки.
- `packages/core/src/session/compaction.ts` — сжатие истории: локальное резюме или нативное окно провайдера.
- `packages/core/src/session/history.ts` — какие сообщения попадают в запрос и с какой нижней границей.

## Важные детали

- `Session.prompt`, `synthetic`, `compact`, `skill`, `steerInbox` по умолчанию будит сессию (`execution.wake`); отключается флагом `resume: false`. Приём входа идёт под `SessionInbox.serialized`, подготовка промпта — вне блокировки, под маской `uninterruptibleMask`.
- Заявленный откат коммитится только после успешной подготовки нового входа и до его приёма (`SessionRevert.commit` внутри `Session.prompt`).
- `Session.shell` форкает работу и ждёт: сервер сам дописывает результат, даже если отправивший клиент отвалился.
- Проектор — единственное место записи в `session_message` во время работы; исключение — импорт в `transfer.ts`, который вставляет строки напрямую в той же транзакции, что и событие создания.
- Claim пишется в коммит-хуке события `Execution.Started`, снимается на терминале; оба хука держат `time_updated` присваиванием самому себе, чтобы запись не выглядела активностью пользователя.
- `time_idle` растёт как `max(now, time_idle + 1)`, `time_viewed` как `max(idle, coalesce(time_viewed, idle))` — «непрочитанное» определяется строгим сравнением меток.
- `run-coordinator.ts`: `wake` на активном ключе не прерывает работу, а звонит в дверь; слитые пробуждения сохраняют самый широкий scope («input» шире, чем «steer»). Остановленный execution отказывает новым участникам и передаёт их преемнику.
- `inbox.ts`: таблица хранит только невыданное; повтор того же `id` в той же сессии и типе идемпотентен, несовпадение даёт `LifecycleConflict`. Проекторы сообщают конфликт дефектом, а публикации превращают его в ошибку через `catchDefect`.
- `promote` сначала берёт steer-строки, выносит compaction вперёд, но не пересекает `move`; в scope «input» допускается одна очередь.
- `history.ts` задаёт нижнюю границу типом `Boundary`: `latest` (любая завершённая), `local` (только локальные резюме) или `Provenance` (нативное окно, которое умеет переиграть целевая модель).
- `compaction.ts`: после отказа «слишком длинно» цели уменьшаются до 70%, 50% и 35% от первой отклонённой оценки; потолок запроса — окно минус 10%, но не меньше 16 000 токенов. Расход публикуется по каждому вызову модели, поэтому прерванное сжатие тоже биллится.
- `provider-context.ts`: идентичность развёртывания — sha256 от базового URL, пути и отсортированных query-параметров; сравнение строгое по значению. Старые версии 1 с полями `mediaType`/`data` приводятся к виду `media.source` при чтении.
- `model-request.ts` урезает вывод под остаток окна с запасом 15% на оценку текста; картинки суммарно свыше 25 МиБ заменяются текстовой заглушкой до 15 МиБ, медиа неподдерживаемых типов заменяется текстовой ошибкой для модели.
- Крюк может переименовать инструмент, поэтому фактический инструмент ищется по идентичности объекта определения, а не по имени.
- `runner/publish-llm-event.ts` батчит дельты по 100 мс, но начала блоков публикует сразу: порядок событий совпадает с порядком модели. Поздний `tool-result` с ошибкой считается безобидным отставанием, поздний успех — двойным выполнением и роняет fiber.
- `stats.ts` считает окнами по 31 дню строго последовательно; расход сжатия берётся из таблицы событий, а не из сообщений, поэтому не зависит от нижней границы истории.
- `transfer.ts` при `sanitize` заменяет содержимое на метки вида `[redacted:kind:id]`, а данные вложений обнуляет; импорт с уже существующим `id` даёт `ImportConflictError`.
- `diff.ts` ищет границы хода по сообщениям `idle`; в сессии без таких маркеров ход заканчивается на следующем сообщении пользователя, а диапазон, пересекающий смену Location, отклоняется.

## Связи

- `packages/schema/src/session.ts`, `session-message.ts`, `session-event.ts`, `session-inbox.ts`, `session-revert.ts`, `session-provider-context.ts`, `session-stats.ts` — источники всех типов и событий.
- `packages/core/src/bus.ts` — шина: `publish` с коммит-хуками и `project`; именно через неё идёт любая запись.
- `packages/core/src/database/database.ts` и `packages/core/src/project/sql.ts` — соединение и каскад по таблицам.
- `packages/core/src/job.ts` — фоновые команды и субагенты, чьи уведомления восстанавливаются в `execution/restart.ts`.
- `packages/core/src/location-service-map.ts`, `location.ts`, `snapshot.ts`, `vcs/patch.ts` — смена Location, снимки и диффы.
- `packages/core/src/tool.ts`, `tool-output.ts`, `permission.ts`, `question.ts` — выполнение инструментов и их бюджеты.
- `packages/core/src/model-resolver.ts`, `packages/ai` — выбор модели, поток, ошибки и `isRetryable`.
- `packages/core/src/instructions/index.ts` — сборка инструкций и их эпохи.
- `packages/core/src/plugin/hooks.ts` — крюки `prompt`, `context`, `compaction`, `title`, `model.request`, `http.*`, `retry`, WebSocket-кадры.

## Ловушки

- `Session.prompt` возвращает уже принятый элемент, а не новое сообщение: сообщение появляется только при доставке (`InboxDelivered`) во время дрейна.
- `store.list` и `store.messages` при `anchor`/`cursor` с направлением `previous` меняют сортировку на противоположную и разворачивают выборку — порядок на выходе «человеческий», а не порядок базы.
- `SessionStore.claim` не двигает `time_updated`, поэтому счётчик активности и список сессий не реагируют на старт хода.
- `execution.ts` при прерывании с причиной `shutdown` намеренно сохраняет claim: следующая загрузка продолжит ход. Любой другой терминал его снимает.
- `SessionExecution.noopLayer` — заглушка без исполнения: вызывающий получает пустые `wake`/`resume`, а тихих отказов не будет.
- `run-coordinator.ts` не запускает работу на один тик позже пробуждения: прогресс виден по событиям или по `run`, а не по самому `wake`.
- `session.ts` заканчивается константой предела предпросмотра, повторяющей предел инструмента оболочки: при правке одной стороны легко забыть другую.
- `inbox.ts` держит собственные блокировки (`KeyedMutex`); `move.ts` проверяет доступность источника вне блокировки специально, чтобы отмена перемещения оставалась возможной во время инициализации.
- `history.ts` ищет нативное окно запросом `json_extract` по `$.providerContext.provenance.*`, поэтому состав полей provenance влияет на то, какие сообщения попадут в запрос.
- `runner/to-llm-message.ts` переигрывает состояние провайдера только для той же модели; после смены модели текст и рассуждения переживают как обычный текст, а рассуждения с ошибкой превращаются в текст.
- `model-transport.ts`: пять подряд потерянных обменов или один отказ 1009 («слишком большой запрос») навсегда оставляют сессию на HTTP до перезапуска или перемещения.
- `prompt.ts` отклоняет вложение больше 20 МиБ и data-URL с неканоническим base64; в сообщениях об ошибке вложение называется меткой, а не самими байтами.
- `instructions.ts` ведёт дедупликацию по синтетическим сообщениям с `metadata.instruction.paths`: выпавшие из видимой истории (сжатие, откат) пути будут введены заново.
