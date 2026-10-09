import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core"
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { OpenCode, type NoteInfo, type RoomMessage } from "@opencode/client"
import { useConfig } from "../config"
import { useTheme, useThemes } from "../context/theme"
import { errorMessage } from "../util/error"
import { useT } from "../util/i18n"
import type { JoinedRoom } from "../util/room"

const POLL_MS = 1500

export function roomClient(room: Pick<JoinedRoom, "url" | "token">) {
  return OpenCode.make({ baseUrl: room.url, headers: { authorization: `Bearer ${room.token}` } })
}

// A joined room in the main area, where a session would be: everyone's messages
// and the host model's answers. Guests only post; the model runs on the host.
export function RoomChat(props: { room: JoinedRoom }) {
  const theme = useTheme()
  const config = useConfig().data
  const t = useT()
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
    if (message.role === "assistant") return t("AI")
    if (message.author === props.room.guest) return t("You")
    if (!message.author || message.author === "host") return t("Host")
    return message.author
  }

  return (
    <box flexGrow={1} minHeight={0} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1}>
      <text fg={theme.text.base} wrapMode="none" truncate>
        <span style={{ fg: theme.text.action.secondary.base, bold: true }}>{`⇄ ${t("Multiplayer")}`}</span>
        <span style={{ bold: true }}>{` · ${props.room.name}`}</span>
        <span style={{ fg: theme.text.muted }}>
          {` · ${t("host {host}", { host: host() ?? new URL(props.room.url).host })} · ${t("{count} in the room", { count: people() })}`}
        </span>
      </text>
      <Show when={note()}>
        {(bound) => (
          <box flexDirection="row" gap={2}>
            <text fg={theme.text.base} wrapMode="none" truncate>
              {`✎ ${t("Note: {title}", { title: bound().title })}`}
              <span style={{ fg: theme.text.muted }}>{` · ${t("the host's AI writes your requests into it")}`}</span>
            </text>
            <box flexGrow={1} />
            <box
              flexShrink={0}
              onMouseOver={() => setHovered(true)}
              onMouseOut={() => setHovered(false)}
              onMouseUp={toggleNote}
            >
              <text fg={hovered() ? theme.text.action.primary.hovered : theme.text.action.primary.base}>
                {reading() ? t("Back to chat") : t("Read note")}
              </text>
            </box>
          </box>
        )}
      </Show>
      <Show when={reading()}>
        <scrollbox flexGrow={1} minHeight={0}>
          <Show
            when={document()}
            fallback={
              <text fg={theme.text.muted}>
                {document() === null ? t("The note is no longer bound.") : t("Reading the note…")}
              </text>
            }
          >
            {(current) => (
              <Show
                when={current().body.trim()}
                fallback={<text fg={theme.text.muted}>{t("The note is empty so far.")}</text>}
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
        flexGrow={reading() ? 0 : 1}
        minHeight={0}
        ref={(element: ScrollBoxRenderable) => {
          scroll = element
        }}
      >
        <Show when={messages().length === 0}>
          <text fg={theme.text.muted}>{t("No messages yet. Say hello; the host's AI answers here.")}</text>
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
        <text fg={theme.text.muted}>{t("The host's AI is answering… you can keep writing.")}</text>
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
        placeholder={sending() > 0 ? t("Sending…") : t("Message the room, enter to send")}
        placeholderColor={theme.text.muted}
        textColor={theme.text.formfield.base}
        focusedTextColor={theme.text.formfield.focused}
        cursorColor={theme.text.formfield.focused}
        backgroundColor={theme.background.formfield.base}
        focusedBackgroundColor={theme.background.formfield.focused}
      />
    </box>
  )
}
