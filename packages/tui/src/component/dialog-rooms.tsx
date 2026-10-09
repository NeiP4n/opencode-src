import { TextAttributes, type InputRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createResource, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import type { RoomInfo, RoomJoinCode } from "@opencode/client/promise"
import { hostname } from "node:os"
import { useConfig } from "../config"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useRoute } from "../context/route"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { useT } from "../util/i18n"
import { roomListChanged, sameRoom, useJoinedRooms, type JoinedRoom } from "../util/room"
import { Button } from "./devtools-registry"
import { roomClient } from "./room-chat"
import { DISCOVERY_PORTS, listRooms, scanRooms, type FoundRoom } from "@opencode/client/room-discovery"

// Host: the rooms this computer shares. A room is one session other devices
// join with a short code; only this computer's AI answers in it.
export function DialogHost(props: { onClose?: () => void }) {
  const client = useClient()
  const data = useData()
  const route = useRoute()
  const theme = useTheme().surface("dialog")
  const toast = useToast()
  const t = useT()
  const [rooms, { refetch }] = createResource(() => client.api.room.list())
  const [server] = createResource(() => client.api.server.info())
  const [codes, setCodes] = createSignal<Readonly<Record<string, RoomJoinCode & { until: number }>>>({})
  const [armed, setArmed] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  // Drives the join code countdown while the window is open.
  const [now, setNow] = createSignal(Date.now())
  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })

  const sessionID = () => (route.data.type === "session" ? route.data.sessionID : undefined)
  const shared = () => rooms()?.some((room) => room.sessionID === sessionID()) ?? false
  // Guests need an address they can reach. Loopback only works on this machine, and
  // container bridges (172.16/12) and TUN adapters (198.18/15) are not the network
  // other devices are on.
  const addresses = () =>
    (server()?.urls ?? [])
      .map((url) => new URL(url).host)
      .filter((host) => !/^(localhost|127\.|169\.254\.|\[::1\]|172\.(1[6-9]|2\d|3[01])\.|198\.1[89]\.)/.test(host))

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setArmed()
    await action()
      .then(() => refetch())
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))
    roomListChanged()
    setBusy(false)
  }

  const issue = async (roomID: string) => {
    const issued = await client.api.room.code({ roomID })
    setNow(Date.now())
    setCodes((previous) => ({ ...previous, [roomID]: { ...issued, until: Date.now() + issued.expires_in * 1000 } }))
  }

  // A new room is useless without a code, so hosting hands one out right away.
  const share = () => {
    const id = sessionID()
    if (!id) return
    void run(async () => {
      const room = await client.api.room.create({ sessionID: id, name: data.session.get(id)?.title || undefined })
      await issue(room.id)
    })
  }

  const close = (room: RoomInfo) => {
    if (armed() !== room.id) return setArmed(room.id)
    void run(() => client.api.room.remove({ roomID: room.id }))
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <Header title={t("Host")} onClose={props.onClose} />
      <Show
        when={addresses().length > 0}
        fallback={
          <text fg={theme.text.feedback.warning.base} wrapMode="word">
            {t(
              "This server only listens on this machine, so other devices cannot connect yet. Run `opencode service set hostname 0.0.0.0` and restart the service.",
            )}
          </text>
        }
      >
        <Labeled label={t("Address")}>
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
        <FirewallHelp ports={[...new Set(addresses().map((address) => Number(address.split(":").at(-1))))]} />
      </Show>
      <Show
        when={sessionID()}
        fallback={<text fg={theme.text.muted}>{t("Open a session to host it as a room.")}</text>}
      >
        <Show when={!shared()}>
          <box flexDirection="row">
            <Button variant="primary" disabled={busy()} onClick={share}>
              {t("Host this session")}
            </Button>
          </box>
        </Show>
      </Show>
      <For each={rooms() ?? []}>
        {(room) => (
          <box>
            <Labeled label={t("Room")}>
              <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                {room.name}
              </text>
            </Labeled>
            <Show
              when={!room.open && codes()[room.id]}
              fallback={
                <Labeled label={t("Join code")}>
                  <text fg={theme.text.muted}>{room.open ? t("not needed") : t("none yet")}</text>
                </Labeled>
              }
            >
              {(issued) => (
                <Labeled label={t("Join code")}>
                  <text fg={theme.text.base}>
                    <span style={{ bold: true }}>{issued().code}</span>
                    <Show
                      when={issued().until > now()}
                      fallback={<span style={{ fg: theme.text.feedback.warning.base }}>{"  " + t("expired")}</span>}
                    >
                      <span style={{ fg: theme.text.muted }}>
                        {"  " + t("expires in {time}", { time: countdown(issued().until - now()) })}
                      </span>
                    </Show>
                  </text>
                </Labeled>
              )}
            </Show>
            <Setting
              label={t("Entry")}
              help={t("Whether guests need the join code or may join straight from the room list.")}
            >
              <Button
                disabled={busy()}
                onClick={() => void run(() => client.api.room.update({ roomID: room.id, open: !room.open }))}
              >
                {room.open ? t("Without a code") : t("With a code")}
              </Button>
            </Setting>
            <Setting
              label={t("Approvals")}
              help={t("Who may allow or deny the AI when it asks to edit files or run commands.")}
            >
              <Button
                disabled={busy()}
                onClick={() =>
                  void run(() => client.api.room.update({ roomID: room.id, guestApprovals: !room.guestApprovals }))
                }
              >
                {room.guestApprovals ? t("Me and guests") : t("Only me")}
              </Button>
            </Setting>
            <Setting
              label={t("AI outreach")}
              help={t(
                "Where this session's AI may post on its own: rooms you linked, or any room it finds, asking you before each send.",
              )}
            >
              <Button
                disabled={busy()}
                onClick={() =>
                  void run(() =>
                    client.api.room.update({ roomID: room.id, ai: room.ai === "linked" ? "discovered" : "linked" }),
                  )
                }
              >
                {room.ai === "linked" ? t("Linked rooms only") : t("Any room it finds")}
              </Button>
            </Setting>
            <box flexDirection="row" gap={1} paddingTop={1}>
              <Show when={!room.open}>
                <Button variant="primary" disabled={busy()} onClick={() => void run(() => issue(room.id))}>
                  {codes()[room.id] ? t("New join code") : t("Get join code")}
                </Button>
              </Show>
              <Button disabled={busy()} onLeave={() => setArmed()} onClick={() => close(room)}>
                {armed() === room.id ? t("Click again to stop hosting") : t("Stop hosting")}
              </Button>
            </box>
            <Show when={room.open || codes()[room.id]}>
              <text fg={theme.text.muted} wrapMode="word">
                {room.open
                  ? t("On the other device open Connect and pick this room, or enter the address.")
                  : t("On the other device open Connect, pick this room or enter the address, then the join code.")}
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
// window opens; any room can also be reached by address, with the join code
// unless its host lets guests in without one.
export function DialogConnect(props: { onClose?: () => void }) {
  const dialog = useDialog()
  const route = useRoute()
  const theme = useTheme().surface("dialog")
  const config = useConfig().data
  const dimensions = useTerminalDimensions()
  const t = useT()
  const [saved, updateSaved] = useJoinedRooms()
  const [found, { refetch: rescan, mutate: setFound }] = createResource(() => scanRooms())
  const [armed, setArmed] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [joinError, setJoinError] = createSignal<string>()
  const fields: { address?: InputRenderable; code?: InputRenderable; name?: InputRenderable } = {}

  const enter = (url: string, request: { code?: string; roomID?: string }) => {
    setBusy(true)
    setJoinError()
    void roomClient({ url, token: "" })
      .room.join({ ...request, name: fields.name?.value.trim() || hostname() })
      .then(async (joined) => {
        const room = { url, roomID: joined.room.id }
        await updateSaved((draft) => {
          draft.joined = [
            ...draft.joined.filter((item) => !sameRoom(item, room)),
            { ...room, name: joined.room.name, token: joined.token, guest: joined.guest.name },
          ]
        })
        open(room)
      })
      .catch((error: unknown) => setJoinError(errorMessage(error)))
      .finally(() => setBusy(false))
  }

  // With a code the host decides the room; without one the address must lead to
  // a single open room, and its rooms join the list above when there are several.
  const join = () => {
    const address = fields.address?.value.trim() ?? ""
    const code = fields.code?.value.trim() ?? ""
    if (!address) return setJoinError(t("Enter the host's address"))
    const url = /^https?:\/\//.test(address) ? address : `http://${address}`
    if (code) return enter(url, { code })
    setBusy(true)
    setJoinError()
    void listRooms(url)
      .then((rooms) => {
        setFound((previous) => [...(previous ?? []).filter((room) => room.url !== url), ...rooms])
        const unlocked = rooms.filter((room) => room.open)
        if (rooms.length === 0) return setJoinError(t("No rooms at this address"))
        if (unlocked.length === 1 && rooms.length === 1) return enter(url, { roomID: unlocked[0].id })
        if (unlocked.length === 0 && rooms.length === 1)
          return setJoinError(t("This room needs the join code its host shows"))
        setJoinError(t("Pick a room above: this host shares several"))
      })
      .catch((error: unknown) => setJoinError(errorMessage(error)))
      .finally(() => setBusy(false))
  }

  // An open room joins at once; any other only lacks the code: fill its address and move to the code field.
  const pick = (room: FoundRoom) => {
    if (room.open) return enter(room.url, { roomID: room.id })
    if (fields.address) fields.address.value = new URL(room.url).host
    setJoinError()
    fields.code?.focus()
  }

  // A joined room opens where a session would and stays in the left panel under Multiplayer.
  const open = (room: Pick<JoinedRoom, "url" | "roomID">) => {
    dialog.clear()
    route.navigate({ type: "room", url: room.url, roomID: room.roomID })
  }

  const leave = (room: JoinedRoom) => {
    const key = `${room.url}#${room.roomID}`
    if (armed() !== key) return setArmed(key)
    setArmed()
    void updateSaved((draft) => {
      draft.joined = draft.joined.filter((item) => !sameRoom(item, room))
    })
  }

  const field = (key: "address" | "code" | "name", label: string, placeholder: string) => (
    <Labeled label={label}>
      <input
        width={36}
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
      <Header title={t("Connect")} onClose={props.onClose} />
      {/* Small terminals cut the window off; scrolling keeps the address fields reachable. */}
      <scrollbox
        maxHeight={Math.max(8, dimensions().height - 8)}
        contentOptions={{ minHeight: 0, gap: 1 }}
        scrollbarOptions={{ visible: false }}
      >
        <Section title={t("Join by address")} />
        {field("address", t("Address"), t("e.g. 192.168.1.5:49375"))}
        {field("code", t("Join code"), t("e.g. ABCD-EFGH, empty if not needed"))}
        {field("name", t("Your name"), t("{name} (default)", { name: hostname() }))}
        <Show when={joinError()}>
          {(message) => (
            <text fg={theme.text.feedback.error.base} wrapMode="word">
              {message()}
            </text>
          )}
        </Show>
        <box flexDirection="row">
          <Button variant="primary" disabled={busy()} onClick={join}>
            {t("Join")}
          </Button>
        </box>

        <Section title={t("Rooms on this network")} />
        <box flexDirection="row" gap={1}>
          <text fg={theme.text.muted}>
            {found.loading
              ? t("Searching…")
              : found()?.length
                ? t("{count} found", { count: found()!.length })
                : t("No rooms found")}
          </text>
          <Button disabled={found.loading} onClick={() => void rescan()}>
            {t("Search again")}
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
              <Button variant="primary" disabled={busy()} onClick={() => pick(room)}>
                {room.open ? t("Join") : t("Select")}
              </Button>
            </box>
          )}
        </For>
        <Show when={!found.loading && !found()?.length}>
          <text fg={theme.text.muted} wrapMode="word">
            {t(
              "Not found? Both computers must be on one network, and on Windows opencode must be allowed in the firewall.",
            )}
          </text>
        </Show>
        <FirewallHelp ports={[]} />

        <Show when={saved.joined.length > 0}>
          <Section title={t("Joined rooms")} />
        </Show>
        <For each={saved.joined}>
          {(room) => (
            <box flexDirection="row" gap={1}>
              <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                {room.name}
              </text>
              <text fg={theme.text.muted}>{`${new URL(room.url).host} · ${t("as {name}", { name: room.guest })}`}</text>
              <box flexGrow={1} />
              <Button variant="primary" onClick={() => open(room)}>
                {t("Open")}
              </Button>
              <Button onLeave={() => setArmed()} onClick={() => leave(room)}>
                {armed() === `${room.url}#${room.roomID}` ? t("Click again to leave") : t("Leave")}
              </Button>
            </box>
          )}
        </For>
      </scrollbox>
    </box>
  )
}

// Windows Firewall drops room traffic for an app the user never allowed, and the
// prompt that would ask never shows for the background service. One elevated
// PowerShell run removes block rules for this program and lets the local subnet
// reach the server port and the discovery ports.
function FirewallHelp(props: { ports: readonly number[] }) {
  const theme = useTheme().surface("dialog")
  const toast = useToast()
  const t = useT()
  const [busy, setBusy] = createSignal(false)
  const allow = () => {
    setBusy(true)
    void allowInWindowsFirewall(props.ports)
      .then(() => toast.show({ message: t("Windows Firewall rules added"), variant: "success" }))
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))
      .finally(() => setBusy(false))
  }
  return (
    <Show when={process.platform === "win32"}>
      <box>
        <text fg={theme.text.muted} wrapMode="word">
          {t(
            "Windows Firewall blocks rooms until opencode is allowed on the local network; Windows asks for administrator rights once.",
          )}
        </text>
        <box flexDirection="row">
          <Button disabled={busy()} onClick={allow}>
            {t("Allow in Windows Firewall")}
          </Button>
        </box>
      </box>
    </Show>
  )
}

