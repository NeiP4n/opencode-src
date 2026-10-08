import { TextAttributes, type InputRenderable } from "@opentui/core"
import { createResource, createSignal, For, Show, type JSX } from "solid-js"
import type { RoomInfo, RoomJoinCode } from "@opencode/client/promise"
import { hostname } from "node:os"
import { useConfig } from "../config"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useRoute } from "../context/route"
import { useStorage } from "../context/storage"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { Button } from "./devtools-registry"
import { DialogRoomChat, roomClient, type JoinedRoom } from "./dialog-room-chat"
import { scanRooms, type FoundRoom } from "@opencode/client/room-discovery"

// Host: the rooms this computer shares. A room is one session other devices
// join with a short code; only this computer's AI answers in it.
export function DialogHost(props: { onClose?: () => void }) {
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
  // Guests need an address they can reach. Loopback only works on this machine, and
  // container bridges (172.16/12) and TUN adapters (198.18/15) are not the network
  // other devices are on.
  const addresses = () =>
    (server()?.urls ?? [])
      .map((url) => new URL(url).host)
      .filter((host) => !/^(localhost|127\.|\[::1\]|172\.(1[6-9]|2\d|3[01])\.|198\.1[89]\.)/.test(host))

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
      <Header title="Host" onClose={props.onClose} />
      <Show
        when={addresses().length > 0}
        fallback={
          <text fg={theme.text.feedback.warning.base} wrapMode="word">
            This server only listens on this machine, so other devices cannot connect yet. Run `opencode service set
            hostname 0.0.0.0` and restart the service.
          </text>
        }
      >
        <Labeled label="Address">
          <box>
            <For each={addresses()}>
              {(address) => (
                <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                  {address}
                </text>
              )}
            </For>
          </box>
        </Labeled>
      </Show>
      <Show when={sessionID()} fallback={<text fg={theme.text.muted}>Open a session to host it as a room.</text>}>
        <Show when={!shared()}>
          <box flexDirection="row">
            <Button variant="primary" disabled={busy()} onClick={share}>
              Host this session
            </Button>
          </box>
        </Show>
      </Show>
      <For each={rooms() ?? []}>
        {(room) => (
          <box>
            <Labeled label="Room">
              <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                {room.name}
              </text>
            </Labeled>
            <Labeled label="AI messages">
              <Button
                disabled={busy()}
                onClick={() =>
                  void run(() =>
                    client.api.room.update({ roomID: room.id, ai: room.ai === "linked" ? "discovered" : "linked" }),
                  )
                }
              >
                {room.ai === "linked" ? "linked rooms only" : "any room, asking first"}
              </Button>
            </Labeled>
            <Labeled label="Approvals">
              <Button
                disabled={busy()}
                onClick={() =>
                  void run(() => client.api.room.update({ roomID: room.id, guestApprovals: !room.guestApprovals }))
                }
              >
                {room.guestApprovals ? "me and guests" : "me only"}
              </Button>
            </Labeled>
            <Show when={codes()[room.id]}>
              {(issued) => (
                <Labeled label="Join code">
                  <text fg={theme.text.base}>
                    <span style={{ bold: true }}>{issued().code}</span>
                    <span style={{ fg: theme.text.muted }}>
                      {`  valid until ${new Date(issued().until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                    </span>
                  </text>
                </Labeled>
              )}
            </Show>
            <box flexDirection="row" gap={1} paddingTop={1}>
              <Button variant="primary" disabled={busy()} onClick={() => code(room)}>
                {codes()[room.id] ? "New join code" : "Get join code"}
              </Button>
              <Button disabled={busy()} onLeave={() => setArmed()} onClick={() => close(room)}>
                {armed() === room.id ? "Click again to stop hosting" : "Stop hosting"}
              </Button>
            </box>
            <Show when={codes()[room.id]}>
              <text fg={theme.text.muted} wrapMode="word">
                On the other device open Connect, pick this room or enter the address, then the join code.
              </text>
            </Show>
          </box>
        )}
      </For>
      <Show when={rooms.error}>
        <text fg={theme.text.feedback.error.base}>{errorMessage(rooms.error)}</text>
      </Show>
    </box>
  )
}

// Connect: rooms other computers host. The local network is scanned when the
// window opens; any room can also be reached by address and join code.
export function DialogConnect(props: { onClose?: () => void }) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const config = useConfig().data
  const [saved, updateSaved] = useStorage().store<{ joined: JoinedRoom[] }>("rooms", { initial: { joined: [] } })
  const [found, { refetch: rescan }] = createResource(() => scanRooms())
  const [armed, setArmed] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [joinError, setJoinError] = createSignal<string>()
  const fields: { address?: InputRenderable; code?: InputRenderable; name?: InputRenderable } = {}

  const join = () => {
    const address = fields.address?.value.trim() ?? ""
    const joinCode = fields.code?.value.trim() ?? ""
    const name = fields.name?.value.trim() || hostname()
    if (!address || !joinCode) return setJoinError("Enter the host's address and the code it shows")
    const url = /^https?:\/\//.test(address) ? address : `http://${address}`
    setBusy(true)
    setJoinError()
    void roomClient({ url, token: "" })
      .room.join({ code: joinCode, name })
      .then((joined) =>
        updateSaved((draft) => {
          draft.joined = [
            ...draft.joined.filter((item) => !(item.url === url && item.roomID === joined.room.id)),
            { url, roomID: joined.room.id, name: joined.room.name, token: joined.token, guest: joined.guest.name },
          ]
        }).then(() => {
          if (fields.code) fields.code.value = ""
        }),
      )
      .catch((error: unknown) => setJoinError(errorMessage(error)))
      .finally(() => setBusy(false))
  }

  // A found room only lacks the code: fill its address and move to the code field.
  const pick = (room: FoundRoom) => {
    if (fields.address) fields.address.value = new URL(room.url).host
    setJoinError()
    fields.code?.focus()
  }

  const open = (room: JoinedRoom) => {
    dialog.replace(() => <DialogRoomChat room={room} onClose={() => dialog.clear()} />, undefined, { size: "xlarge" })
    dialog.setCentered(true)
  }

  const leave = (room: JoinedRoom) => {
    const key = `${room.url}#${room.roomID}`
    if (armed() !== key) return setArmed(key)
    setArmed()
    void updateSaved((draft) => {
      draft.joined = draft.joined.filter((item) => !(item.url === room.url && item.roomID === room.roomID))
    })
  }

  const field = (key: "address" | "code" | "name", label: string, placeholder: string) => (
    <Labeled label={label}>
      <input
        width={30}
        cursorStyle={config.cursor}
        ref={(element: InputRenderable) => {
          fields[key] = element
        }}
        onSubmit={join}
        placeholder={placeholder}
        placeholderColor={theme.text.muted}
        textColor={theme.text.formfield.base}
        focusedTextColor={theme.text.formfield.focused}
        cursorColor={theme.text.formfield.focused}
        backgroundColor={theme.background.formfield.base}
        focusedBackgroundColor={theme.background.formfield.focused}
      />
    </Labeled>
  )

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <Header title="Connect" onClose={props.onClose} />

      <Section title="Rooms on this network" />
      <box flexDirection="row" gap={1}>
        <text fg={theme.text.muted}>
          {found.loading ? "Searching…" : found()?.length ? `${found()!.length} found` : "No rooms found"}
        </text>
        <Button disabled={found.loading} onClick={() => void rescan()}>
          Search again
        </Button>
      </box>
      <For each={found() ?? []}>
        {(room) => (
          <box flexDirection="row" gap={1}>
            <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
              {room.name}
            </text>
            <text fg={theme.text.muted}>{`${room.host} · ${new URL(room.url).host}`}</text>
            <box flexGrow={1} />
            <Button variant="primary" onClick={() => pick(room)}>
              Select
            </Button>
          </box>
        )}
      </For>

      <Section title="Join with address and code" />
      {field("address", "Address", "e.g. 192.168.1.5:49375")}
      {field("code", "Join code", "e.g. ABCD-EFGH")}
      {field("name", "Your name", `${hostname()} (default)`)}
      <Show when={joinError()}>
        {(message) => (
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            {message()}
          </text>
        )}
      </Show>
      <box flexDirection="row">
        <Button variant="primary" disabled={busy()} onClick={join}>
          Join
        </Button>
      </box>

      <Show when={saved.joined.length > 0}>
        <Section title="Joined rooms" />
      </Show>
      <For each={saved.joined}>
        {(room) => (
          <box flexDirection="row" gap={1}>
            <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
              {room.name}
            </text>
            <text fg={theme.text.muted}>{`${new URL(room.url).host} · as ${room.guest}`}</text>
            <box flexGrow={1} />
            <Button variant="primary" onClick={() => open(room)}>
              Open chat
            </Button>
            <Button onLeave={() => setArmed()} onClick={() => leave(room)}>
              {armed() === `${room.url}#${room.roomID}` ? "Click again to leave" : "Leave"}
            </Button>
          </box>
        )}
      </For>
    </box>
  )
}

function Header(props: { title: string; onClose?: () => void }) {
  const theme = useTheme().surface("dialog")
  return (
    <box flexDirection="row" justifyContent="space-between">
      <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
        {props.title}
      </text>
      <text fg={theme.text.muted} onMouseUp={() => props.onClose?.()}>
        esc
      </text>
    </box>
  )
}

const LABEL_WIDTH = 14

function Labeled(props: { label: string; children: JSX.Element }) {
  const theme = useTheme().surface("dialog")
  return (
    <box flexDirection="row">
      <box width={LABEL_WIDTH} flexShrink={0}>
        <text fg={theme.text.muted}>{props.label}</text>
      </box>
      {props.children}
    </box>
  )
}

function Section(props: { title: string }) {
  const theme = useTheme().surface("dialog")
  return (
    <text fg={theme.text.base} attributes={TextAttributes.UNDERLINE}>
      {props.title}
    </text>
  )
}
