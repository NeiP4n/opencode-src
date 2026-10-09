# core/github-copilot — the GitHub Copilot client: two protocols (chat and responses), model catalog, reasoning bypass

## What's In This Folder

- `chat/` — the implementation of the `/chat/completions` protocol for Copilot: request body assembly, stream and regular response parsing, prompt to message translation.
- `responses/` — the implementation of the `/responses` protocol for Copilot: the same model class, but with another input, output and event stream format, plus the provider's built-in tools.
- `models.ts` — bringing the Copilot model catalog to OpenCode models.
- `copilot-provider.ts` — the provider factory: assembles the headers, the base URL and chooses the needed protocol implementation.
- `openai-compatible-error.ts` — the error schema of the compatible provider and the structure of error handling.
- 23 files in total; the two largest are `chat/openai-compatible-chat-language-model.ts` (817 lines) and `responses/openai-responses-language-model.ts` (1636 lines).

## Key Files

- `packages/core/src/github-copilot/copilot-provider.ts` — `createOpenaiCompatible(options)`.
- `packages/core/src/github-copilot/chat/openai-compatible-chat-language-model.ts` — `OpenAICompatibleChatLanguageModel`.
- `packages/core/src/github-copilot/responses/openai-responses-language-model.ts` — `OpenAIResponsesLanguageModel` and all the chunk schemas.
- `packages/core/src/github-copilot/models.ts` — `load`, `derive`, `usable`, `variants`.
- `packages/core/src/github-copilot/responses/openai-responses-prepare-tools.ts` — `prepareResponsesTools`, `getResponsesHostedTool`.
- `packages/core/src/github-copilot/responses/convert-to-openai-responses-input.ts` — `convertToOpenAIResponsesInput`.
- `packages/core/src/github-copilot/chat/convert-to-openai-compatible-chat-messages.ts` — `convertToOpenAICompatibleChatMessages`.

## Important Details

