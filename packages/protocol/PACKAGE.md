# @opencode/protocol — the HTTP API contract

## What This Is

The opencode API contract: 36 files, ~4.2k lines in `src/`. The package
describes all server endpoints (methods, parameters, response and error
types) on Effect `HttpApi`. There is neither handler implementation nor core
logic here — only the declaration of what the server must be able to do.

`packages/protocol/src/api.ts` assembles a single `Api` from the groups in
`packages/protocol/src/groups/` — one group per REST area.

## Layers and Dependencies

Layer **L1**: depends on `schema` (data types). No other `@opencode/*`
packages in its dependencies.

Who depends on it:

- `packages/server` — mounts the `Api` into handlers;
- `packages/client` — generates a client from the same contract;
- `packages/plugin` — reads the contract types;
- `packages/simulation` — uses the contract in simulation.

Named export: `"./*": "./src/*.ts"` plus a separate
`"./simulation": "./src/simulation.ts"`.

## Subsystems and Files

**Contract assembly** — `packages/protocol/src/api.ts`: imports all
groups (`GenerateGroup`, `MessageGroup`, `ModelGroup`, `ProviderGroup`,
`makeSessionGroup`, `makePermissionGroup`, `FileSystemGroup`, `makeFormGroup`,
`CommandGroup`, `SkillGroup`, `RpcGroup`, `EventGroup`, `AgentGroup`,
`PluginGroup`, `ServerGroup`, `DebugGroup`, `PtyGroup`,
`PersistentPtyGroup`, `ShellGroup`, `ReferenceGroup`, `makeLocationGroup`,
`IntegrationGroup`, `WebSearchGroup`, `McpGroup`, `CredentialGroup`, …) and
glues them into a single `HttpApi`.

**Endpoint groups** — directory `packages/protocol/src/groups/`, 30 files:
`session.ts`, `message.ts`, `generate.ts`, `model.ts`, `provider.ts`,
`event.ts`, `permission.ts`, `form.ts`, `fs.ts`, `command.ts`, `skill.ts`,
`rpc.ts`, `agent.ts`, `plugin.ts`, `server.ts`, `debug.ts`, `pty.ts`,
`persistent-pty.ts`, `shell.ts`, `reference.ts`, `location.ts`,
`integration.ts`, `websearch.ts`, `mcp.ts`, `credential.ts`, `config.ts`,
`project.ts`, `vcs.ts`, `worktree.ts`, `migration.ts` — 30 files.

**Authorization and errors** — directory
`packages/protocol/src/middleware/`: `authorization.ts` (access check),
`schema-error.ts` (mapping validation errors to the API format).

**The rest** — `packages/protocol/src/client.ts` (the client-side type),
`packages/protocol/src/errors.ts` (contract errors),
`packages/protocol/src/simulation.ts` (the simulation contract, export
`./simulation`).

## Entry Points

1. `packages/protocol/src/api.ts` → `Api` — the single contract where both
   the server and the client generation start.
2. `packages/protocol/src/groups/` — a specific endpoint group, when a whole
   API section is needed.
3. `packages/protocol/src/middleware/authorization.ts` — how access to a
   request is checked.

## Where to Look Next

- `packages/server/PACKAGE.md` — the contract implementation (`HttpApiBuilder`).
- `packages/client/PACKAGE.md` — the client generated from this contract.
- `packages/httpapi-codegen/PACKAGE.md` — the generator that turns
  `Api` into client files.
- `packages/schema/PACKAGE.md` — the types the contract is built from.

## Pitfalls

1. **`protocol` contains no logic.** If an endpoint "does not work", look in
   `server` — here there is only the declaration.
2. **Editing `Api` requires regenerating the client** — `bun run generate` from
   `packages/client`; otherwise the client types diverge from the server.
3. **Groups come in two styles:** ready-made (`MessageGroup`) and factories
   (`makeSessionGroup(...)`), because some endpoints depend on passed-in
   options. Do not be surprised by a function call in `api.ts`.
4. **Named export instead of a root:** `exports` does not contain `"."`,
   only the `@opencode/protocol/<file>` paths and
   `@opencode/protocol/simulation` are importable.
