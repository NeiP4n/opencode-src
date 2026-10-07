# core/instructions — движок составных инструкций: значения, хеши, дельты, рендер

## Что в папке

Два файла: `packages/core/src/instructions/index.ts` — сам механизм, и
`packages/core/src/instructions/builtins.ts` — два встроенных источника
(дата и сведения об окружении).

Механизм решает задачу: инструкции для модели меняются во времени (дата,
каталоги, доступные скиллы), и нужно отдавать модели не весь список заново,
а дельту — что добавилось, что изменилось, что пропало.

## Ключевые файлы

- `packages/core/src/instructions/index.ts` — типы `Source`, `List`,
  `ReadResult`, `Admission`; функции `make`, `combine`, `read`, `diff`,
  `renderInitial`, `renderUpdate`, `hash`, `applyHashDelta`, `diffByKey`;
  ошибки `InitializationBlocked` и `DuplicateKeyError`.
- `packages/core/src/instructions/builtins.ts` — сервис
  `InstructionBuiltIns` (`@opencode/InstructionBuiltIns`) с ключами
  `core/date` и `core/environment`.

## Важные детали

- Источник (`Source`) — это пара «прочитать значение» плюс три функции
  рендера: `initial`, `changed`, `removed`. Значение всегда проходит через
  `codec` в канонический JSON: один и тот же JSON хешируется, хранится и
  проигрывается.
- Три состояния значения, а не два: обычное значение, `unavailable` (чтение
  временно не удалось — хранимое значение остаётся в силе) и `removed`
  (источник есть, но значения больше нет).
- Различение состояний сделано **по ссылочному равенству**, а не по
  структуре: `isUnavailable` сравнивает с синглтоном `unavailable`. В коде
  это оговорено отдельно, потому что само значение `A` может быть
  JSON-подобным объектом с теми же полями.
- `make` закрывает типизированное определение в `Source` и умеет
  декодировать историческое значение: если `decode` даёт `undefined`
  (значение не подходит под схему), рендер пропускается и строка не
  попадает в вывод.
- `changed` при недоступном предыдущем значении откатывается к `initial` —
  частичное обновление не показывается.
- Пустой текст от рендера — исключение (`requireText`), а не тихий пропуск.
- `diff` считает `blocked` только при первом чтении (`previous` не передан):
  `InitializationBlocked` с перечнем ключей. Если значения уже есть,
  `unavailable` просто пропускается.
- `removed` попадает в дельту только если ключ был в `previous` — иначе
  удаление нечего фиксировать.
- Хеш: SHA-256 от канонической формы (`canonical`), где ключи объектов
  отсортированы по возрастанию. Порядок полей в объекте на хеш не влияет.
- `read` читает все источники параллельно (`concurrency: "unbounded"`),
  порядок результата совпадает с порядком в списке.
- `combine` проверяет уникальность ключей и бросает `DuplicateKeyError`
  синхронно, до чтения.
- `renderInitial` и `renderUpdate` соединяют части пустой строкой-двойным
  переносом (`join("\n\n")`).
- `diffByKey` — общий помощник для сравнения двух списков по ключу с
  предикатом изменения; используется не только инструкциями (его же зовут
  `reference` и `skill`).
- `instructions/builtins.ts`: `core/date` рендерит `date.toDateString()`,
  `core/environment` — блок `<env>` с рабочим каталогом, корнем workspace,
  признаком git-репозитория, `process.platform` и подсказкой использовать
  `global.tmp` вместо `/tmp`.

## Связи

- `@opencode/schema/instruction` — источник типов `Key`, `Hash`, `Values`,
  `Delta` и константы `removed`; оттуда же реэкспортируются все четыре.
- `packages/core/src/location.ts` — даёт `location.directory`,
  `location.project.directory` и `location.vcs?.type` для блока `<env>`.
- `@opencode/util/global` — `global.tmp`, путь, который советуют
  использовать вместо системного временного.
- `@opencode/util/effect/app-node` — `makeLocationNode` для привязки
  сервиса в граф зависимостей (`Global.node`, `Location.node`).
- Потребители механики: `packages/core/src/reference/instructions.ts`
  (ключ `core/reference-guidance`) и
  `packages/core/src/skill/instructions.ts` (ключ `core/skill-guidance`).

## Ловушки

- `unavailable` и `removed` различаются тождеством, а не формой: если
  значение-источник содержит объект с теми же полями, это не состояние
  удаления. Проверять структурно здесь нельзя.
- `diff` при первом чтении падает с `InitializationBlocked`, если хоть один
  источник `unavailable`. Список ключей в ошибке — то, что блокирует старт.
- `renderUpdate` для удалённого ключа требует наличия ключа в `previous`;
  иначе строка пропускается молча.
- Канонизация учитывает только порядок ключей объектов и массивов. Порядок
  элементов массива значим, и это меняет хеш.
- `codec` в `make` применяется и на запись, и на чтение: значение, которое
  не проходит `Schema.encodeSync`, роняет весь `read` источника.
- Функции рендера в `Source` возвращают `string | undefined`, в
  `Source.Definition` — обязательный `string`. Расхождение сделано намеренно,
  чтобы исторические значения могли пропускаться.
