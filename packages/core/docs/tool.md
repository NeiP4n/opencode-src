# core/tool — execution of tools: schemas, permissions, reading of files and 16 built-in tools

## What's In This Folder

Five support files and the subfolder `plugin/` with 16 built-in tools
(read, write, edit, patch, grep, glob, shell, question, skill, subagent,
webfetch, websearch, opencode, mcp-resource and the auxiliary file-diff).
Next to it lies `AGENTS.md` with the canon of the folder and `patch.txt` — the description
of the patch tool, imported as a module.

## Key Files

- `packages/core/src/tool/runtime.ts` — the bridge between the registration and the
  provider: `definition`, `execute`, `normalizeContent`,
  `normalizedName`, `effectiveName`, as well as the normalization of JSON Schema.
- `packages/core/src/tool/read-filesystem.ts` — reading of files, directories and
  media page by page: the service `ReadToolFileSystem`, the errors
  `BinaryFileError`, `MediaIngestLimitError`, `OffsetOutOfRangeError`,
  `PathKindError`, the schemas `TextPage` and `ListPage`.
- `packages/core/src/tool/mcp.ts` — the registration of the tools of the MCP servers
  as ordinary ones, the service `McpTool` with the `flush` method.
- `packages/core/src/tool/http-body.ts` — the body of an HTTP response with a hard
  byte limit.
- `packages/core/src/tool/html-markdown.ts` — a converter of HTML to markdown
  (658 lines, its own parser on top of `htmlparser2`), the function
  `convertHTMLToMarkdown`, the constant `MAX_MARKDOWN_BYTES`.
- `packages/core/src/tool/plugin/` — the tools themselves; `read.ts` also looks for
  `AGENTS.md` up the tree, `patch.ts` applies a patch and knows moving a file, `shell.ts` launches commands in the background, `subagent.ts`
  works in a child session, `opencode.ts` gives the tools of the system itself.

## Important Details

- The read limits: `MAX_READ_LINES` = 2000, `MAX_READ_BYTES` = 50 KiB,
  `MAX_MEDIA_INGEST_BYTES` = 20 MiB, the line length is cut to 2000
  characters, the read chunk `FIRST_CHUNK` = 256 KiB.
- `MEDIA_MIMES` (png, jpeg, gif, webp, pdf) are read entirely and handed over
  as base64, everything else — as text. The binarity is determined by the presence of a null
  byte, and not by the extension.
- The page-by-page reading relies on a "rope" (`TextNode` with weights by
  bytes and line breaks): the line position is looked for as an ordinal
  statistic, without a repeated decoding.
- `runtime.ts` accepts three kinds of schemas: Effect Schema, Standard Schema
  (`~standard`) and ordinary JSON Schema. JSON Schema is converted via
  `JsonSchema.fromSchemaDraft07` or `2020-12` — the choice by the field `$schema` and
  the presence of `definitions`.
- Before being sent to the model a JSON Schema is simplified: `allOf` is collapsed,
  local `$ref` are expanded, unused `$defs` are removed.
  Only the representation changes, not the checking. Recursive references are not
  expanded deliberately; on a conflict of fields the merge goes through
  `allOf`.
- `execute` at the trust boundary brings any error to `Tool.Error`: someone else's
  typed failure would otherwise slip past all the `catchTag` and leave
  the call unfinished. A user refusal and an interruption are left alone.
- `normalizeContent`: a string becomes a text block, an empty array —
  a text from the output (JSON), a non-empty one is copied as is.
- `normalizedName` replaces everything except letters, digits, `_` and `-` with
  an underscore; `effectiveName` additionally glues the namespace.
  The dots in the namespace are replaced with underscores — otherwise than in
  `tool/mcp.ts`, where the same task is solved with a regular expression.
- All tools except `opencode`, `mcp-resource` and `subagent` are switched off
  from Code Mode with the option `codemode: false`; `session_move` on the contrary is
  `pinned: true`.
- `edit`, `write` and `patch` use the common action of the `edit` permission, the others
  — their own tool name. The permission is checked **after** the preparation: for `edit`
  this is the reading of the file and the counting of the matches, for `shell` — the parsing of the command.
- `edit` looks for a match in three passes: an exact occurrence, then with
  the Unicode normalization (quotes, dashes, spaces), then a line-by-line
  comparison with the end of the line cut off; the matches of the third pass are
  non-overlapping. The replacement is applied from the end of the list, so that the offsets do not
  diverge.
- `patch` is applied under the file lock, the lock path is counted before
  the execution of the effect; on an error it reports which files have already been changed.
- `patch` hides `edit` and `write` for the models of the `gpt-` family, except
  `oss` and `gpt-4`, and for the rest it hides `patch` itself.
