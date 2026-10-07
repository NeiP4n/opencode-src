import { TextAttributes } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { type ParentProps } from "solid-js"
import { useTheme } from "../context/theme"

// Shared chrome of the devtools popovers: the floating box, its title and the
// label/value line. Lives outside devtools-bar so panels split into their own
// modules can render it without importing the bar back (a cycle).
export function PanelBox(props: ParentProps) {
  const theme = useTheme()
  const renderer = useRenderer()
  return (
    <box
      position="absolute"
      zIndex={2600}
      bottom={1}
      left={-1}
      width={42}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={theme.background.raised.base}
      flexDirection="column"
      onMouseUp={(event) => {
        if (renderer.getSelection()?.getSelectedText()) return
        event.stopPropagation()
      }}
    >
      {props.children}
    </box>
  )
}

export function PanelTitle(props: ParentProps) {
  const theme = useTheme()
  return (
    <text fg={theme.text.base} attributes={TextAttributes.BOLD} marginBottom={1}>
      {props.children}
    </text>
  )
}

export function Row(props: { label: string; value: string }) {
  const theme = useTheme()
  return (
    <box flexDirection="row">
      <text fg={theme.text.muted}>{props.label}</text>
      <box flexGrow={1} />
      <text fg={theme.text.base}>{props.value}</text>
    </box>
  )
}
