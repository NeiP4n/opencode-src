import { describe, expect, test } from "bun:test"
import { EditTool } from "@opencode/core/tool/plugin/edit"

describe("edit miss hint", () => {
  test("points at the reformatted block with Read-style line numbers", () => {
    const source = [
      "import x",
      "",
      "function sum(a, b) {",
      "  const total =",
      "    a + b",
      "  return total",
      "}",
      "",
    ].join("\n")
    // the model remembers the one-line form; a formatter split it
    const near = EditTool.closestRegion(source, "function sum(a, b) {\n  const total = a + b\n  return total\n}")
    expect(near).toContain("3: function sum(a, b) {")
    expect(near).toContain("6:   return total")
  })

  test("stays quiet when only a trivial line is shared", () => {
    expect(EditTool.closestRegion("a\n}\nb", "missing()\n}")).toBeUndefined()
    expect(EditTool.closestRegion("same\nsame", "missing")).toBeUndefined()
  })
})
