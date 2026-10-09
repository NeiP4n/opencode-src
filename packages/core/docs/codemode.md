# core/codemode — running tools as code: catalog, instruction, fetch extension, execute tool

## What's In This Folder

Four files: `catalog.ts` — compressing the tool catalog down to a limit,
`instructions.ts` — the instruction for the model carrying that catalog, `web.ts` —
the extension with a `fetch` function, `tool.ts` — the `execute` tool itself,
which runs code written by the model and calls tools through it.

The idea: instead of a thousand separate calls the model writes JavaScript and
orchestrates the calls itself, and the tool catalog gets into the instruction
only partially — under a character budget.

## Key Files

- `packages/core/src/codemode/catalog.ts` — `summarize(inventory, options)`,
  `namespaceLine(namespace)`, internal `flatten`, `rankListings`, `cost`;
  the `Tool` schema and the `Namespace`, `Inventory`, `Summary`, `Options` types.
- `packages/core/src/codemode/instructions.ts` — `render(catalog)`,
  `update(previous, current)`, `make(inventory?)`, internal `prompt(hasMoreTools)`.
- `packages/core/src/codemode/web.ts` — `extension`, `display(args)`, a local
  `fetch` with a 30 second timeout.
- `packages/core/src/codemode/tool.ts` — `create(inventory, executeTool)`
  (assembles the `Info` of the `execute` tool), `catalog(inventory)`,
  internal `runtime`, `renderTools`, `renderCatalog`, `formatResult`.

## Important Details

- The cost of a line in the budget is counted as `Math.round(length / 4)` —
  four characters per token. The default budget `INLINE_BUDGET` = 2000,
  overridable with the `budget` option.
- The budget is spent like this: first all namespaces (heading plus pinned
  tools), then one tool per namespace per round, starting with the shortest
  lines. A namespace drops out when the next candidate costs more than the
  budget remainder.
- Tools with `pinned: true` always make it into the output and do not compete:
  they are added to `selectedListings` before the remainder is computed.
- The first line of a tool description is cut to 120 characters with an ellipsis
  and printed as a `//` comment after the signature. An empty description
  adds no comment.
- The namespace name is taken from the first part of `path` before the dot
  (`tool.path.split(".", 1)[0]`), that is the top-level grouping.
- `Summary` distinguishes `total` (how many in all) and `shown` (how many lines
  actually made it). A mismatch between these numbers is the sign of a partial
  catalog, and it is exactly that which switches the wording of the instruction.
- `namespaceLine` gives three variants of the label: full (`5 tools`), partial
  (`5 tools, 2 shown`) and empty (`5 tools, none shown`); a single tool is
  always printed as `1 tool`.
- `instructions.ts` decides whether to show the model a mention of `search`:
  the function `prompt(hasMoreTools)` gives two different texts — with a full
  catalog the text keeps «The catalog is complete. Do not guess tool
  names.»
- With an empty catalog (`total === 0`) the instruction explicitly forbids
  calling `execute` and warns that the catalog may change.
- `update` first compares the completeness of both states: if one was full and
  the other was not, the full replacement is returned. Then the namespace
  descriptions are compared, then the tool lines, then the tool counts per
  namespace.
- A delta is chosen only if it is **shorter** than the full replacement
  (`delta.length < replacement.length`), otherwise the full catalog is returned.
- In partial catalog mode the removed tools are printed via
  `toolExpression(path)` (the name in parentheses), in full mode as `path`.
- `make(inventory?)` without an argument returns the `removed` state:
  the instruction says there are no Code Mode tools anymore.
- `web.ts`: the `TIMEOUT_MS` timeout = 30 000 via `AbortSignal.timeout`, the body
  of the response is read into bytes right away (`response.bytes()`), and `text()`
  and `json()` are obtained from them later. Headers are normalized to lower
  case, `get` returns `null` when absent.
- `display(args)` shows only the method and the URL for a `fetch` call — the
  method defaults to `GET`, in upper case.
- `tool.ts`: the description of the `execute` tool is immutable text about
  unavailable imports, the filesystem and timers, plus the rule of calling only
  by the exact paths and signatures from the catalog, keeping the
  bracket notation of the form `tools.<ns>["tool-name"](input)`.
- The call counters are held in a `Ref`, and the log write is guarded by a
  `Semaphore` with a single permit — parallel calls do not lose lines.
- The `toolCalls` log is shown in start order: the call index is remembered in
  a `WeakMap` keyed by the call object, so the second hook finds its own line
  and changes only `status`.
- The assembled `ExecuteOutput` is returned at once in three forms: `output`
  (structure), `content` (text plus files as data-URI) and `metadata`.
- Files from the result are collected in the order of the tool calls and moved
  to the top in `files`; base64 data is taken from `uri` only with the prefix
  `data:<mime>;base64,`, otherwise the part is ignored.
- `runtime` builds a `Node` tree (tool, namespace, children) and resolves a
  collision: a record in the object cannot be both a tool and a namespace at
  once, so such a tool is moved into a flat record by the full dotted path.
- `qualifiedName` adds the namespace prefix from
  `registration.options.namespace`, and the name is normalized by the
  `normalizedName` function from `tool/runtime.ts`.
- `formatResult`: success — the value (`JSON.stringify` with indent 2, if it is
  not a string), error — the message plus `suggestions` hints filtered against
  duplicates (a hint already contained in the error text is not printed).
  Warnings and logs are glued on as separate `Warnings:` and `Logs:` blocks.
- `catalog(inventory)` marks `pinned` by the registration option
  `options.pinned === true`, not by the catalog data.

## Connections

- `@opencode/codemode` (a separate package, 45 files by the manifest) — the
  engine itself: `CodeMode.make`, `Tool.make`, `Namespace.make`, `Extension.make`,
  `toolError`, the `Hooks`, `Result`, `DataValue` types, and also
  `searchSignature` and `toolExpression`, which are printed into the instruction.
- `packages/core/src/tool/runtime.ts` — `definition(registration)` and
  `normalizedName(registration)`: name normalization and turning a tool
  registration into a description and schemas.
- `@opencode/schema/tool` — the `Info`, `Context`, `Content`, `Result`,
  `Metadata`, `Error`, `Namespace` types handed to the tool registry.
- `packages/core/src/instructions/index.ts` — `Instructions.make`, `Key`,
  `diffByKey`, `removed`; the instruction key `core/codemode`.
- `CodeMode.Input` from the `codemode` package — the input schema: an object
  with a `code` field.

## Pitfalls

- `catalog.ts` has a code note that the namespace walk is not yet size-limited:
  with a very large catalog the sum of the namespace headings can exceed the
  budget entirely, and the model will not get the full catalog.
- `remaining` is computed by subtraction, so on overspend it goes negative and
  the loop simply adds nothing — there is no error, there will just be fewer
  tools in the output than expected.
- Only tools that passed `rankListings` spend the budget: the selection order
  is by line length, not by importance, except for the pinned ones.
- `make()` without an inventory gives `removed`, and `read` returns a special
  state rather than an empty catalog: the difference shows in the render.
- `update` compares tool lines (`line`), not the catalog objects themselves,
  so any change of a signature or a comment counts as a tool change.
- The "tool and namespace under one name" collision is resolved by moving the
  tool into a flat record by the dotted path; the top-level name in the `tools`
  object turns out to be occupied by the namespace.
- Progress handlers filter extension calls: only `fetch` gets into the log,
  everything else stays outside the interface.
- The timeout in `web.ts` is hard and not configurable: 30 seconds for any request.
- `json()` in `web.ts` throws a parse exception instead of returning an error
  to the caller — inside Code Mode this becomes an execution exception.