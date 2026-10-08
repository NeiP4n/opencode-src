import { TextAttributes } from "@opentui/core"
import { createResource, createSignal, For, Show } from "solid-js"
import type { RoomInfo, RoomJoinCode } from "@opencode/client/promise"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useRoute } from "../context/route"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { Button } from "./devtools-registry"

// Rooms this host shares with other devices. A room is one session that guests
// on the network join with a short code; only this host's model answers in it.
export function DialogRooms(props: { onClose?: () => void }) {
  const client = useClient()
  const data = useData()
  const route = useRoute()
  const theme = useTheme().surface("dialog")
  const toast = useToast()
  const [rooms, { refetch }] = createResource(() => client.api.room.list())
  const [server] = createResource(() => client.api.server.info())
  const [codes, setCodes] = createSignal<Readonly<Record<string, RoomJoinCode & { until: number }>>>({})
  const [armed, setArmed] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)

  const sessionID = () => (route.data.type === "session" ? route.data.sessionID : undefined)
  const shared = () => rooms()?.some((room) => room.sessionID === sessionID()) ?? false
  // Guests need an address they can reach; loopback ones only work on this machine.
  const addresses = () =>
    (server()?.urls ?? []).map((url) => new URL(url).host).filter((host) => !/^(localhost|127\.|\[::1\])/.test(host))

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setArmed()
    await action()
      .then(() => refetch())
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))
    setBusy(false)
  }

  const share = () => {
    const id = sessionID()
    if (!id) return
    void run(() => client.api.room.create({ sessionID: id, name: data.session.get(id)?.title || undefined }))
  }

  const code = (room: RoomInfo) =>
    void run(async () => {
      const issued = await client.api.room.code({ roomID: room.id })
      setCodes((previous) => ({ ...previous, [room.id]: { ...issued, until: Date.now() + issued.expires_in * 1000 } }))
    })

  const close = (room: RoomInfo) => {
    if (armed() !== room.id) return setArmed(room.id)
    void run(() => client.api.room.remove({ roomID: room.id }))
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          Rooms
        </text>
        <text fg={theme.text.muted} onMouseUp={() => props.onClose?.()}>
          esc
        </text>
      </box>

      <Show
        when={addresses().length > 0}
        fallback={
          <text fg={theme.text.feedback.warning.base} wrapMode="word">
            This server only listens on this machine, so other devices cannot join yet. Run `opencode service set
            hostname 0.0.0.0` and restart the service.
          </text>
        }
      >
        <box flexDirection="row" gap={1}>
          <text fg={theme.text.muted}>Join at</text>
          <text fg={theme.text.base}>{addresses().join("  ")}</text>
        </box>
      </Show>

      <box flexDirection="row" gap={1}>
        <Button disabled={busy() || !sessionID() || shared()} onClick={share}>
          {shared() ? "This session is shared" : "Share this session"}
        </Button>
        <Show when={!sessionID()}>
          <text fg={theme.text.muted}>Open a session to share it.</text>
        </Show>
      </box>

      <box>
        <For each={rooms() ?? []}>
          {(room) => (
            <box paddingBottom={1}>
              <box flexDirection="row" gap={1}>
                <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                  {room.name}
                </text>
                <text fg={theme.text.muted}>{data.session.get(room.sessionID)?.title ?? room.sessionID}</text>
                <box flexGrow={1} />
                <Button disabled={busy()} onClick={() => code(room)}>
                  Join code
                </Button>
                <Button disabled={busy()} onLeave={() => setArmed()} onClick={() => close(room)}>
                  {armed() === room.id ? "Close?" : "Close"}
                </Button>
              </box>
              <box flexDirection="row" gap={1}>
                <Button
                  disabled={busy()}
                  onClick={() =>
                    void run(() =>
                      client.api.room.update({ roomID: room.id, ai: room.ai === "linked" ? "discovered" : "linked" }),
                    )
                  }
                >
                  {room.ai === "linked" ? "AI writes to linked rooms" : "AI writes to any room, asking first"}
                </Button>
                <Button
                  disabled={busy()}
                  onClick={() =>
                    void run(() => client.api.room.update({ roomID: room.id, guestApprovals: !room.guestApprovals }))
                  }
                >
                  {room.guestApprovals ? "Guests may approve actions" : "Only I approve actions"}
                </Button>
              </box>
              <Show when={codes()[room.id]}>
                {(issued) => (
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.text.muted}>Code</text>
                    <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                      {issued().code}
                    </text>
                    <text fg={theme.text.muted}>
                      {`valid until ${new Date(issued().until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                    </text>
                  </box>
                )}
              </Show>
            </box>
          )}
        </For>
        <Show when={rooms() && rooms()!.length === 0}>
          <text fg={theme.text.muted}>No rooms yet. Share a session so other devices can join it.</text>
        </Show>
        <Show when={rooms.error}>
          <text fg={theme.text.feedback.error.base}>{errorMessage(rooms.error)}</text>
        </Show>
      </box>
    </box>
  )
}
