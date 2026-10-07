export * as HubVisibility from "./visibility.js"

import type { Entry } from "./types.js"
import type { State } from "./state.js"

// One switch, two audiences, and the difference between them is deliberate.
//
// The hint block is opt-in: a tool reaches the system prompt only when the
// operator switched it on, which keeps a fresh install's prompt byte-identical
// to what it was before the hub existed.
//
// Discovery is opt-out: an entry stays listed by the `hub` tool until the
// operator switches a tool off, so the catalog is still explorable on a machine
// where nobody has touched the panel yet. Switching a tool off is the only
// thing that withdraws it from the listing.

export function hinted(state: State, tool: string): boolean {
  return state.enabled[tool] === true
}

export function discoverable(state: State, entry: Entry): boolean {
  return (entry.requires ?? []).every((tool) => state.enabled[tool] !== false)
}