- `shell` by default gives 120 seconds, the background commands have no timeout; into the
  environment are put `AGENT=1`, `OPENCODE=1`, `AI_AGENT`,
  `OPENCODE_SESSION_ID`.
- `subagent` checks the nesting depth by
  `experimental.subagent_depth` (1 by default), forbids the agents of the `primary` mode and requires
  that the continued session be a child of the current one.
  The description is supplemented with a list of the available subagents through the session hooks.
- `webfetch` rejects non-HTTP schemes, the pictures and non-text types, the timeout
  is 30 seconds by default and at most 120, it repeats the request with another
  User-Agent on a Cloudflare answer (403 with `cf-mitigated: challenge`).
- `websearch` without a provider asks the user the question through a form: a cancellation
  gives an error, "disable" switches the search off, "random" remembers the choice.
- `html-markdown.ts` limits the output to `MAX_MARKDOWN_BYTES` = 5 MiB and
  cuts at a byte boundary; at a nesting of more than 10000 tags the parsing
  stops. `script`, `style`, `noscript`, `iframe`,
  `object`, `embed`, `meta`, `link`, `template`, the attributes `hidden`,
  `aria-hidden="true"` and everything inside `head` are hidden. A table is printed
  as a Markdown table only with the same row width and without
  `colspan`/`rowspan`, otherwise line by line. The depth of quotes is at most 8 levels.

## Connections

- `packages/core/src/tool/AGENTS.md` — the canon of the folder: the rules of registration,
  the priority of names, `dispose`, the prohibition of a second execution path and the prohibition of
  `catchCause` in the leaves.
- `packages/core/src/tool.ts` (the root `src`) — owns the service of
  tools and their execution.
- `@opencode/ai` — `ToolDefinition` and `ToolFailure`;
  `@opencode/schema/tool` — the types `Info`, `Context`, `Content`, `Metadata`;
  `@opencode/schema/file-diff` — the form of a diff.
- `@opencode/util/patch` — `Patch.parse`, `Patch.derive`, `Patch.joinBom`;
  `@opencode/util/bom` — work with BOM.
- `packages/core/src/file-access.ts` — `resolve`, `authorizeRead`,
  `authorizeExternal`; `packages/core/src/file-mutation.ts` — `readText`,
  `write`, `withLock`, `syncTextBom`.
- `packages/core/src/shell.ts` and `shell/` (`parse.ts`, `select.ts`,
  `result.ts`); `packages/core/src/ripgrep.ts` — `grep` and `glob`;
  `packages/core/src/filesystem.ts` — `Entry`, `Match`, the search limits.
- `packages/core/src/permission.ts`, `packages/core/src/form.ts`,
  `packages/core/src/job.ts`, `packages/core/src/session/subagent-job.ts`.
- `packages/core/src/codemode/tool.ts` — the consumer of `definition` and
  `normalizedName` from `runtime.ts`.

## Pitfalls

- A user refusal and the closing of a question go through as defects via `mapError`:
  catching them there is not allowed, otherwise the model will get a "tool error" instead of
  a quiet end of the step.
- In all tools the error of the reservation is wrapped in `Effect.orDie`:
  a failure of the registration brings down the layer, and is not returned to the model.
- `edit` looks for `oldString` as a substring, the indents of the new lines are written by the model
  itself. The path resolution and the reading of the file go **before** the check of the match,
  therefore a wrong call pays for the read anyway.
- `edit` with several matches fails, but the preview of the diff has already
  been sent to the permission check at that moment.
- `glob` compares the input path with the strings `"undefined"` and `"null"` — that is
  the protection against the values substituted by the model. `glob` and `grep` ask ripgrep for
  `limit + 1`, in order to distinguish "exactly the limit" from "there is more".
- `grep` with an empty `pattern` fails on the schema check with a special text.
- `shell` starts the parsing of the command and the check of the permissions before the spawn of the process, and
  the check of the existence of the directory — right before it: the approval may
  survive a deleted directory.
- The text `BACKGROUND_INSTRUCTION` forbids the model from polling the completion of a
  background command; similar prohibitions are in `subagent` and `websearch`.
- `subagent` when continuing a session with another agent the model switches, and
  with the same agent it inherits from the parent.
- `read` picks a name that differs only by Unicode normalization, and
  adds the found `AGENTS.md` as the session instructions; the failures of this search
  never fail the read.
- The formatting in `write`/`edit`/`patch` is called **after** the write, and the BOM
  is restored by a separate read: if the formatter did not work, a different BOM encoding could have
  got onto the disk.
- In `write` and `edit` there are notes about the unimplemented steps: the events
  of the file observer, the snapshots and the cancellation of the changes, the LSP notifications. There are none —
  editing a file does not generate events and is not rolled back.