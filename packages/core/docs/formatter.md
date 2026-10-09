# core/formatter — built-in source formatters by file extension

## What's In This Folder

One file `packages/core/src/formatter/builtins.ts`: a list of 25 formatters
(gofmt, mix, oxfmt, prettier, biome, zig, clang-format, ktlint, ruff, air, uv,
rubocop, standardrb, htmlbeautifier, dart, ocamlformat, terraform, latexindent,
gleam, shfmt, nixfmt, rustfmt, pint, ormolu, cljfmt, dfmt). Each is described
by an `Info` interface — a name, a list of extensions and `enabled`.

`Info.enabled` is `Effect<string[] | false>`: either an array of command line
arguments with a `$FILE` substitution, or `false` if the formatter does not suit
this project. The choice is lazy, so environment checks
(binary search, reading configs) are not performed when the module is imported.

## Key Files

- `packages/core/src/formatter/builtins.ts` — the function `make(input)` assembling
  the whole list. It takes `directory`, `worktree`, the services `fs`, `npm`,
  `processes` and `bin` (the directory with the binaries).
- The helper `executable(name, extensions, args, findExecutable)` — the basic
  constructor for most formatters: found a binary in PATH → returned
  `[path, ...args]`, did not find → `false`.
- The helpers `hasDependency`, `hasRecordKey`, `isRecord` — safe checking
  of fields in parsed JSON without type assertions.

## Important Details

- The list is returned in a fixed order, `gofmt` first.
  The order is part of the contract for the calling side.
- Three strategies for determining "the formatter applies":
  1. by the presence of a binary in PATH (`gofmt`, `mix`, `zig`, `ktlint`, `rubocop`,
     `standardrb`, `htmlbeautifier`, `dart`, `terraform`, `latexindent`,
     `gleam`, `shfmt`, `nixfmt`, `rustfmt`, `ormolu`, `cljfmt`, `dfmt`);
  2. by a config file found up the tree (`biome` looks for
     `biome.json`/`biome.jsonc`, `clang-format` — `.clang-format`,
     `ocamlformat` — `.ocamlformat`);
  3. by a project dependency (`prettier`, `oxfmt` look into `package.json`,
     `pint` — into `composer.json`).
- `ruff` requires both a binary and a confirmation from the settings: `pyproject.toml`
  fits only if its text has the section `[tool.ruff]`; for
  `ruff.toml` and `.ruff.toml` this is not required. The second path is a mention
  of `ruff` in `requirements.txt`, `pyproject.toml` or `Pipfile`.
- `air` (R) checks not only the return code of `air --help`, but also the text of the first
  help line: it must contain the substrings `R language` and `formatter`. Otherwise the
  formatter is considered unsuitable. `uv` checks only `uv format --help`.
- `prettier`, `oxfmt` and `biome` declare `environment: { BUN_BE_BUN: "1" }` —
  that is a hint to the calling side, not a variable the module sets itself.
- File permissions are substituted by extension, the comparison is case-sensitive. `clang-format`'s
  list contains both lower and upper case variants (`.c` and `.C`), `pint`'s — only `.php`.
- Almost all have `.pipe(Effect.orElseSucceed(() => disabled))` on `enabled`:
  any read or launch error turns into "formatter off", not
  into an exception. The exception is `air`, it has no error handling.
- The path to `pint` is hardcoded as `./vendor/bin/pint`: the binary is searched not in
  PATH, but in the `vendor/bin` directory of the current project.
- `Formatter` is a folder with one file: there are no subdirectories, no tests nearby.

## Connections

- `packages/core/src/util/which.ts` — the function `which(name, undefined, bin)`,
  the only source of the binary path for `executable` formatters.
- `@opencode/util/fs-util` — `fs.findUp` (searching for configs and `package.json`
  up from `directory` to `worktree`) and `fs.readFileString` / `fs.readJson`.
- `@opencode/util/npm` — `npm.which("prettier")`, `npm.which("oxfmt")`,
  `npm.which("@biomejs/biome")`: npm-dependent formatters are searched through
  the installed package, not through PATH.
- `@opencode/util/process` (`AppProcess`) and `effect/unstable/process`
  (`ChildProcess`) — launching with `--help` for `air` and `uv`.
- `packages/core/src/v1/config/formatter.ts` — the configuration of the old format
  with the formatter settings comes from there (by names, not by this list).

## Pitfalls

- `Effect.orElseSucceed` hides the real error: if `fs.readJson` fails
  on an invalid `package.json`, the result is `false`, and the formatter is silently
  switched off without any diagnostic.
- `air` is the only one without `orElseSucceed`: a failure of `air --help` goes outward
  as an effect, not turning into a switch-off.
- For `prettier` the check goes over all found `package.json` files with a `continue`
  filter, while for `pint` — with a return on the first matching `composer.json`.
  The behavior with several manifests differs.
- `mix` made it into the list with the extensions of Elixir/EEx templates (`.ex`, `.exs`,
  `.eex`, `.heex`, `.leex`, `.neex`, `.sface`), although only
  the presence of the `mix` binary is checked — the Elixir version and the presence of a project are not looked at.
- `findUp` is limited by `worktree`: above the worktree boundary the search does not go up,
  so a project without `package.json` inside the worktree will not find a formatter
  based on npm dependencies.