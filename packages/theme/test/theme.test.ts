import { expect, test } from "bun:test"
import { migrateV1, parseThemeDocument, resolveThemeDocument } from "../src/tui/index.js"
import type { ThemeV1Json } from "../src/tui/v1.js"

const source: ThemeV1Json = await Bun.file(
  new URL("../../tui/src/theme/assets/opencode.json", import.meta.url),
).json()
const document = migrateV1(source)

test.each(["light", "dark"] as const)("resolves %s themes without status tokens", (mode) => {
  const theme = resolveThemeDocument(document, mode)
  expect("status" in theme.text).toBeFalse()
  expect(theme.hue.accent[800]).toBeDefined()
  expect(theme.hue.interactive[800]).toBeDefined()
})

test.each(["light", "dark"] as const)("built-in %s themes name a color for every execution backend", (mode) => {
  const theme = resolveThemeDocument(document, mode)
  // a badge that names the backend needs all three, and bash is not the same
  // shape as the shells it falls back from
  expect(theme.text.backend?.bash).toBeDefined()
  expect(theme.text.backend?.nu).toBeDefined()
  expect(theme.text.backend?.pwsh).toBeDefined()
  expect(theme.text.backend?.bash).not.toEqual(theme.text.backend?.nu)
  expect(theme.text.backend?.nu).not.toEqual(theme.text.backend?.pwsh)
})

// A theme file written before the role existed simply has no such key, so the
// legacy document is rebuilt without it rather than mutating a parsed one.
const stripBackend = <T extends { text?: { backend?: unknown } }>(tokens: T) => {
  if (!tokens.text) return tokens
  const { backend: _backend, ...text } = tokens.text
  return { ...tokens, text }
}

test("a theme written before the backend role existed still decodes and resolves", () => {
  const legacy = {
    ...document,
    base: stripBackend(document.base),
    ...(document.light ? { light: stripBackend(document.light) } : {}),
    ...(document.dark ? { dark: stripBackend(document.dark) } : {}),
  }

  // the documented failure mode of a required role: this call would throw
  const parsed = parseThemeDocument(legacy)
  for (const mode of ["light", "dark"] as const) {
    const theme = resolveThemeDocument(parsed, mode)
    expect(theme.text.backend).toBeUndefined()
    // what the component falls back to for a theme that omits the role
    expect(theme.text.muted).toBeDefined()
  }
})
