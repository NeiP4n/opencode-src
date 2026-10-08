import { createMemo, createResource, createSignal, Show } from "solid-js"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { roomGuests, roomListRevision } from "../util/room"
import { DialogHost } from "./dialog-rooms"

// Shown while this session is hosted as a room; opens the Host window.
export function RoomIndicator(props: { sessionID: string }) {
  const client = useClient()
  const data = useData()
  const dialog = useDialog()
  const [rooms] = createResource(
    () => ({ sessionID: props.sessionID, revision: roomListRevision() }),
    () => client.api.room.list().catch(() => []),
  )
  const room = createMemo(() => rooms.latest?.find((room) => room.sessionID === props.sessionID))

  return (
    <Show when={room()}>
      {(room) => (
        <MultiplayerBadge
          room={room().name}
          guests={roomGuests(data.session.message.list(props.sessionID), room().id)}
          onClick={() => {
            dialog.replace(() => <DialogHost onClose={() => dialog.clear()} />, undefined, { size: "large" })
            dialog.setCentered(true)
          }}
        />
      )}
    </Show>
  )
}

export function MultiplayerBadge(props: { room: string; guests: number; onClick: () => void }) {
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      id="session-room-indicator"
      flexShrink={1}
      minWidth={0}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={props.onClick}
    >
      <text
        fg={hovered() ? theme.text.action.secondary.hovered : theme.text.action.secondary.base}
        wrapMode="none"
        truncate
      >
        {`⇄ Multiplayer · ${props.room} · ${props.guests === 0 ? "no guests yet" : `${props.guests} guest${props.guests === 1 ? "" : "s"}`}`}
      </text>
    </box>
  )
}
