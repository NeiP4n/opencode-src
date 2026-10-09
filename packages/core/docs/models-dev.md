# core/models-dev — the built-in snapshot of the OpenCode model catalog

## What's In This Folder

- `snapshot.txt` — the only file, and it is not TypeScript: it is one giant JSON text of 5 246 113 bytes.
- There is nothing else in the folder but this file. No schemas, no functions, no tests.

## Key Files

- `packages/core/src/models-dev/snapshot.txt` — the catalog data.
- `packages/core/src/models-dev.ts` — the only consumer: it imports the file as text and decodes it.

## Important Details

- The file is imported in the code as a module with a text type: `import snapshotText from "./models-dev/snapshot.txt" with { type: "text" }`. This is not a reading of the file from disk — the content gets into the build as a module-level string constant.
- The file is not formatted: it is a single line without line breaks. Verified: `wc -l` gives 0, while the size is 5 MB. Opening such a file in an editor line by line is pointless — only a string search is worthwhile.
- The format is a provider catalog, where the top-level key is the provider identifier. This is how the beginning of the file looks: `deepinfra` with the fields `id`, `env` (a list of environment variable names), `npm`, `name`, `doc` and `models`.
- Inside `models` the key is the model identifier at the provider, and in the value there is at least `id`, `name`, `description` and `family`.
- The comment in the code above the import names the source: the snapshot was made from `https://models.opencode.ai/api.json`. The update script is `bun run script/update-models-snapshot.ts`, it lives in `packages/core/script/update-models-snapshot.ts`.
- A second explanation in the same comment answers why the snapshot is embedded in the code and not downloaded at startup: it is decoded and normalized once per isolate, and not per runtime. The reason is stated outright — one isolate can contain many runtimes (in Cloudflare that is several instances of a Durable Object), and decoding per runtime would multiply the cost.
- The cache mechanism: the module-level variable `bundledCache` holds the already normalized result. The read is wrapped in `Effect.suspend`, so the file is not touched and not parsed before the first access.
- The cache key in the storage is built by the function `cacheKey`: for the default source it is `models-dev:catalog`, for any other — `models-dev:catalog:` plus a fast hash of the address.
- The cache record holds `updatedAt`, `body` and an optional `digest`. The `digest` field was added as a hash of the raw body, so that `refresh()` does not republish the byte-for-byte same catalog. The comment in the code notes that for records created before the field appeared it is optional.

## Connections

- `packages/core/src/models-dev.ts` — the only importing file: `models-dev.ts:16` declares the import, and around line 271 there is a comment about the origin and the update of the snapshot.
- `packages/core/src/plugin/models-dev.ts` — the consumer of the catalog service: subscribes to `ModelsDev.Event.Refreshed`, prepares the data and lays it out by providers. There too are declared `prepared` as a `WeakMap` and `environmentNames(provider)`.
- `packages/core/src/plugin/internal.ts` — registers `ModelsDev.Service` and `ModelsDev.node` in the list of internal services.
- `packages/core/src/kv.ts` — the storage in which the catalog cache lies together with `digest` and `updatedAt`.
- `packages/core/script/update-models-snapshot.ts` — the script that rewrites this file.
- `packages/schema/src/models-dev.ts` — the snapshot schema: the `Snapshot` type, which is used both in the built-in and in the network variant.
- `packages/core/src/github-copilot/models.ts` and `packages/core/src/modal/models.ts` — other converters of external model catalogs to `Model.Info`; it is useful to compare, because the merge rules of all three are different.
- `packages/core/docs/github-copilot.md` — the document of the Copilot client, where another model catalog is described, already without a snapshot.

## Pitfalls

- The file weighs 5 MB and gets into the build entirely. Any edit next to it (formatting, line breaks) will increase both the build time and the size of the package.
- The format has no version and no schema in the folder itself. You can check the file against anything only through `decodeCatalog` in `packages/core/src/models-dev.ts`.
- The content has no line breaks: tools that print the file line by line will show a single line several megabytes long.
- The path of the file coincides with the name of the same-named catalog folder. A search for the word `models-dev` in the repository will find both the code and the data, and they will have to be told apart.
- The snapshot silently gets stale: without running the update script the data about models, prices and limits stays at the date of the commit. The code does not check the age of the snapshot.
- Freshness against the network source is not checked at startup. A divergence between the built-in snapshot and what `models.opencode.ai` returns is a normal state, and not an error.
- The decoding is deferred to the first access, but is performed once per isolate, and not per process. In an environment with several isolates the memory for the normalized catalog will be occupied in each.
- The file stores the prices and limits in a foreign format. The recalculation into a cost per million tokens is done during normalization, so looking for the finished numbers in the snapshot itself is pointless.