import { expect, test } from "bun:test"
import { OptimizedBuffer, RGBA } from "@opentui/core"
import { basicSymbolsNeeded, replaceMissingGlyphs } from "../../src/ui/console-glyphs"

test("symbols the classic Windows console cannot draw become drawable stand-ins", () => {
  const buffer = OptimizedBuffer.create(30, 1, "unicode")
  try {
    buffer.drawText("⇄ ✓ ┃ ▸ ⋯ ✎ Комната → ● ─", 0, 0, RGBA.fromInts(255, 255, 255), RGBA.fromInts(0, 0, 0))
    replaceMissingGlyphs(buffer)
    expect(new TextDecoder().decode(buffer.getRealCharBytes(false)).trimEnd()).toBe("↔ √ │ ► … ≡ Комната → ● ─")
  } finally {
    buffer.destroy()
  }
})

test("only the classic Windows console gets basic symbols unless forced", () => {
  expect(basicSymbolsNeeded({}, "win32")).toBe(true)
  expect(basicSymbolsNeeded({ WT_SESSION: "1" }, "win32")).toBe(false)
  expect(basicSymbolsNeeded({ TERM_PROGRAM: "vscode" }, "win32")).toBe(false)
  expect(basicSymbolsNeeded({}, "linux")).toBe(false)
  expect(basicSymbolsNeeded({ OPENCODE_BASIC_SYMBOLS: "1" }, "linux")).toBe(true)
  expect(basicSymbolsNeeded({ OPENCODE_BASIC_SYMBOLS: "0" }, "win32")).toBe(false)
})
