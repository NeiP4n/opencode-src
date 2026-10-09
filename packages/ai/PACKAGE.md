# @opencode/ai — model clients and providers

## What This Is

The LLM and multimedia services connectivity layer: 201 files, ~29k lines in
`src/` — the second largest package. This document describes how opencode
calls models: dozens of providers (Anthropic, OpenAI, Google, Bedrock, Azure,
xAI, DeepSeek, Mistral, Cerebras, Groq, OpenRouter, Together, Fireworks,
Replicate, Fal, ElevenLabs, Deepgram, Cartesia, Stability, Runway,
AssemblyAI, …) and dozens of wire protocols (chat, messages, responses,
event-stream, transcription, speech, images, video).

## Layers and Dependencies

Layer **L1**: depends on `schema`. Foundation — `effect`.

Who depends on it:

- `packages/core` — model calls from sessions;
- `packages/app`, `packages/plugin`, `packages/simulation` — reading types
  and the client;
- `packages/ai` itself (tests and internal modules).

The export is the root `index.ts`, which is also the only public entry point.

## Subsystems and Files

**Public face** — `packages/ai/src/index.ts`: `AIClient`, `LLMClient`,
`ImageClient`, `VideoClient`, `SpeechClient`, `Auth`, `Provider`,
`ProviderPackage`, `Image`, `Video`, `Speech`, plus the helpers
`isContextOverflow`, `isContextOverflowFailure`, `isRetryable` and the
re-export of `schema/index.js`.

**Clients by task type** — files in the `src/` root: `ai-client.ts`,
`llm.ts`, `image-client.ts`, `image.ts`, `video-client.ts`, `video.ts`,
`speech-client.ts`, `speech.ts`, `transcription-client.ts`,
`transcription.ts`, `media-client.ts`, `media-model.ts`, `media.ts`,
`generation.ts`.

**Request routing** — the `packages/ai/src/route/` directory:
`client.ts` (→ `LLMClient`), `endpoint.ts`, `executor.ts`,
`executor-service.ts`, `auth.ts` / `auth-options.ts`, `protocol.ts`,
`framing.ts`, `media.ts`, `media-protocol.ts`, transports
`transport/http.ts`, `transport/websocket.ts`,
`transport/websocket-channel.ts`.

**Providers** — the `packages/ai/src/providers/` directories (one file per
provider: `anthropic.ts`, `openai.ts`, `google.ts`, `amazon-bedrock.ts`,
`azure.ts`, `xai.ts`, `deepseek.ts`, `mistral.ts`, `openrouter.ts`,
`replicate.ts`, `fal.ts`, `elevenlabs.ts`, `deepgram.ts`, `stability.ts`,
`runway.ts`, … plus the subdirectories `azure/`, `google-vertex/`, `zai/`,
`alibaba/`) and the aggregate `packages/ai/src/providers.ts`.

**Protocols** — the `packages/ai/src/protocols/` directory: provider formats —
`anthropic-messages.ts`, `openai-chat.ts`, `openai-responses.ts`,
`gemini.ts`, `bedrock-converse.ts`, `bedrock-event-stream.ts`,
`meta-messages.ts`, `mistral-chat.ts`, `alibaba-*.ts`, `xai-*.ts`,
`zai-*.ts`, media protocols (`*-images.ts`, `*-video.ts`, `*-speech.ts`,
`*-transcription.ts`) and the aggregate `protocols.ts`.

**Helpers** — `packages/ai/src/protocols/utils/` (cache, `partial-json.ts`
chunks, `responses-checkpoint.ts` checkpoints, `responses-compaction.ts`
compaction, `tool-stream.ts` / `speech-stream.ts` streams),
`packages/ai/src/utils/` (`json.ts`, `bytes.ts`, `sanitize.ts`,
`media-type.ts`, `record.ts`).

**Tools and events** — `tool.ts`, `tool-runtime.ts`, `tool-history.ts`,
`provider.ts`, `provider-package.ts`, `provider-error.ts`, `cache-policy.ts`,
`effort-updates.ts`, `promise.ts`, `testing.ts`.

**Schemas and experiments** — the `packages/ai/src/schema/` directory
(`ids.ts`, `messages.ts`, `events.ts`, `errors.ts`, `options.ts`,
`index.ts`) and `packages/ai/src/experimental/` (`evaluation.ts`,
`evaluation-client.ts`, `system-one.ts`).

## Entry Points

1. `packages/ai/src/index.ts` — the entire public API.
2. `packages/ai/src/index.ts` → `LLMClient` (implemented in
   `packages/ai/src/route/client.ts`) — an ordinary model call.
3. `packages/ai/src/index.ts` → `isContextOverflow(...)` — decides that a
   model error is a context overflow and not a network failure.
4. `packages/ai/src/providers.ts` — the list of supported providers.

## Where to Look Next

- `packages/core/PACKAGE.md` — consumer: sessions call models through this
  layer.
- `packages/schema/PACKAGE.md` → `llm.ts`, `provider.ts`, `model.ts` — the
  types exchanged with each other.
- `packages/http-recorder/PACKAGE.md` — recording provider traffic in tests.
- `packages/ai/src/schema/events.ts` — generation events that reach the UI.

## Pitfalls

1. **Provider ≠ protocol.** `providers/anthropic.ts` chooses where to send
   the request, while `protocols/anthropic-messages.ts` describes the format
   in which to write the body. One provider can speak several protocols
   (`chat`, `messages`, `responses`).
2. **`openai-compatible-*` is not about OpenAI**, but about any compatible
   endpoint (self-hosted, OpenRouter and the like). Confusion here yields a
   wrong URL.
3. **Errors come in three kinds:** `provider-error.ts` distinguishes context
   overflow, retryable failures and everything else; whatever is marked
   retryable is retried, everything else is not.
4. **`experimental/` is unstable:** `system-one.ts` and `evaluation*` may
   change without a warning; external code should not build a dependency on
   them.
5. **Cache and compaction live in `protocols/utils/`, not next to the
   provider.** A change to `responses-compaction.ts` changes the behavior of
   every provider on `responses` at once.
