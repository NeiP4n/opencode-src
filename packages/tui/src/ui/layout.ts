export const SESSION_SIDEBAR_WIDTH = 42
export const SESSION_TABS_COMPACT_WIDTH = 5
export const SESSION_TABS_COMPACT_BREAKPOINT = 12
export const SESSION_SIDEBAR_MAX_WIDTH = 72
const SESSION_CONTENT_MIN_WIDTH = 44
const SESSION_CONTENT_PREFERRED_WIDTH = 64

export function sessionTabsFitVertically(total: number, width = SESSION_SIDEBAR_WIDTH) {
  return total >= width + SESSION_CONTENT_PREFERRED_WIDTH
}

export function clampSessionTabsWidth(width: number, total: number) {
  return Math.max(
    SESSION_TABS_COMPACT_WIDTH,
    Math.min(width, SESSION_SIDEBAR_MAX_WIDTH, total - SESSION_CONTENT_MIN_WIDTH),
  )
}

export function clampSessionPaneWidth(width: number, total: number) {
  const half = Math.max(1, Math.floor(total / 2))
  // Preserve the equal split when there is not enough room for both pane minima.
  return Math.max(Math.min(24, half), Math.min(width, Math.max(half, total - SESSION_CONTENT_MIN_WIDTH)))
}

// Compact layout keeps both side panels open on a laptop-sized terminal: the
// project panel gets its own narrower width and the session sidebar docks beside
// the chat as long as the chat keeps its preferred width.
// Below the automatic range a side panel leaves too little room for the chat, so the
// project panel hides as in the full layout.
export const SESSION_TABS_COMPACT_LAYOUT_WIDTH = 34
export const SESSION_SIDEBAR_COMPACT_WIDTH = 32
const COMPACT_LAYOUT_AUTO_FROM = 110
const COMPACT_LAYOUT_AUTO_BELOW = 170

export function compactLayout(mode: "auto" | "compact" | "full" | undefined, total: number) {
  if (mode === "compact") return true
  if (mode === "full") return false
  return total >= COMPACT_LAYOUT_AUTO_FROM && total < COMPACT_LAYOUT_AUTO_BELOW
}

export function sessionSidebarDocks(available: number, compact: boolean) {
  if (compact) return available >= SESSION_SIDEBAR_COMPACT_WIDTH + SESSION_CONTENT_PREFERRED_WIDTH
  return available > 120
}

// A terminal or plugin panel opens at half the room in the full layout and at
// two fifths in the compact one, so the chat beside it stays readable.
export function defaultSessionPaneWidth(total: number, compact: boolean) {
  return Math.max(1, Math.floor(compact ? (total * 2) / 5 : total / 2))
}
