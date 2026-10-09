# core/integration — connection types of an integration and the identity rule of an access method

## What's In This Folder

- `connection.ts` — a thin facade re-exporting the connection schemas from `@opencode/schema/connection` plus one `key` function that reduces the access method (a stored credential or an environment variable) to a string key.

## Key Files

- `packages/core/src/integration/connection.ts` — the whole module.

## Important Details

- Values and types are exported in pairs: `CredentialInfo`, `EnvInfo`, `Info`, `Status`. Each export refers to exactly the same schema object from `packages/schema/src/connection.ts`, without a wrapper or a copy — that is how a single schema identity for the core and the schema is preserved.
- `Info` — a tagged union `CredentialInfo | EnvInfo` by the `type` field. The discriminator value: `"credential"` or `"env"`.
- `key(connection)` returns `undefined` if there is no connection, `credential:<id>` for a credential and `env:<name>` for an environment variable.
- `key` is the only function with logic in the whole module. It is pure: it does not read state, does not go into Effect, does not throw exceptions.
- In the comment above `key` a property is recorded: a newly connected credential is not considered a new connection if the labels and the values of the refreshed token did not change. In other words the identity is set only by `type` plus `id`/`name`.
- The first line of the file is `export * as IntegrationConnection from "./connection.js"`: the module serves itself, the consumers import the namespace and not separate functions.
- Names like `credential`, `env` in the key are chosen so that they do not collide with the identifier format (`prt_`, `msg_` and the like), where there is an underscore separator.

## Connections

- `packages/schema/src/connection.ts` — the source of all re-exported schemas: `Status`, `CredentialInfo`, `EnvInfo`, `Info`.
- `packages/core/src/integration.ts` — the main consumer: the connection types in the service interface, `active(id)`, the connection registration and the status map, where the key is built as the pair "integration ID plus `IntegrationConnection.key(connection)`".
- `packages/core/src/plugin/provider/azure.ts` — compares `IntegrationConnection.key` for the current and the loaded connection, so as not to reconnect from scratch without need.
- `packages/core/src/plugin/provider/chatgpt.ts` — compares the key before and after a token refresh, to tell a credential change from a simple refresh.
- `packages/core/src/credential.ts` — the credential storage whose IDs land in the key.
- `packages/core/src/wellknown/plugin.ts` — assembles the "Log in" method for integrations from the manifest, that is, it complements the same connection layer from the plugin side.

## Pitfalls

- The key deliberately ignores `label`, `method` (`key` or `oauth`) and `status`: renaming a credential or changing its authorization type does not change the key. Comparing connections by such fields is useless here — only via `key`.
- `key(undefined)` gives the string `"undefined"` under naive interpolation into a string. In `packages/core/src/integration.ts` the key is substituted into the template directly, so the case of an absent connection gives a record with that string instead of skipping the record.
- The pairs "`credential:X`" and "`env:X`" are the only difference by type: a credential identifier and an environment variable name are compared in one string space, the distinction is held only by the prefix of the type.
- The argument type of `key` is narrower than `Info` from the schema: it takes only `{ type, id }` or `{ type, name }` with the second field mandatory, which allows calling it on cut objects, but cuts off the variant without `id`/`name` without a compile error.
- The module contains no validation and no Effect layers: any logic of checking or of reacting to a connection change lives in `packages/core/src/integration.ts` and in the providers, and not here.