- The `createOpenaiCompatible` factory returns a function with four equivalent ways to create a model: the provider call itself, `chat`, `responses`, `languageModel`. By default all of them give the chat implementation, except an explicit `responses`.
- The provider name in the model is built as `${options.name ?? "openai-compatible"}.chat` or `.responses`. The options class name for parsing is taken as the first part before the dot: `this.config.provider.split(".")[0]`.
- The base URL is normalized through `withoutTrailingSlash`, and the request URL is assembled as `${baseURL}${path}`. The default value is `https://api.openai.com/v1`.
- The headers are assembled once at the moment of the `getHeaders` call: the `Authorization: Bearer` header is added only if `apiKey` is set, then the custom `headers` go on top, and at the end `withUserAgentSuffix` adds `ai-sdk/openai-compatible/0.1.0`. The provider version is set by the constant `VERSION` in the same file.
- In the chat implementation the provider options are read twice: first from the `copilot` key, then from the provider name. Values from the second source override the first, because they come second in `Object.assign`.
- `topK` is not supported in the chat protocol and gives an `unsupported` warning. In the responses protocol `topK`, `seed`, `presencePenalty`, `frequencyPenalty` and `stopSequences` are not supported.
- In the chat implementation any provider keys that are not in the known schema are copied into the request body as is. This lets you pass through parameters not yet described in `openaiCompatibleProviderOptions` without code changes.
- `response_format` in the chat implementation depends on the flag `supportsStructuredOutputs`: with it and with a schema present `json_schema` goes out with a name (`response` by default), otherwise — `json_object`. The warning about the missing support arrives in the warnings list.
- `stream_options: { include_usage: true }` is added only at `config.includeUsage`: that is the strict compatibility mode in which the server sends usage.
- Error handling is configured through `errorStructure`: the class has its own error schema, assembled from the schema given in the constructor. The default is `defaultOpenAICompatibleErrorStructure`.
- The response and chunk schemas are deliberately cut down: the code repeats the reason twice — there are fewer breakages on an API change and higher efficiency. Everything not described is ignored.
- A chunk in the chat protocol is a union of a normal chunk and the error schema. Therefore an error can arrive in the stream as a separate event, and it is handled inside `transform`.
- The key feature of Copilot in the chat protocol is the fields `reasoning_text` (visible reasoning text) and `reasoning_opaque` (opaque state for multi-turn reasoning). In the stream the reasoning is always closed earlier than the text and earlier than the tool calls, even if they came in one chunk.
- On a second `reasoning_opaque` inside one response an `InvalidResponseDataError` is thrown with a message saying that only one reasoning part is allowed for a response.
- In the stream of the chat protocol the part identifiers are hardcoded: `reasoning-0` and `txt-0`. These are not provider identifiers but internal ones, and they are reused for every response.
- Tool calls in the chat stream are glued by the `index` of the chunk, not by `id`. The first chunk creates a record, the following ones append `arguments`. The completion is determined by an `isParsableJson` check — that is, complete valid arguments have arrived.
- If the provider sent a complete tool call in one chunk, the argument delta is not sent at all, and the call arrives right after `tool-input-end`.
- In `flush` unclosed tool calls are fired forcibly: first `tool-input-end`, then `tool-call`. Thus the stream does not lose a call if the provider did not mark its completion.
- `usage` in the stream of the chat protocol is collected in parts, and in `finish` `noCache` is counted as `promptTokens - cachedTokens`, but only if both values are known. Without cache data `noCache` stays `undefined`.
- In `flush` of the chat stream `providerMetadata` is assembled from the metadata extender and `reasoningOpaque`, and the `copilot` key is present only when there is opaque reasoning.
- In the responses implementation the system message is always sent as `system`: the `developer` and `remove` modes exist in the conversion function, but the calling code passes `systemMessageMode: "system"`.
- The `store` flag (default `false`) switches several branches of behavior at once: references to items instead of reasoning, sending `id` for messages and calls, and passing or skipping the results of built-in tools.
- `include` is assembled forcibly: `reasoning.encrypted_content` is always added, `message.output_text.logprobs` — when logprobs are requested, `web_search_call.action.sources` — when web search is present, `code_interpreter_call.outputs` — when the code interpreter is present. Duplicates are not added.
- `logprobs: true` turns into `TOP_LOGPROBS_MAX` (20), a number is used as is. A value outside the range is cut off by the options schema.
- `text` in the request body appears only with a JSON response format or with a set verbosity. Without both conditions there is no `text` field in the request.
- The `reasoning` area in the body is assembled from `reasoningEffort` and `reasoningSummary`, and again only when at least one of them is set.
- An error arrives in the `error` field of the response with code 200: it turns into an `APICallError` with status 400 and `isRetryable: false`. The comment in the code leaves no doubt — repeating such a request is pointless.
- Parsing of the output in the responses implementation goes by a discriminated union of types: `message`, `reasoning`, `function_call`, `web_search_call`, `file_search_call`, `code_interpreter_call`, `image_generation_call`, `computer_call`.
- An empty `summary` list of the reasoning is supplemented with one empty part: without this the reasoning piece will not get into the result.
- Built-in tools are returned by a `tool-call` with `providerExecuted: true` and a `tool-result` pair. For web search the input is `JSON.stringify({ action })`, for file search — the string `{}`, for image generation — the string `{}`, for the code interpreter — JSON with `code` and `containerId`, for the computer call — an empty string.
- The name of a built-in tool in the result is taken via `getHostedToolName(responseType)`: the name of the selected tool, otherwise the first found with such a response type, otherwise the response type itself as a string. In other words in a non-standard configuration the name may turn out to be `file_search`.
- The computer call is the only one whose tool name is fixed by the string `computer_use`, and not taken from the configuration.
- Citation annotations turn into parts of the type `source`: a URL citation gives `sourceType: "url"`, a file citation — `sourceType: "document"` with the title from the citation, then the file name, then the `Document` line. The source identifier is taken from `config.generateId`, otherwise it is generated.
- The flag `hasFunctionCall` is set only on `function_call`. In the stream it is raised on the element completion event. It influences the final finish reason.
- The responses stream keeps track of the reasoning by `output_index`, not by `item.id`. The reason is recorded in the code: Copilot changes the encrypted item identifiers on every event. The part identifiers have the form `${item.id}:${summary_index}`.
- For the text a separate stable identifier `currentTextId` is kept, because `item_id` changes between deltas. It is normalized into one identifier per message.
- The reasoning summaries have their own state `active`, `can-conclude` and `concluded`. The `can-conclude` state is used at `store === false`: in that case a part can only be closed when the next part appears, but not on the completion event.
- The deltas of the code interpreter are escaped via `JSON.stringify(...).slice(1, -1)` and closed with a quote at the end: the code is passed inside a JSON string of the tool call parameters.
- The schema of the responses stream ends with a fallback variant `{ type: z.string() }.loose()`, that is, unknown events do not break the parsing. Each known type is checked by a separate predicate function.
- The argument lists of built-in tools are checked by `parse` from zod on every request assembly: wrong arguments lead to an exception before the network call.
- For image generation the argument schema is `.strict()`: extra fields are forbidden. The limits are set explicitly: `outputCompression` and `partialImages` within 0 to 100 and 0 to 3, `moderation` admits only `auto`.
- In `prepareResponsesTools` ambiguity checks are introduced: several definitions with the same name, two tools with the same response type and an ambiguous choice of a built-in tool give `UnsupportedFunctionalityError` with a listing of the names.
- The `ResponsesHostedTool` class stores `type` separately (for the choice) and `responseType` (for parsing the response). They differ for web search: `web_search_preview` in the request gives `responseType: "web_search"`.
- `strict` of an ordinary function tool is taken from the tool definition, and in its absence — from the general flag `strictJsonSchema`.
- In `models.ts` a model is considered usable only when four conditions hold: the policy is not `disabled`, `max_output_tokens` is set, `max_prompt_tokens` is set and `tool_calls` is defined. The other models are discarded without diagnostics.
- The endpoint is chosen by the capabilities in the order `messages`, `responses`, `chat`. In the absence of a suitable value the `endpoint` field simply does not get into the settings.
- PDF support in Copilot models requires both `vision` and the presence of `application/pdf` among the supported types. For images either of the two is enough.
- The price recalculation in `models.ts` uses `10_000 / batch_size`: Copilot reports the cost per batch size, and the model stores the price per million tokens. Without prices or with a zero batch size you get zero.
- The release time is taken from the local model data, and if there is none — from `Date.parse` of the `version` field, from which a prefix of the form `${id}-` is removed. An unparseable date gives zero.
- The `enabled` field of the model equals `model_picker_enabled` from the response: the provider itself decides whether to show the model in the picker.
- Reasoning variants in `models.ts` are built in three ways. For a non-Anthropic protocol with the effort levels set — variants with `reasoningEffort`, `reasoningSummary: "auto"` and `include: ["reasoning.encrypted_content"]`. For the Anthropic protocol with adaptive thinking — variants with `thinking: { type: "adaptive", display: "summarized" }`. If there are no levels but `max_thinking_budget` is set, exactly two variants are made: `max` with the budget `max - 1` and `high` with half the budget.
- Subtracting one from the maximum budget is done deliberately: the maximum budget value is not allowed by the API.
- The merge with local models in `models.ts` starts from the existing models, not from an empty map: local aliases and settings survive a catalog update. But a model is removed if its declared `modelID` no longer occurs in the response. The comment explains the reason: a partial or broken element must not create a broken model.
- The `snapshot.txt` import for this catalog is not used: `load` always goes to the network. The built-in snapshot exists only for the OpenCode catalog.

