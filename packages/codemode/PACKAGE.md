# @opencode/codemode — model program interpreter and tools

## What This Is

An own wrapper language over tools: 45 files, ~10.8k lines in `src/`.
Inside — an interpreter of JavaScript-like programs, a stdlib of ready-made
functions and a description of the "tools" that a program can call. This is
the layer that the core (`core`) plugs in as a single `codemode` tool — the
model writes a short program, and it performs many steps.

## Layers and Dependencies

Layer **L0 — leaf**: depends on no other `@opencode/*` package. Foundation —
`effect` (`Effect`, `Schema`).

Who depends on it: `packages/core` (in the manifest it stands among the core's
dependencies), `packages/tui` — the call in the UI comes from there.

There is a single entry point — `exports` `".": "./src/index.ts"`.

## Subsystems and Files

**Public face** — `packages/codemode/src/index.ts`: namespace `CodeMode`,
`Extension`, `Namespace`, `Tool`, `OpenAPI` plus the named exports
`searchSignature`, `toolExpression`, `ToolError`, `toolError`.

**Program execution** — `packages/codemode/src/codemode.ts`: the
`ExecutionLimits` type (`timeoutMs` — time limit, `maxToolCalls` — maximum
number of tool calls; without values there is no limit) and the wiring:
`executeProgram` from the interpreter plus `extensionGlobals` and
`globalNames`.

**Interpreter** — the `packages/codemode/src/interpreter/` directory:
- `interpreter.ts` — AST traversal (nodes `CallExpression`, `ForStatement`,
  `ArrowFunctionExpression`, …);
- `execute.ts` — program execution;
- `model.ts`, `scope.ts`, `objects.ts`, `references.ts` — values, scopes,
  references;
- `intrinsics.ts`, `native.ts`, `generators.ts` — built-in functions, native
  calls, generators;
- `promises.ts`, `callback.ts` — promises and callbacks;
- `errors.ts`, `limits.ts` — errors and limits;
- `extensions.ts`, `globals.ts` — connecting extensions and the list of
  globals.

**Tools** — `packages/codemode/src/tool.ts` (types `Tool`, `JsonSchema`,
`SchemaType`, the `make` function), `tools.ts`, `tool-runtime.ts`
(`ToolRuntime`, `Services`, `ToolDescription`, `ToolCall`, `ToolInvocation`,
`CallResult`), `tool-schema.ts`, `tool-error.ts` (`ToolError`, `toolError`),
`namespace.ts`, `data.ts`, `extension.ts`.

**Standard library** — the `packages/codemode/src/stdlib/` directory:
`array.ts`, `string.ts`, `object.ts`, `number.ts`, `math.ts`, `json.ts`,
`date.ts`, `regexp.ts`, `url.ts`, `headers.ts`, `iterator.ts`,
`collections.ts`, `bytes.ts`, `console.ts`, `value.ts`, `web.ts`.

**OpenAPI** — the `packages/codemode/src/openapi/` directory: `index.ts`,
`spec.ts`, `runtime.ts`, `types.ts` (the package's own work plan file lies
there as well).

## Entry Points

1. `packages/codemode/src/index.ts` — the only export of the package.
2. `packages/codemode/src/index.ts` → `CodeMode` — execution and limits
   (`ExecutionLimits`).
3. `packages/codemode/src/index.ts` → `Tool.make(...)` — declaring your own
   tool for the program.
4. `packages/codemode/src/interpreter/execute.ts` → `executeProgram` — the
   lower level, if the interpreter itself is needed.

## Where to Look Next

- `packages/core/PACKAGE.md` — how the core wraps the package into a single
  tool.
- `packages/plugin/PACKAGE.md` — the host through which tools get executed.
- `packages/schema/PACKAGE.md` — data types, including tool descriptions.
- `packages/codemode/src/openapi/` — the package's own list of plans (not
  related to the general core documentation).

## Pitfalls

1. **`codemode` is not an npm script but an interpreter.** The model program
   runs inside the process with its own limits, not in an OS sandbox;
   `limits.ts` and `ExecutionLimits` are the only thing holding it back.
2. **There are no default limits.** `ExecutionLimits` literally says
   "No default": without a given `timeoutMs` and `maxToolCalls` the program
   can run unbounded.
3. **`tool.ts` accepts two kinds of schema** — Effect `Schema` or raw
   `JsonSchema`; mixing styles in one tool breaks validation at the boundary.
4. **Two different notions of "globals":** `interpreter/globals.ts` (names
   available to the program) and `interpreter/extensions.ts` (globals that
   extensions provide). Confusion between them gives "function not found".
5. **The plan file in `openapi/`** — working notes of the package; their
   presence does not mean the core documentation is incomplete.