async function allowInWindowsFirewall(ports: readonly number[]) {
  const name = "'opencode rooms'"
  const rule = `-DisplayName ${name} -Direction Inbound -Action Allow -RemoteAddress LocalSubnet -Profile Any`
  const script = [
    `$program = '${process.execPath.replaceAll("'", "''")}'`,
    // A dismissed firewall prompt leaves block rules for the program, and block rules win over allow rules.
    "Get-NetFirewallApplicationFilter -Program $program -ErrorAction SilentlyContinue | Get-NetFirewallRule | Where-Object { $_.Action -eq 'Block' } | Remove-NetFirewallRule",
    `Remove-NetFirewallRule -DisplayName ${name} -ErrorAction SilentlyContinue`,
    `New-NetFirewallRule ${rule} -Program $program`,
    `New-NetFirewallRule ${rule} -Protocol UDP -LocalPort ${DISCOVERY_PORTS.join(",")}`,
    ...(ports.length ? [`New-NetFirewallRule ${rule} -Protocol TCP -LocalPort ${ports.join(",")}`] : []),
  ].join("; ")
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  const child = Bun.spawn(
    [
      "powershell",
      "-NoProfile",
      "-Command",
      `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`,
    ],
    { stdout: "ignore", stderr: "pipe" },
  )
  if ((await child.exited) !== 0)
    throw new Error((await new Response(child.stderr).text()).trim() || "PowerShell failed")
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

function Setting(props: { label: string; help: string; children: JSX.Element }) {
  const theme = useTheme().surface("dialog")
  return (
    <box flexDirection="row">
      <box width={LABEL_WIDTH} flexShrink={0}>
        <text fg={theme.text.muted}>{props.label}</text>
      </box>
      <box flexShrink={1} minWidth={0}>
        <box flexDirection="row">{props.children}</box>
        <text fg={theme.text.muted} wrapMode="word">
          {props.help}
        </text>
      </box>
    </box>
  )
}

function countdown(ms: number) {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function Section(props: { title: string }) {
  const theme = useTheme().surface("dialog")
  return (
    <text fg={theme.text.base} attributes={TextAttributes.UNDERLINE}>
      {props.title}
    </text>
  )
}