## Connections

- `packages/core/src/github-copilot/models.ts` — called by the provider plugin `packages/core/src/plugin/provider/github-copilot.ts` (neighboring the other files in `packages/core/src/plugin/provider/`).
- `packages/core/src/model.ts` and `packages/core/src/provider.ts` — `Model.Info`, `Model.VariantID`, `Provider.ID.githubCopilot`, `Provider.aisdk`, `Provider.mergeOverlay` and `Model.Info.default`.
- `packages/schema/src/money.ts` — `Money.USDPerMillionTokens`, into which the prices are converted.
- `packages/core/src/aisdk-native.ts` — the table of correspondence of specifiers to `@opencode/ai` packages, where `@ai-sdk/anthropic` maps to `@opencode/ai/providers/anthropic`: exactly this specifier is chosen for models with the `messages` endpoint, that is for those for which Copilot reports support of `/v1/messages`.
- `packages/core/src/model-resolver.ts` — parses these specifiers and separately handles the pair `@opencode/ai/providers/anthropic` and `@opencode/ai/providers/anthropic-compatible`.
- `@ai-sdk/provider` and `@ai-sdk/provider-utils` — the `LanguageModelV3` contract, `UnsupportedFunctionalityError`, `postJsonToApi`, `parseProviderOptions`, `createEventSourceResponseHandler`.
- `zod/v4` — all the shape checks: provider options, built-in tool arguments, response and chunk schemas.
- `packages/core/src/models-dev.ts` — a neighboring model catalog loader working with the built-in snapshot; both subsystems bring external data to `Model.Info`, but by different rules.
- `packages/core/src/modal/models.ts` — a neighboring catalog converter: there the prices are also recalculated, but the multiplier is different and they come from another source.
- `packages/core/docs/models-dev.md` — the document about the built-in snapshot of the OpenCode catalog.

