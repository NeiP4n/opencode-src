# @opencode/http-recorder — запись и воспроизведение HTTP-трафика

## Что это

Записыватель трафика Effect в кассеты (аналог VCR): 14 файлов, ~1.6 тыс. строк
в `src/`. Ловит HTTP- и WebSocket-запросы при прогоне теста и на повторе
отдаёт сохранённые ответы — так интеграционные тесты ядра не ходят в сеть.

Пакет описывает себя так: «Record and replay Effect HTTP and WebSocket traffic
with deterministic cassettes».

## Слои и зависимости

Слой **L0 — лист**: от других пакетов `@opencode/*` не зависит. Опора —
`effect` (`HttpClient`, `Socket`), рантайм — Node ≥22.

Кто подключает (только `devDependencies`, то есть в тестах):

- `packages/ai/package.json`;
- `packages/core/package.json`.

В `src` продуктового кода импортов нет — пример:
`packages/core/test/session-runner-recorded.test.ts` использует
`HttpRecorder.layerFetch(...)` и `HttpRecorder.removeCassetteSync(...)`.

## Подсистемы и файлы

**Публичное лицо** — `packages/http-recorder/src/index.ts`: объект
`HttpRecorder` с пятью функциями (`layer`, `layerFetch`, `layerSocket`,
`layerWebSocketConstructor`, `hasCassetteSync`, `removeCassetteSync`) и
namespace с типами (`RecorderOptions`, `RedactOptions`, `RequestMatcher`,
`RequestSnapshot`, `CassetteMetadata`).

**Кассеты** — каталог `packages/http-recorder/src/cassette/`:
- `model.ts` — устройство кассеты и метаданных;
- `store.ts` — чтение/запись на диск, `hasCassetteSync` и `removeCassetteSync`.

**HTTP** — каталог `packages/http-recorder/src/http/`:
- `recorder.ts` — слои `layer` и `layerFetch`, перехват запроса;
- `matching.ts` — сравнение входящего запроса с записанным;
- `model.ts` — нормализованный снимок запроса/ответа.

**WebSocket** — каталог `packages/http-recorder/src/websocket/`:
`recorder.ts` (слои `layerSocket`, `layerWebSocketConstructor`),
`model.ts` (формат кадров).

**Редактирование секретов** — каталог
`packages/http-recorder/src/redaction/`: `secrets.ts` (что считать секретом),
`redactor.ts` (аддитивная политика редактирования и сохранения заголовков).

**Состояние воспроизведения** — каталог
`packages/http-recorder/src/replay/`: `state.ts` (режим записи/повтора),
`comparison.ts` (сверка фактического ответа с кассетой).

**Опции и API** — `packages/http-recorder/src/options.ts`,
`packages/http-recorder/src/api.ts` (типы, которые реэкспортит `index.ts`).

## Точки входа

1. `packages/http-recorder/src/index.ts` — `HttpRecorder` (объект и namespace),
   единственная точка подключения извне.
2. `packages/http-recorder/src/index.ts` → `layer(name, options?)` — основной
   способ навесить запись на HTTP-клиент.
3. `packages/http-recorder/src/index.ts` → `hasCassetteSync(name, options?)` —
   проверить, есть ли уже кассета, до запуска теста.

## На что смотреть дальше

- `packages/core/test/session-runner-recorded.test.ts` — живое применение:
  как тест ядра подключает кассету.
- `packages/ai/PACKAGE.md` — второй потребитель, тесты моделей.
- `packages/util/PACKAGE.md` — где хранятся файлы (каталог кассет задаётся
  опциями, не хардкодом).

## Ловушки

1. **Запись и повтор взаимоисключающи.** Незакрытая запись оставляет
   неполную кассету, и следующий прогон уходит в сеть вместо ответа из файла.
2. **`removeCassetteSync` удаляет кассету с диска** — в тестах его зовут перед
   перезаписью, случайный вызов в прод-коде стирает артефакт.
3. **Секреты редактируются до записи**, политика аддитивная: новые поля
   добавляются к уже заданной, а не заменяют её — неверно настроенный
   `RedactOptions` молча запишет токен в кассету.
4. **Совпадение запроса — не точное равенство.** `matching.ts` сравнивает по
   нормализованному снимку; провайдер, вернувший другой порядок полей или
   разный `requestId`, может не совпасть с записью.
