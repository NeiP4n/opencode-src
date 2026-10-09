# core/vcs — diffs and patches: assembling, parsing and splitting the git output by files

## What's In This Folder

One file `patch.ts`: the operations over a unified diff based on the `diff` package.
It knows nothing about git repositories — it only builds the patches for
creating, deleting and changing a file, counts the lines, extracts the file name from the
headers and splits the `git diff` output into chunks by files.

## Key Files

- `packages/core/src/vcs/patch.ts` — the only file of the folder. It exports
  `PATCH_CONTEXT_LINES`, `MAX_PATCH_BYTES`, `MAX_TOTAL_PATCH_BYTES`, the type
  `Patch`, the functions `emptyPatch`, `addPatch`, `deletePatch`, `countPatch`,
  `fileFromPatchChunk`, `splitGitPatch`, `chunksByFile`.

## Important Details

- `PATCH_CONTEXT_LINES` = 2 147 483 647, that is in effect "the whole file":
  the adapters take this value when the context is not requested.
- The limit of the patch size and of the total size coincide and equal 10 000 000 —
  these are the fuses at the assembly of the diff, and not a storage format.
- `emptyPatch`, `addPatch`, `deletePatch` build the diff via
  `formatPatch(structuredPatch(...))` with a zero context: the context lines do not
  get into the result.
- `countPatch` counts the additions and the deletions, skipping the headers `+++` and
  `---`; the header lines of the files would otherwise be counted as changes.
- The file name is looked for first by the lines `+++` and `---`, and if there is nothing there —
  by the header `diff --git`. The value `/dev/null` is considered an absent
  file, and the prefixes `a/` and `b/` are cut off.
- The paths in the git headers are sometimes in quotes. For them there is a separate parsing with
  the escape sequences `\t`, `\n`, `\r`, `\"`, `\\`; without quotes the path is
  cut at the tab.
- `splitGitPatch` cuts the text by the occurrences of `diff --git`. If the patch is marked
  as `truncated`, the last chunk is discarded: it may be incomplete.
- `chunksByFile` glues several chunks of one file into one line, and if
  the name could not be produced — takes it from the passed `fallback` by the index.

## Connections

- `chunksByFile` is a bridge to git: the result of `git diff` without the headers `diff --git`
  is parsed via `fileFromGitChunk` and is grouped by this function.
- `Patch` with the field `truncated` requires that the calling side itself watch the
  size limit: on the cutting of the output the last file is silently lost if you do not
  know about `truncated`.

## Pitfalls

- The diffs are assembled with a zero context, therefore in `countPatch` every line
  `+`/`-` is a real change, but the usual counting of "context lines" is not
  applicable to such a patch.
- `splitGitPatch` at `truncated: true` loses the last file without any
  sign in the text — this is conscious behavior, and not a parsing error.
- The path from the header `diff --git` is parsed by a heuristic: a non-standard format
  (`---`/`+++` without quotes and without ` b/`) will not give a file name, and then the
  `fallback` in `chunksByFile` matters.
- The quotes in the file names with spaces and non-Latin characters are parsed
  by hand; any unknown escape sequence is returned as is.
- The size of the diff hits 10 MB: the larger files require an external limit of the
  size, otherwise the patch will be marked as cut off, and the last file will be lost.