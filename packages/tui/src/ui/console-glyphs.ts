import { RGBA, type OptimizedBuffer } from "@opentui/core"

// The classic Windows console (conhost, behind cmd and PowerShell) draws every cell
// from one font, Consolas or Lucida Console, and shows a boxed "?" for any character
// that font lacks; it never falls back to another font the way Windows Terminal does.
// Those fonts cover the WGL4 set, so after each frame is laid out, symbols outside it
// are swapped for the nearest WGL4 or ASCII character. Only the drawn cells change;
// text, input and copied content keep the original characters.

// Set OPENCODE_BASIC_SYMBOLS=1 to force the swap in another terminal, or 0 to turn it off.
export function basicSymbolsNeeded(env: NodeJS.ProcessEnv = process.env, platform = process.platform) {
  if (env.OPENCODE_BASIC_SYMBOLS === "1") return true
  if (env.OPENCODE_BASIC_SYMBOLS === "0") return false
  // Windows Terminal, VS Code, WezTerm and other modern hosts announce themselves; conhost sets none of these.
  return platform === "win32" && !env.WT_SESSION && !env.TERM_PROGRAM && !env.TERM && !env.ConEmuPID
}

export function replaceMissingGlyphs(buffer: OptimizedBuffer) {
  const raw = buffer.buffers
  // Every character beyond ASCII sits in the cell as a grapheme pool reference, so the
  // characters come from the buffer's text: one grapheme per cell, wide characters'
  // continuation cells left out.
  if (!raw.char.some((cell) => cell >>> 30 === GRAPHEME)) return
  const graphemes = Array.from(
    segmenter.segment(decoder.decode(buffer.getRealCharBytes(false))),
    (item) => item.segment,
  )
  const cells = Array.from(raw.char.keys()).filter((index) => raw.char[index] >>> 30 !== CONTINUATION)
  // A mismatch means the text and cells disagree; leave the frame as drawn rather than misplace characters.
  if (graphemes.length !== cells.length) return
  cells.forEach((index, position) => {
    const cell = raw.char[index]
    // Wide characters keep their continuation cell, which a one-cell stand-in would orphan.
    if (cell >>> 30 !== GRAPHEME || raw.char[index + 1] >>> 30 === CONTINUATION) return
    const point = graphemes[position].codePointAt(0)!
    if (graphemes[position].length > 2 || point < FIRST || point > LAST) return
    const replacement = glyph(point)
    if (replacement === undefined) return
    const color = index * 4
    buffer.drawChar(
      replacement,
      index % buffer.width,
      Math.floor(index / buffer.width),
      RGBA.fromInts(raw.fg[color], raw.fg[color + 1], raw.fg[color + 2], raw.fg[color + 3]),
      RGBA.fromInts(raw.bg[color], raw.bg[color + 1], raw.bg[color + 2], raw.bg[color + 3]),
      raw.attributes[index],
    )
  })
}

const GRAPHEME = 2
const CONTINUATION = 3
const segmenter = new Intl.Segmenter()
const decoder = new TextDecoder()

// Everything below this is Latin, Cyrillic, Greek and punctuation the console fonts carry.
const FIRST = 0x2010
const LAST = 0x1faff

function glyph(point: number) {
  if (WGL4.has(point)) return
  const mapped = MAP.get(point)
  if (mapped !== undefined) return mapped
  if (point >= 0x2800 && point <= 0x28ff) return SPIN[point % SPIN.length]
  if (point >= 0x2581 && point <= 0x2587) return code("▄")
  if (point >= 0x2589 && point <= 0x258f) return code("▌")
  if (point >= 0x2596 && point <= 0x259f) return code("█")
  if (point >= 0x2500 && point <= 0x257f) return code("+")
  return code("*")
}

const code = (char: string) => char.codePointAt(0)!

const SPIN = ["|", "/", "-", "\\"].map(code)

// WGL4 above U+2010: the characters Consolas and Lucida Console are guaranteed to draw.
const WGL4 = new Set(
  [
    "‒–—―‗‘’‚‛“”„†‡•…‰′″‹›‼‾⁄ⁿ₣₤₧€℅ℓ№™Ω℮⅛⅜⅝⅞",
    "←↑→↓↔↕↨∂∆∏∑−∕∙√∞∟∩∫≈≠≡≤≥⌂⌐⌠⌡",
    "─│┌┐└┘├┤┬┴┼═║╒╓╔╕╖╗╘╙╚╛╜╝╞╟╠╡╢╣╤╥╦╧╨╩╪╫╬",
    "▀▄█▌▐░▒▓■□▪▫▬▲►▼◄◊○●◘◙◦☺☻☼♀♂♠♣♥♦♪♫",
  ]
    .flatMap((group) => [...group])
    .map(code),
)

// Nearest drawable stand-in for the symbols the interface uses.
const MAP = new Map(
  (
    [
      ["⇄⇆⇋⇌⟷", "↔"],
      ["⇤⇠⟵↤", "←"],
      ["⇥⇢⟶↦", "→"],
      ["↳↪", "└"],
      ["⟳↻↺", "o"],
      ["✓✔🗸", "√"],
      ["✗✘✕✖⨯", "x"],
      ["✱✲✳★☆✦✧⚙❋", "*"],
      ["✎✏", "≡"],
      ["⚠", "!"],
      ["⌕", "/"],
      ["⋯⋮", "…"],
      ["⋅⬝⬞⬪⬩", "·"],
      ["◈◆◇⬥⬦⬖⬗", "◊"],
      ["◉⦿⊙⊚◍", "●"],
      ["▸▶⯈", "►"],
      ["◂◀⯇", "◄"],
      ["▾⯆", "▼"],
      ["▴△▵⯅", "▲"],
      ["◴◜", "|"],
      ["◵◝", "/"],
      ["◶◞", "-"],
      ["◷◟", "\\"],
      ["┃╏╿╽╹╻╵╷", "│"],
      ["━╍╌╴╶╸╺╼╾", "─"],
      ["┏┎┍╭", "┌"],
      ["┓┒┑╮", "┐"],
      ["┗┖┕╰", "└"],
      ["┛┚┙╯", "┘"],
      ["┣┠┝", "├"],
      ["┫┨┥", "┤"],
      ["┳┯┰", "┬"],
      ["┻┷┸", "┴"],
      ["╋┿╂", "┼"],
      ["▔", "▀"],
      ["▕", "▐"],
    ] as const
  ).flatMap(([from, to]) => [...from].map((char) => [code(char), code(to)] as const)),
)
