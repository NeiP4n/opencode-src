# core/shell — shell selection, command parsing and execution results

## What's In This Folder

Seven files. Three of them are command parsing for permissions: a manual scanner of bash and
PowerShell (`scan.ts`, the largest file of the folder, about 1500 lines), a scanner based
on tree-sitter grammars (`parse.ts`) and the selection of a shell from a list of known ones
(`select.ts`). Also `result.ts` assembles the answer about an executed command, and the three
`parser-wasm.*` hand over the paths to the wasm files of the parser.

## Key Files

- `packages/core/src/shell/scan.ts` — `scan(input)` for bash and
  `scanPowerShell(input)` for PowerShell, the type `Result` (`scanned` with commands
  or `opaque` with a reason), the type `OpaqueReason`, the internal parsings
  `bashExpansion`, `bashDelimited`, `bashHeredoc`, `powerShellBlock`,
  `powerShellEscape`, `powerShellRedirect`.
- `packages/core/src/shell/parse.ts` — `scan`, `scanPortable`, `scanLegacy`,
  the arity table `ARITY`, the type `Result` with commands and directories.
- `packages/core/src/shell/select.ts` — the service `@opencode/ShellSelect`, the layers
  `layer`, `configured`, `node`; the functions `resolve`, `list`, `args`, `name`,
  `login`, `ps`, `environment`, `gitbash`.
- `packages/core/src/shell/result.ts` — `output`, `notice`, `metadata`,
  `notification`, `userNotification`, the constant `unavailable`.
- `packages/core/src/shell/parser-wasm.bun.ts`, `parser-wasm.node.ts`,
  `parser-wasm.workerd.ts` — three sources of the paths to the wasm artifacts.

## Important Details

- The manual scanner answers the question "which commands will run at all", and not
  "what is allowed": the type `Result` explicitly names the `opaque` separation as a
  parsing limitation. `OpaqueReason` lists nine reasons: from
  `command-substitution` to `dynamic-command-name`.
- Each command is described by its source (`resource`), the parsed words
  (`words`), their original forms (`rawWords`), the ends of the words relative to
  `resource` (`wordEnds`), the sign of the beginning of an operator (`statementHead`),
  the sign of a declaration (`declaration`) and the number of words before a trailing
  redirect (`redirectWordCount`).
- The parsing limits are hard: input up to 64 KiB, substitution depth up to 32 and the total
  source budget of `MAX_INPUT_LENGTH * MAX_SUBSTITUTION_DEPTH`. On exhausting
  the budget or the limit — `opaque`, and not a partial parsing.
- The declarations `declare`, `typeset`, `export`, `readonly`, `local`, `unset`,
  `unsetenv` are marked with the flag `declaration`, and `parse.ts` skips them: in
  the legacy parsing the declarations were skipped, but the substitutions inside them were not.
- The shell is chosen by the known table `META`: `fish` and `nu` are marked as
  incompatible, the PowerShell shells require special launch arguments, and
  `bash`, `dash`, `ksh`, `sh`, `zsh` are launched as login shells.
- `parse.ts` builds the command prefix for the permission by substituting the first words:
  by the arity table (`npm run` — 3 words, `git` — 2, `cat` — 1) and the
  saved permission gets the form `prefix *`. If the prefix is not found,
  one word is taken.
- In PowerShell the prefix priority differs from bash: there the original
  command boundary is kept and `*` is added after it, so that the already issued permissions
  do not change after the normalization of spaces. The check goes through `Wildcard.match`.
- The directories are extracted from the directory change commands: `cd`, `chdir`, `popd`,
  `pushd`, `push-location`, `set-location`. In PowerShell the flags
  `-Path` and `-LiteralPath` are taken into account, including in the form `-Path:value`.
- Only surely safe values are expanded: `~`, `~/`, environment variables through `$env:NAME`, `$HOME`, `$PWD`, `$PSHOME`. Any construction with
  `$`, a backtick or an opening bracket is not expanded at all —
  an unknown expression cannot be resolved safely at the analysis stage.
- The environment variable names in PowerShell are looked up case-insensitively, but on
  non-Windows a direct access to `process.env` is used.
- Wasm files: under Bun they are embedded by a static import, under Node
  they are resolved through `require.resolve` with the possibility to override the path
  with environment variables, under workerd they stay empty strings, so that the module
  loads without side effects.
- The tree-sitter parsing is lazy (`lazy`), the bash and PowerShell languages are loaded
  in parallel, the tree is freed via `acquireUseRelease`.
- `result.ts` in the absence of output gives not an empty string but a special
  text «Shell command output is no longer available.» with the cursor and the size,
  counted in bytes.
- `notice` chooses the first suitable wording: a timeout, then a signal,
  then a non-zero return code; with a zero code it gives nothing.
- The user notification about an executed command starts with the phrase «The
  following shell command was executed by the user» and carries the metadata with
  the source `shell`.

## Connections

- `parse.ts` calls `ShellSelect.ps(shell)` to choose the grammar, and
  `Wildcard.match` from `../util/wildcard.js` to stabilize the prefix;
  the lazy loading comes from `../util/lazy.js`, the search of the executables —
  `../util/which.js`.
- The manual scanner is loaded dynamically only in the portable mode
  (`Effect.tryPromise` with `import("./scan.js")`), therefore the main work path
  does not pull this large module.
- `select.ts` is a location node: it depends only on `Global.node`, because
  it looks for shells in the system paths and in the data directory.
- The shell types (`Shell.Info`, `Shell.Output`) come from
  `@opencode/schema/shell`; the kind of the file event comes from `FileSystem.Event.Changed`
  in `filesystem/watcher.ts`.
- The permissions on the commands counted by these files are consumed by the permissions
  layer `permission.ts`; the commands themselves are executed by the location environment from the
  `environment` folder.

## Pitfalls

- The manual bash scanner does not understand command substitution deeper than 32 levels and does not
  accept input longer than 64 KiB: instead of a partial result you get `opaque`, and the
  analysis of the rights will fail entirely.
- Compound constructions (functions, `if`, loops, `case`) are not parsed as
  commands — they are either expanded or give `opaque` with the reason
  `compound-command`.
- Variable declarations are marked and not thrown out: the caller is obliged to
  filter them, otherwise `export` and `local` will appear in the list of commands.
- The `ARITY` table is a list of known commands and not the full syntax: for
  an unknown command one word is kept, that is, the permission may turn out
  narrower than the actual one.
- `meta` in `select.ts` answers "is a login shell needed", and `ps` answers "are
  PowerShell arguments needed". For `fish` and `nu` the compatibility is negative, and
  such shells are filtered out at the `compat` priority.
- `unavailable` in `result.ts` is a meaningful replacement of an answer, and not a sign of
  an error: the client will see the text about the unavailability of the output, and that is better than an emptiness.
- The cache of the resolved shell is reset via `resolve.reset`, and is checked by the
  `bin` directory: a removed installation of another shell requires a reset or
  a new data directory.
- Under workerd the paths to the wasm are empty: the parsing of commands does not work at all there, and
  the caller must behave as with an unavailable backend.