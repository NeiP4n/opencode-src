import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core"
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { OpenCode, type NoteInfo, type RoomMessage } from "@opencode/client"
import { useConfig } from "../config"
import { useTheme, useThemes } from "../context/theme"
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
  // The note the host bound to this room's chat: the host's AI writes into it.
  const [note, setNote] = createSignal<{ name: string; title: string }>()
  const [reading, setReading] = createSignal(false)
  const [document, setDocument] = createSignal<NoteInfo | null>()
  const [hovered, setHovered] = createSignal(false)
  const { currentSyntax: syntax } = useThemes()
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
        setNote(result.note)
        setError()
        if (!result.note) setReading(false)
        if (reading() && result.note) void readNote()
        if (grew && !reading()) setTimeout(() => scroll?.scrollTo(scroll.scrollHeight), 1)
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))

  const readNote = () =>
    client.room.guest
      .note({ roomID: props.room.roomID })
      .then(setDocument)
      .catch((cause: unknown) => setError(errorMessage(cause)))

  const toggleNote = () => {
    const next = !reading()
    setReading(next)
    if (next) void readNote()
  }

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
      <Show when={note()}>
        {(bound) => (
          <box flexDirection="row" gap={2}>
            <text fg={theme.text.base} wrapMode="none" truncate>
              {`✎ Note: ${bound().title}`}
              <span style={{ fg: theme.text.muted }}> · the host's AI writes your requests into it</span>
            </text>
            <box flexGrow={1} />
            <box
              flexShrink={0}
              onMouseOver={() => setHovered(true)}
              onMouseOut={() => setHovered(false)}
              onMouseUp={toggleNote}
            >
              <text fg={hovered() ? theme.text.action.primary.hovered : theme.text.action.primary.base}>
                {reading() ? "Back to chat" : "Read note"}
              </text>
            </box>
          </box>
        )}
      </Show>
      <Show when={reading()}>
        <scrollbox height={18}>
          <Show
            when={document()}
            fallback={
              <text fg={theme.text.muted}>
                {document() === null ? "The note is no longer bound." : "Reading the note…"}
              </text>
            }
          >
            {(current) => (
              <Show
                when={current().body.trim()}
                fallback={<text fg={theme.text.muted}>The note is empty so far.</text>}
              >
                <markdown
                  syntaxStyle={syntax()}
                  content={current().body}
                  conceal
                  internalBlockMode="top-level"
                  tableOptions={{ style: "grid", cellPaddingX: 1 }}
                  fg={theme.markdown.text}
                  bg={theme.background.base}
                />
              </Show>
            )}
          </Show>
        </scrollbox>
      </Show>
      <scrollbox
        visible={!reading()}
        height={reading() ? 0 : 18}
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
