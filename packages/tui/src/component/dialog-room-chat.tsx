import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core"
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { OpenCode, type RoomMessage } from "@opencode/client"
import { useConfig } from "../config"
import { useTheme } from "../context/theme"
import { errorMessage } from "../util/error"

// A room this device joined on another host. The token only opens that room.
export type JoinedRoom = {
  url: string
  roomID: string
  name: string
  token: string
  guest: string
}

const POLL_MS = 1500

export function roomClient(room: Pick<JoinedRoom, "url" | "token">) {
  return OpenCode.make({ baseUrl: room.url, headers: { authorization: `Bearer ${room.token}` } })
}

// Chat view of a joined room: everyone's messages and the host model's answers.
// Guests only post; the model runs on the host.
export function DialogRoomChat(props: { room: JoinedRoom; onClose: () => void }) {
  const theme = useTheme().surface("dialog")
  const config = useConfig().data
  const client = roomClient(props.room)
  const [messages, setMessages] = createSignal<readonly RoomMessage[]>([])
  const [running, setRunning] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [sending, setSending] = createSignal(0)
  // The host's machine name; the address stands in until it answers.
  const [host] = createResource(() =>
    client.room.public().then(
      (result) => result.host,
      () => undefined,
    ),
  )
  // Everyone who has posted, plus this device even before its first message.
  const people = createMemo(
    () =>
      new Set([
        props.room.guest,
        ...messages().flatMap((message) => (message.role === "user" && message.author ? [message.author] : [])),
      ]).size,
  )
  let input: InputRenderable | undefined
  let scroll: ScrollBoxRenderable | undefined

  const refresh = () =>
    client.room.guest
      .messages({ roomID: props.room.roomID })
      .then((result) => {
        const grew = result.data.length !== messages().length
        setMessages(result.data)
        setRunning(result.running)
        setError()
        if (grew) setTimeout(() => scroll?.scrollTo(scroll.scrollHeight), 1)
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))

  onMount(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MS)
    onCleanup(() => clearInterval(timer))
    setTimeout(() => input?.focus(), 1)
  })

  // The field clears at once so the next message can be typed while this one
  // posts or the host's AI is still answering; a failed post puts it back.
  const send = () => {
    const text = input?.value.trim()
    if (!text || !input) return
    input.value = ""
    setSending((count) => count + 1)
    void client.room.guest
      .prompt({ roomID: props.room.roomID, text })
      .then(() => refresh())
      .catch((cause: unknown) => {
        setError(errorMessage(cause))
        if (input && !input.value) input.value = text
      })
      .finally(() => setSending((count) => count - 1))
  }

  const author = (message: RoomMessage) => {
    if (message.role === "assistant") return "AI"
    if (message.author === props.room.guest) return "You"
    if (!message.author || message.author === "host") return "Host"
    return message.author
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.base} wrapMode="none" truncate>
          <span style={{ bold: true }}>{`⇄ Multiplayer · ${props.room.name}`}</span>
          <span style={{ fg: theme.text.muted }}>
            {` · host ${host() ?? new URL(props.room.url).host} · ${people()} ${people() === 1 ? "person" : "people"}`}
          </span>
        </text>
        <text fg={theme.text.muted} onMouseUp={props.onClose}>
          esc
        </text>
      </box>
      <scrollbox
        height={18}
        ref={(element: ScrollBoxRenderable) => {
          scroll = element
        }}
      >
        <Show when={messages().length === 0}>
          <text fg={theme.text.muted}>No messages yet. Say hello; the host's AI answers here.</text>
        </Show>
        <For each={messages()}>
          {(message) => (
            <box paddingBottom={1}>
              <text fg={message.role === "assistant" ? theme.text.action.primary.base : theme.text.muted}>
                {author(message)}
              </text>
              <text fg={theme.text.base} wrapMode="word">
                {message.text}
              </text>
            </box>
          )}
        </For>
      </scrollbox>
      <Show when={running()}>
        <text fg={theme.text.muted}>The host's AI is answering… you can keep writing.</text>
      </Show>
      <Show when={error()}>
        {(message) => (
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            {message()}
          </text>
        )}
      </Show>
      <input
        cursorStyle={config.cursor}
        ref={(element: InputRenderable) => {
          input = element
        }}
        onSubmit={send}
        placeholder={sending() > 0 ? "Sending…" : "Message the room, enter to send"}
        placeholderColor={theme.text.muted}
        textColor={theme.text.formfield.base}
        focusedTextColor={theme.text.formfield.focused}
        cursorColor={theme.text.formfield.focused}
        focusedBackgroundColor={theme.background.formfield.focused}
      />
    </box>
  )
}
