# @opencode/schema — the data types of all of opencode

## What This Is

The widest-reaching core package: 102 files, ~5.8k lines in `src/`.
All the data that flows between the parts of opencode is declared here, on
Effect Schema. No logic, no network, no files: only types, their validation and
serialization.

The package is imported by name (`exports` in `packages/schema/package.json`):

```json
".": "./src/index.ts",
"./*": "./src/*.ts"
```

## Layers and Dependencies

Layer **L0 — leaf**: does not depend on other `@opencode/*` packages (there are
none in `dependencies`), the foundation is `effect`.

Who uses it (number of files in `packages/*/src` where there is an
`@opencode/schema` import):

| Package | Files |
| --- | --- |
| `packages/core/src` | 132 |
| `packages/plugin/src` | 34 |
| `packages/protocol/src` | 30 |
| `packages/tui/src` | 16 |
| `packages/app/src` | 14 |
| `packages/cli/src` | 11 |
| `packages/ai/src` | 9 |
| `packages/client/src` | 7 |
| `packages/sdk/src` | 6 |
| `packages/plugin-browser/src` | 4 |
| `packages/server/src` | 3 |
| `packages/gui-extensions/src` | 2 |
| `packages/desktop/src` | 1 |
| `packages/enterprise/src` | 1 |

A change here changes the contract of all 14 packages.

## Subsystems and Files

**Public face** — `packages/schema/src/index.ts`: re-exports namespaces
(`Agent`, `Command`, `Config`, `Connection`, `Credential`, `Event`,
`FileSystem`, `Form`, `Integration`, `LLM`, `Location`, `Mcp`, `Model`,
`Money`, `Permission`, `Project`, `Worktree`, `Provider`, `Reference`, `Rpc`,
`Session`, `Vcs`, `Snapshot`, …).

**Sessions** — `session-id.ts`, `session-message.ts`, `session-metadata.ts`,
`session-event.ts`, `session-compaction-event.ts`, `session-error.ts`,
`session-fork.ts`, `session-revert.ts`, `session-inbox.ts`,
`session-provider-context.ts`, `session-stats.ts`, `session-transfer.ts`.

**Events** — `event.ts`, `event-manifest.ts`, `durable-event-manifest.ts`,
`event-log.ts`, `server-event.ts`, `legacy-event.ts` plus event subtypes:
`ide-event.ts`, `lsp-event.ts`, `mcp-event.ts`,
`installation-event.ts`, `location-event.ts`.

**Configuration** — `config.ts` and the directory `packages/schema/src/config/`:
`permission.ts` / `permission-v1.ts` / `permission-saved.ts`, `agent.ts`,
`command.ts`, `plugin.ts`, `question.ts` / `question-v1.ts`.

**Providers and models** — `provider.ts`, `model.ts`, `llm.ts`,
`models-dev.ts`, `credential.ts`, `money.ts`.

**Files and VCS** — `filesystem.ts` / `filesystem-v1.ts`, `file-diff.ts`,
`reference.ts`, `project.ts`, `project-id.ts`, `vcs.ts`, `snapshot.ts`
(search by name: `snapshot` is declared in `packages/schema/src`).

**Terminal and external services** — `pty.ts`, `persistent-pty.ts`,
`pty-ticket.ts`, `mcp.ts`, `connection.ts`, `integration.ts`,
`integration-id.ts`, `instruction.ts`, `instruction-entry.ts`.

**Identifiers and the rest** — `identifier.ts`, `rpc.ts`, `schema.ts`,
`prompt.ts`, `prompt-input.ts`, `websearch.ts`, `form.ts`,
`session-stats.ts`.

## Entry Points

1. `packages/schema/src/index.ts` — the root export, what everyone reads from.
2. `packages/schema/src/` — named access `@opencode/schema/<name>` for
   a single file without pulling in the others.
3. `packages/schema/src/session-id.ts` — when only the session identifier
   format is needed.

## Where to Look Next

- `packages/protocol/PACKAGE.md` — these types are wrapped into an HTTP contract.
- `packages/core/PACKAGE.md` — the main consumer (132 files), and where
  storage in `database` lives too.
- `packages/server/PACKAGE.md` — where types are validated on input and output.
- `packages/util/PACKAGE.md` — the lower layer the types rely on to live on disk.

## Pitfalls

1. **Type versions live side by side.** `filesystem.ts` and `filesystem-v1.ts`,
   `permission.ts` and `permission-v1.ts`, `question.ts` and `question-v1.ts` —
   these are not duplicates but the current and the old schema; moving data
   between them is a separate task.
2. **A namespace in `index.ts` does not always match its file:** `WebSearch`
   is exported from `websearch.ts`, while `Worktree` is not in the file of the
   same name. Search by the re-export in `index.ts`, not by file name.
3. **A schema change requires regenerating the client** — see
   `packages/httpapi-codegen/PACKAGE.md`: the contract ends up in the generated
   `packages/client` files.
4. **The `-v1` suffix is a sign of migration, not of a "package version".** New fields
   are added to the current file, the old one must not be touched: it carries data
   already written to the database.
