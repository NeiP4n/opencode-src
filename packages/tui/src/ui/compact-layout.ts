import { useTerminalDimensions } from "@opentui/solid"
import { useOptionalConfig } from "../config"
import { compactLayout, SESSION_SIDEBAR_COMPACT_WIDTH, SESSION_SIDEBAR_WIDTH } from "./layout"

// Whether the panels use the compact layout right now, and the session sidebar width that goes with it.
export function useCompactLayout() {
  const config = useOptionalConfig()
  const dimensions = useTerminalDimensions()
  const compact = () => compactLayout(config?.data.layout, dimensions().width)
  return {
    compact,
    sidebarWidth: () => (compact() ? SESSION_SIDEBAR_COMPACT_WIDTH : SESSION_SIDEBAR_WIDTH),
  }
}