## Pitfalls

- In `models.ts` a model with an unknown price gets a zero price, not "unknown". The expense statistics for such a model will show zero as a reliable number.
- The `usable` filter silently discards models without `tool_calls`. For a provider that does not publish this capability at all, the list will be empty, and the reason will look like an empty response.
- Local aliases are removed together with the original model: the check goes by the `modelID` of the response. Removing one model from the Copilot catalog removes all of its local variants.
- `tools` in the chat implementation with an empty array turns into `undefined`, not into an empty list. The provider does not get the `tools` field.
- `reasoning_opaque` is allowed only one per response, and a second value throws an exception right in the stream. Multi-turn reasoning is held on the opaque value from the first turn, not from the last.
- The identifiers `reasoning-0` and `txt-0` in the chat stream are fixed. If two consumers read the same stream, their identifiers will coincide.
- `include` in responses is added automatically. If the provider does not understand the `include` field as a whole, the refusal will look like a request error, although the reason is the auto-adding.
- At `store: false` the results of built-in tools are not sent back, only marked with a warning. A multi-turn conversation with `code_interpreter` in this mode loses state without an explicit error message.
- Stream events that did not fall into any known schema are swallowed by the fallback schema variant. A new provider event type will not give an error and will not get into the result.
- `computer_use` is not taken from the configuration: this tool cannot be renamed, an attempt will lead to a mismatch of names between the request and the response parsing.
- A response with code 200 and a filled `error` turns into an `APICallError` with status 400. Any retry logic looking at the real HTTP status will not see this case.
- Price parsing in `models.ts` depends on `batch_size`: in its absence the multiplier is zero and the prices are zeroed out, even if the `input_price` and `output_price` values themselves arrived.
- The `max` variant in Copilot models uses `max_thinking_budget - 1`. A `max_thinking_budget` value equal to zero will give a negative budget, and sending such a variant will be rejected by the API.
- `fileIdPrefixes` in `responses/openai-config.ts` are not set by default: without them any string in the file data is treated as content, not as an identifier. For Azure-like addresses the prefixes must be set explicitly.
- The forbidden repository rules are respected: the core code was not changed, the folder is read only. The text of these files has its own notes about unfinished work — they refer to the Copilot sources, not to the documentation.