# core/util — short stateless helpers: errors, token estimation, paths, glob substitutions

## What's In This Folder

- `error.ts` — the base class of named errors with a data schema and the `create` factory.
- `error-summary.ts` — a folding of the `cause` chain into a short list for the interface.
- `token.ts` — a rough estimation of the number of tokens by the length of the text.
- `slug.ts` — a generator of human-readable names of the form "adjective-noun".
- `wildcard.ts` — comparison of a string with a pattern, where `*` and `?` work as in glob.
- `which.ts` — a search of an executable in `PATH` taking into account the case of the variable names on Windows.
- `git-executable.ts` — the choice of the name or of the full path to `git`.
- `lazy.ts` — memoization of a value computed once.
- `iife.ts` — a one-line wrapper for calling a function with no logic around.
- Not one of these files is in a separate package `@opencode/util`: the same-named core folder and the package are different things.

## Key Files

- `packages/core/src/util/error.ts` — `NamedError`, `create`, `createSchemaClass`, `Unknown`.
- `packages/core/src/util/error-summary.ts` — `from`.
- `packages/core/src/util/wildcard.ts` — `match`.
- `packages/core/src/util/slug.ts` — `Slug.create`.
- `packages/core/src/util/which.ts`, `packages/core/src/util/git-executable.ts`, `packages/core/src/util/token.ts`, `packages/core/src/util/lazy.ts`, `packages/core/src/util/iife.ts`.

## Important Details

- `NamedError` requires two methods from the heir: `schema()` returns a schema, `toObject()` — `{ name, data }`. The error data is not stored in a free form: the class is always built around an Effect schema.
- `create(name, data)` takes either a set of fields, or a ready schema, and always wraps them into `Schema.Struct({ name: Schema.Literal(name), data })`. The resulting class has `Schema`, `EffectSchema`, a static `tag`, an overridden name and the predicate `isInstance`.
- `isInstance` and `hasName` work by the string `name`, and not by `instanceof`: an error crossing the process boundary or restored from JSON is still recognized. The price of this decision is that two errors with the same name are indistinguishable.
- The name of the class is set twice: `Object.defineProperty(result, "name", { value: name })` changes the name of the function-class, so that the stack traces are readable, and `public override readonly name = name` — the name of the instance.
- `NamedError.Unknown` — an already ready class with the fields `message` and the optional `ref`.
- `ErrorSummary.from` decodes an error with `Schema.decodeUnknownOption` by a schema where **all** fields are optional. Therefore a foreign error does not break the parsing: if the decoding failed, the walk of the chain stops (`if (Option.isNone(result)) break`).
- The walk is limited in three ways at once: at most 8 records, protection from a cycle through a `Set` of already visited objects and a stop at the first undecodable value.
- The type of a record is taken as `_tag` (tagged errors of Effect), then `error.name`, then `name` from the decoded structure, and only then the string `"unknown"`.
- Stack traces deliberately do not get into the summary — that is a comment in the code. The size of each record is not limited, only their number.
- `Wildcard.match` brings both the input and the pattern to a forward slash, escapes the special characters of the regular expression except for `*` and `?`, and turns them into `.*` and `.`. The flags of the regular expression are `si` on Windows and `s` on the other platforms: without `i` the comparison is case-sensitive on all platforms except Windows.
- A special case in the pattern: the tail `" .*"` turns into `"( .*)?"`. In other words a pattern ending with a space and a star admits both an empty tail and a tail with a space — and not just any suffix.
- The regular expression is assembled anew on each call of `match`, the result is not cached.
- `Token.estimate` divides the length of the string by 4 and rounds, negative values are impossible thanks to `Math.max(0, ...)`. This is an estimation for the interface, and not a counter of the model tokens.
- `Slug.create` joins one adjective out of 29 and one noun out of 35 with a hyphen. The lists are declared `as const`, so the new words are visible to the types; the concrete pseudorandom generator works through `Math.random()` and is not seeded.
- `which` assembles the search path itself: it takes `PATH` or `Path` from the passed environment, otherwise from `process.env`, and adds `bin` through `path.delimiter`, if it is set. `PATHEXT`/`PathExt` are handled the same way. The call of `whichPkg.sync` goes with `nothrow: true`, that is, the absence of the executable gives `null`, and not an exception.
- `gitExecutable` is computed once at the module import. On Windows it is an absolute path (via `which("git")`), on the other platforms — the string `"git"`. The function `resolveGitExecutable` is set apart and is pure: it can be called with an arbitrary platform and an arbitrary `which` result in the tests.
- `lazy` distinguishes "not computed" and "computed as `undefined`" by a separate flag `loaded`. Without it the `undefined` value would be recomputed on each call.
- `iife(fn)` simply calls `fn()`. The meaning is only in readability: a call in an expression where a block is impossible.

## Connections

- `packages/util/src/fs-util.ts` and the package `@opencode/util` — a neighboring utility layer with similar helpers (hash, global paths, effect helpers). The folder `packages/core/src/util` does not intersect it by files.
- `packages/core/src/config/discovery.ts` — uses `FSUtil.contains` when filtering the found configs; a similar by meaning check of nesting is written here and not in `match`.
- `packages/core/src/id/id.ts` — a neighboring folder by purpose: identifier generation, also small and self-contained.
- `packages/core/src/database/schema.sql.ts` — a consumer of `packages/core/src/util/error.ts` there, where the database access errors are built through the `NamedError.create` factory.
- `packages/core/src/v1/config/error.ts` — an example of an error carrying a path and a message in its data (`InvalidError` is used in `packages/core/src/config/variable.ts`).

## Pitfalls

- `NamedError.hasName` and `isInstance` recognize an error by its string name. An error with the same name from another package will be taken for its own — and its data will be of another shape.
- `ErrorSummary.from` stops at the first undecodable link in the chain. If the foreign error has none of the listed fields, the summary will be empty, although the error is nested deeper.
- `ErrorSummary.from` cuts the chain at 8 records. With a deep nesting the failures beyond the eighth will not get into any diagnostic output.
- `Wildcard.match` does not escape `*` and `?` during parsing, they always become operators. You cannot escape them in the pattern: an escaping character does not exist here, and `\` is brought to `/`.
- The `i` flag of `match` is switched on only on Windows. The same pattern will match the resource differently on different platforms — that is conscious, but easy to miss.
- `Token.estimate` overestimates or underestimates for any language with multibyte characters: it counts the length in JS codes, and not in bytes and not in model tokens.
- `gitExecutable` is fixed at the import. A change of `PATH` or `PATHEXT` later in the process will not affect this module.
- `lazy` caches the exception too: if `fn` throws, the value will not be remembered, but the computation will start again on the next call. Only the successful result is cached.