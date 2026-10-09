# core/modal — bringing the Modal model catalog to OpenCode models

## What's In This Folder

- `models.ts` — the only file: the response schema of the provider, the loading of the model list over HTTP and the merging of the response with the already known models.
- There is neither a client nor a provider plugin in the folder: only data conversion.

## Key Files

- `packages/core/src/modal/models.ts` — `load`, `get`, `derive`, `Snapshot`, the local schemas `RemoteModel` and `ReasoningOption`.

## Important Details

- The provider identifier is set once: `const providerID = Provider.ID.make("modal")`. It goes into every assembled model.
- `RemoteModel` — an Effect schema for one catalog element. Fields: `id`, the optional `base_model_id`, `hugging_face_id`, `name`, `input_modalities`, `output_modalities`, `context_length`, `max_output_length`, `pricing`, `supported_sampling_parameters`, `supported_features`, `reasoning_options`, `interleaved`.
- `pricing` admits both strings and numbers (`Schema.Union([Schema.String, Schema.Number])`) for `prompt`, `completion` and `input_cache_read`. There is no `input_cache_write` type in the schema: a cache write is always taken from a previously known model, otherwise zero.
- `interleaved` — either a boolean, or an object with a `field` that must be one of `reasoning`, `reasoning_content`, `reasoning_details`. This is the separate reasoning stream format of compatible providers.
- `reasoning_options` — an array of objects of the form `{ type: "effort", values: [...] }`, where the values admit `null`. A `null` in a value means the mode without reasoning and turns into a variant with the identifier `none`.
- The response envelope (`{ data: [...] }`) is decoded strictly through `decodeUnknownSync`, and each element — softly through `decodeUnknownOption`. The comment in the code explains the meaning: one bad element must not throw away the whole list, but a bad envelope from the provider is already a protocol error.
- `load(baseURL, apiKey)` does a `fetch` to the path `/models` with the header `Authorization: Bearer` and the timeout `AbortSignal.timeout(3_000)`. A non-2xx gives an `Error` with the text `Failed to fetch Modal models: <status>`.
- The base address is cleaned of trailing slashes by the regular expression `replace(/\/+$/, "")`, so both `https://host` and `https://host/` give the same URL.
- `get` is `derive` on top of `load`: a convenient wrapper for a caller that already has its own models.
- `derive(baseURL, remote, existing)` builds two maps: the templates from `existing` by `model.id` and the result by `Model.ID.make(item.id)`. The template for a remote model is looked for by `base_model_id ?? hugging_face_id ?? id` — that is, a model on Modal inherits the settings of the source model if its base model is known locally. The comment warns: the basis is the **original** models, not the result of a previous conversion.
- `build` assembles `Model.Info` on top of `Model.Info.default(providerID, id)` and overwrites only the known fields. Everything that is not in the response is taken from `previous`: `family`, `headers`, `body`, `status`, `enabled`, the release time, part of the settings, the input token limit.
- The provider package is fixed by the string `"@opencode/ai/providers/openai-compatible"`. This is not an npm package name, but a route identifier in `packages/ai`.
- The settings are merged through `Provider.mergeOverlay(previous?.settings, { baseURL, provider: providerID })`: the base and the provider have priority, the rest is inherited.
- Compatibility is derived from `interleaved` only if the field is present: `remote.interleaved === undefined ? previous?.compatibility : (Model.compatibility(...) ?? previous?.compatibility)`. The absence of the field does not mean "not supported", it means "unchanged".
- The prices are normalized by the function `price`: the value is multiplied by a million and turned into `Money.USDPerMillionTokens`. A non-numeric result or the absence of a value falls back to the previous price or zero. Zero as the last default means that the model looks free, not unknown in price.
- The limits go through `limit`: the fractional part is discarded via `Math.trunc`, a negative or non-integer value falls back to the previous limit. The absence of a value also falls back and not to zero; zero is obtained only explicitly.
- The capabilities are derived from the arrays of modalities, and the tool support — from the presence of `"tools"` in `supported_features`. The absence of a feature list gives `true` (tools are considered available), because the default is taken from `previous`, and in its absence — `?? true`.
- `variants` builds the list of reasoning modes, removing duplicates by identifier through a `Map`. A variant without a set setting inherits `previous?.variants` entirely: an empty array on the server does not erase the local variants.

## Connections

- `packages/core/src/modal/models.ts` — the consumer was found by searching for `ModalModels`: `packages/core/src/plugin/provider/modal.ts`, that is, the provider plugin calls `get` or the `load` and `derive` pair.
- `packages/core/src/model.ts` — the source of `Model.Info`, `Model.ID`, `Model.VariantID` and the function `Model.compatibility`, into which the fields from the response are assembled.
- `packages/core/src/provider.ts` — the source of `Provider.ID` and `Provider.mergeOverlay`.
- `packages/schema/src/money.ts` — `Money.USDPerMillionTokens`, in which the price is stored after multiplication by a million.
- `packages/core/src/models-dev.ts` — a neighboring mechanism: it brings a model catalog to the internal form, but from another source (`models.opencode.ai`).
- `packages/core/src/models-dev/snapshot.txt` — a built-in snapshot of the same kind of data for the OpenCode catalog.

## Pitfalls

- A bad list element disappears silently. A list shorter than expected is not yet a reason to think the provider did not return everything: each discarded element has to be parsed out of the logs, and there are none here.
- A price from a string that is not a number gives zero, not an error. A model with such a price will look free in the calculations and statistics.
- A default of zero for a price and a default of zero for a limit mean different things: price zero — "we count it as free", limit zero — "unknown or absent". They must not be confused.
- Local models (`existing`) take part in the merge as templates. If an already converted model gets there, the fields will be inherited twice — hence the prohibition in the comment on mixing the source and the result.
- An empty list on the server resets neither the reasoning variants, nor the status, nor the limits: the defaults are taken from `previous`.
- The request timeout is 3 seconds. On a slow network the list of Modal models will not load at all, and the error will look like a provider refusal, and not like a lack of time.