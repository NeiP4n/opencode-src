# @opencode/ai — клиенты моделей и провайдеры

## Что это

Слой связи с LLM и мультимедийными сервисами: 201 файл, ~29 тыс. строк в
`src/` — второй по размеру пакет. Здесь описано, как opencode зовёт модели:
десятки провайдеров (Anthropic, OpenAI, Google, Bedrock, Azure, xAI, DeepSeek,
Mistral, Cerebras, Groq, OpenRouter, Together, Fireworks, Replicate, Fal,
ElevenLabs, Deepgram, Cartesia, Stability, Runway, AssemblyAI, …) и десятки
wire-протоколов (chat, messages, responses, event-stream, transcription,
speech, images, video).

## Слои и зависимости

Слой **L1**: зависит от `schema`. Опора — `effect`.

Кто подключает:

- `packages/core` — вызовы моделей из сессий;
- `packages/app`, `packages/plugin`, `packages/simulation` — чтение типов
  и клиента;
- сам `packages/ai` (тесты и внутренние модули).

Экспорт — корневой `index.ts`, он же единственная публичная точка.

## Подсистемы и файлы

**Публичное лицо** — `packages/ai/src/index.ts`: `AIClient`, `LLMClient`,
`ImageClient`, `VideoClient`, `SpeechClient`, `Auth`, `Provider`,
`ProviderPackage`, `Image`, `Video`, `Speech`, плюс хелперы
`isContextOverflow`, `isContextOverflowFailure`, `isRetryable` и реэкспорт
`schema/index.js`.

**Клиенты по типу задачи** — файлы корня `src/`: `ai-client.ts`,
`llm.ts`, `image-client.ts`, `image.ts`, `video-client.ts`, `video.ts`,
`speech-client.ts`, `speech.ts`, `transcription-client.ts`,
`transcription.ts`, `media-client.ts`, `media-model.ts`, `media.ts`,
`generation.ts`.

**Маршрутизация запроса** — каталог `packages/ai/src/route/`:
`client.ts` (→ `LLMClient`), `endpoint.ts`, `executor.ts`,
`executor-service.ts`, `auth.ts` / `auth-options.ts`, `protocol.ts`,
`framing.ts`, `media.ts`, `media-protocol.ts`, транспорты
`transport/http.ts`, `transport/websocket.ts`,
`transport/websocket-channel.ts`.

**Провайдеры** — каталоги `packages/ai/src/providers/` (один файл на
провайдера: `anthropic.ts`, `openai.ts`, `google.ts`, `amazon-bedrock.ts`,
`azure.ts`, `xai.ts`, `deepseek.ts`, `mistral.ts`, `openrouter.ts`,
`replicate.ts`, `fal.ts`, `elevenlabs.ts`, `deepgram.ts`, `stability.ts`,
`runway.ts`, … плюс подкаталоги `azure/`, `google-vertex/`, `zai/`,
`alibaba/`) и сводный `packages/ai/src/providers.ts`.

**Протоколы** — каталог `packages/ai/src/protocols/`: форматы провайдеров —
`anthropic-messages.ts`, `openai-chat.ts`, `openai-responses.ts`,
`gemini.ts`, `bedrock-converse.ts`, `bedrock-event-stream.ts`,
`meta-messages.ts`, `mistral-chat.ts`, `alibaba-*.ts`, `xai-*.ts`,
`zai-*.ts`, медиа-протоколы (`*-images.ts`, `*-video.ts`, `*-speech.ts`,
`*-transcription.ts`) и сводный `protocols.ts`.

**Вспомогательное** — `packages/ai/src/protocols/utils/` (кэш, чанки
`partial-json.ts`, checkpoint'ы `responses-checkpoint.ts`, компакция
`responses-compaction.ts`, стримы `tool-stream.ts`, `speech-stream.ts`),
`packages/ai/src/utils/` (`json.ts`, `bytes.ts`, `sanitize.ts`,
`media-type.ts`, `record.ts`).

**Инструменты и события** — `tool.ts`, `tool-runtime.ts`, `tool-history.ts`,
`provider.ts`, `provider-package.ts`, `provider-error.ts`, `cache-policy.ts`,
`effort-updates.ts`, `promise.ts`, `testing.ts`.

**Схемы и эксперименты** — каталог `packages/ai/src/schema/` (`ids.ts`,
`messages.ts`, `events.ts`, `errors.ts`, `options.ts`, `index.ts`) и
`packages/ai/src/experimental/` (`evaluation.ts`,
`evaluation-client.ts`, `system-one.ts`).

## Точки входа

1. `packages/ai/src/index.ts` — весь публичный API.
2. `packages/ai/src/index.ts` → `LLMClient` (реализация в
   `packages/ai/src/route/client.ts`) — обычный вызов модели.
3. `packages/ai/src/index.ts` → `isContextOverflow(...)` — решение, что
   ошибка модели это переполнение контекста, а не сбой сети.
4. `packages/ai/src/providers.ts` — список поддерживаемых провайдеров.

## На что смотреть дальше

- `packages/core/PACKAGE.md` — потребитель: сессии зовут модели через этот
  слой.
- `packages/schema/PACKAGE.md` → `llm.ts`, `provider.ts`, `model.ts` —
  типы, которыми обмениваются.
- `packages/http-recorder/PACKAGE.md` — запись трафика провайдеров в тестах.
- `packages/ai/src/schema/events.ts` — события генерации, которые уходят
  в интерфейс.

## Ловушки

1. **Провайдер ≠ протокол.** `providers/anthropic.ts` выбирает, куда
   стучаться, а `protocols/anthropic-messages.ts` описывает, в каком формате
   писать тело. Один провайдер может говорить по нескольким протоколам
   (`chat`, `messages`, `responses`).
2. **`openai-compatible-*` — не про OpenAI**, а про любые совместимые
   эндпоинты (self-hosted, OpenRouter и подобные). Путаница здесь даёт
   неверный URL.
3. **Ошибки делятся на три вида:** `provider-error.ts` различает
   переполнение контекста, повторяемые сбои и всё остальное; то, что
   помечено повторяемым, ретраится, остальное — нет.
4. **`experimental/` нестабилен:** `system-one.ts` и `evaluation*` могут
   меняться без предупреждения; на них не стоит строить зависимость
   внешнего кода.
5. **Кэш и compaction живут в `protocols/utils/`, а не рядом с провайдером.**
   Правка `responses-compaction.ts` меняет поведение всех провайдеров на
   `responses` сразу.
