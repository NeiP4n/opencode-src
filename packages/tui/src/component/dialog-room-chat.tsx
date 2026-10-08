import { TextAttributes, type InputRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
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
  const [sending, setSending] = createSignal(false)
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

  const send = () => {
    const text = input?.value.trim()
    if (!text || sending()) return
    setSending(true)
    void client.room.guest
      .prompt({ roomID: props.room.roomID, text })
      .then(() => {
        if (input) input.value = ""
        return refresh()
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setSending(false))
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          {`${props.room.name} · ${new URL(props.room.url).host}`}
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
                {message.role === "assistant" ? "AI" : message.author === props.room.guest ? "You" : message.author}
              </text>
              <text fg={theme.text.base} wrapMode="word">
                {message.text}
              </text>
            </box>
          )}
        </For>
      </scrollbox>
      <Show when={running()}>
        <text fg={theme.text.muted}>The host's AI is working…</text>
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
        placeholder={sending() ? "Sending…" : "Message the room, enter to send"}
        placeholderColor={theme.text.muted}
        textColor={theme.text.formfield.base}
        focusedTextColor={theme.text.formfield.focused}
        cursorColor={theme.text.formfield.focused}
        focusedBackgroundColor={theme.background.formfield.focused}
      />
    </box>
  )
}
