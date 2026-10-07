# Universal Tool Hub

The `hub` tool runs a ready-made catalog command. Prefer it over `shell` whenever an entry covers the task, and fall back to `shell` only when nothing in the catalog fits.

## Why the catalog wins

Catalog commands are already written for the fast modern CLIs on this machine — `rg`, `fd`, `jq`, `yq`, `mlr`, `sd`, `lsd` — and the hub picks the best backend available for the entry: `nu` or `pwsh` when the entry ships a template for them, `bash` otherwise. A hand-written `grep -r` or `find -name` is slower and loses the exact flags that make the modern tool worth having.

## Workflow

1. `hub` with `query` (and optionally `category`) to find an entry. The listing gives you the id, its category, and whether it is flagged `DANGER`.
2. `hub` with `id` plus `args` to run it. Argument names come from the entry's `placeholders`; a `?` suffix means optional and renders as empty.
3. Read the result. Every run reports the `backend` that executed it, so you can see when a `nu` or `pwsh` template was used instead of `bash`.
4. When a required tool is missing, `hub` with `install` and the entry `id` tells you the exact package-manager command, and the failure message names the missing binaries.

## Tool selection

Match the tool to the shape of the work, not to habit:

- **Content search** — `rg` over `grep -r`. Add a file-type filter instead of piping through `grep` twice.
- **File discovery** — `fd` over `find`. `fd` respects ignore files by default, which `find` does not.
- **JSON** — `jq` for reading and filtering, `yq` for YAML and TOML, and the catalog's data entries for joined or tabular results rather than an ad-hoc `python -c`.
- **Tabular data** — `mlr` for CSV/TSV column selection, aggregation and reformatting.
- **Text rewriting** — `sd` for a plain find-and-replace across files; keep `edit` for surgical changes to a file you have read.
- **Git, Docker, systemd, processes, network** — the catalog carries entries for each; check there before composing a long pipeline by hand.

## Selecting across many results

Chain catalog commands through a pipe only when each stage is a real transform. Prefer one entry that already does the whole job over three commands glued together: the entry was written with the right flags.

## Fallback

Use `shell` when no entry covers the task, when the catalog entry needs argument shapes your input cannot express, or when a required binary is missing and you are not going to install it. Say so in one line rather than silently writing the slow version.
