# core/image — compression of pictures before sending them to the model via photon (WASM)

## What's In This Folder

Four files: `packages/core/src/image/photon.ts` — the logic of reducing
images itself, and three variants of importing the photon WASM artifact for different
runtimes (`photon-wasm.bun.ts`, `photon-wasm.node.ts`,
`photon-wasm.workerd.ts`).

The meaning of the subsystem: a picture from an attachment is decoded, and if it is bigger
than the limits, it is reduced and re-encoded — first into PNG, then into JPEG with
decreasing quality — until the result fits the size limit.

## Key Files

- `packages/core/src/image/photon.ts` — `make()` returns the function
  `Image.Photon.normalize(resource, content, limits)`. It takes
  base64 content and `Limits`, and returns either the original `content`, or
  the same object with a new `content`, `mime` and `encoding: "base64"`.
- `packages/core/src/image/photon-wasm.bun.ts` — a static import
  of `photon_rs_bg.wasm` with the attribute `{ type: "file" }`; Bun embeds the file
  when compiling the CLI.
- `packages/core/src/image/photon-wasm.node.ts` — the path to the WASM is taken from
  the environment variable `OPENCODE_PHOTON_WASM_PATH`, otherwise through
  `createRequire(import.meta.url).resolve(...)`.
- `packages/core/src/image/photon-wasm.workerd.ts` — exports an empty
  string: workerd has no path in the filesystem, the resizer is considered
  unavailable by declaration.

## Important Details

- The import `#photon-wasm` is resolved into one of the three files per runtime.
  The value `""` (workerd) is the signal "there is no resizer".
- Loading of photon is wrapped in `Effect.cached`, so the WASM is loaded once
  per process, not per image. A load error turns into
  `ResizerUnavailableError`.
- The order of the reduction attempts: first PNG (`get_bytes()`), then JPEG with
  the qualities from the constant `JPEG_QUALITIES` = 80, 85, 70, 55, 40. The first
  variant whose base64 fits the limit is the answer.
- The size in base64 is counted as `Math.ceil(bytes / 3) * 4` — taking the
  padding into account, not as `bytes * 4 / 3`.
- The reduction goes by geometry, not by quality: the scale
  `Math.min(1, maxWidth / width, maxHeight / height)`; then — up to 32
  steps, each one a factor of 0.75 per side, but not below 1.
  Duplicate sizes are discarded.
- If `limits.autoResize` is off, the first excess over a limit gives
  a `SizeError` with the actual and the limit values (`width`, `height`,
  `bytes`, `maxWidth`, `maxHeight`, `maxBytes`).
- If even the smallest step did not fit, it is also `SizeError`.
- If the image is within the limits, the original object is returned without
  re-encoding — the quality is not touched for nothing.
- An error of decoding the bytes is `DecodeError` with a `resource` field.
- Manual release of the WASM memory: `decoded.free()` and `resized.free()` in
  `finally` blocks, so a failure does not leave a photon object in memory.
- The interpolation filter on resize is `photon.SamplingFilter.Lanczos3`.

## Connections

- `packages/core/src/image.ts` — types and errors: `Limits`, `DecodeError`,
  `ResizerUnavailableError`, `SizeError`. This is a neighboring file in the root `src`,
  not a file from the `image` folder.
- `packages/core/src/filesystem.ts` — the type `FileSystem.Content`, part
  of which (`encoding: "base64"`) is passed as input.
- `#photon-wasm` — an internal import specifier binding the folder with
  the three runtime variants.
- `@silvia-odwyer/photon-node` — the resizer itself; loaded by a dynamic
  `import` only after the path to the artifact has been judged usable.

## Pitfalls

- The path to the WASM is put into `globalThis.__OPENCODE_PHOTON_WASM_PATH` as
  a side effect — that is global mutable state, not an argument.
- `photon-wasm.node.ts` returns the environment variable value as is.
  A non-empty string with a typo will give a load error, and an empty one — the same
  refusal as workerd, but with a different reason text.
- The constant of JPEG qualities is not sorted in descending order (80, 85, 70, 55, 40):
  85 is in second place, that is, the quality grows slightly before falling.
  The order in the code must not be changed — the choice of the result depends on it.
- `photon-wasm.bun.ts` contains `@ts-ignore`: the type of the static WASM file
  import is not inferred, and this check suppression cannot be lifted without
  another import scheme.
- The size limit calculation goes from the size of the re-encoded file, and
  the comparison at the beginning — from the size of the original base64. These are two different
  bases for one and the same limit.
- `Effect.cached` means that the first failed load is not cached as a
  success: at `ResizerUnavailableError` the next call will try again.