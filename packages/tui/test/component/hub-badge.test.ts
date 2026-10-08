import { expect, test } from "bun:test"
import { hubBadge, hubBadgeColor } from "../../src/routes/session/index"
import { getOpenCodeTheme, parseTheme } from "../../src/theme"
import { resolveThemeDocument } from "@opencode/theme/tui"

const theme = resolveThemeDocument(getOpenCodeTheme(), "dark")

test("badge names the entry and the backend that ran it", () => {
  expect(hubBadge("search.content", "nu")).toBe("HUB:search.content · nu")
  expect(hubBadge("search.content")).toBe("HUB:search.content")
  expect(hubBadge(undefined, "nu")).toBe("HUB:nu")
  expect(hubBadge()).toBeUndefined()
})

test("backend badge takes the backend color instead of the muted default", () => {
  const seen = new Set<string>()
  for (const backend of ["bash", "nu", "pwsh"] as const) {
    const color = hubBadgeColor(theme, backend)
    expect(color).toEqual(theme.text.backend![backend])
    // the badge must actually be colored, including for bash, which is the
    // backend almost every run reports
    expect(color).not.toEqual(theme.text.muted)
    seen.add(color.buffer.join(","))
  }
  // the three are distinguishable, which is the point of the role
  expect(seen.size).toBe(3)
})

test("an unknown or absent backend stays on the fallback", () => {
  expect(hubBadgeColor(theme, undefined)).toEqual(theme.text.muted)
  expect(hubBadgeColor(theme, "wine")).toEqual(theme.text.muted)
})

test("a theme without the backend role falls back to muted for every backend", () => {
  // The role lives on the base tokens, so the role is dropped there — the same
  // shape as a theme file written before the role existed.
  const document = getOpenCodeTheme()
  const { backend: _backend, ...text } = document.base.text
  const legacy = parseTheme(
    { ...document, base: { ...document.base, text } },
    "no-backend",
  )
  const theme = resolveThemeDocument(legacy, "dark")
  expect(theme.text.backend).toBeUndefined()
  for (const backend of ["bash", "nu", "pwsh"] as const) {
    expect(hubBadgeColor(theme, backend)).toEqual(theme.text.muted)
  }
  // the badge itself is unchanged: it still names the backend that ran
  expect(hubBadge(undefined, "nu")).toBe("HUB:nu")
})
