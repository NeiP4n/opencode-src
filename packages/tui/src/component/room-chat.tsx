import type { TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { NoteInfo, PermissionRequest } from "@opencode/client"
import { useConfig } from "../config"
import { ClientProvider } from "../context/client"
import { DataProvider } from "../context/data"
import { useTheme, useThemes } from "../context/theme"
import { SessionTranscript } from "../routes/session"
import { SplitBorder } from "../ui/border"
import { errorMessage } from "../util/error"
import { useT } from "../util/i18n"
import type { JoinedRoom } from "../util/room"
import { guestApi, ignoreGuestUnavailable, roomClient } from "../util/room-guest"

// The host polls this often for who is connected; the guest also learns of role changes and removal.
const POLL_MS = 2000

const ROLE = { viewer: "Viewer", member: "Member", helper: "Helper" } as const

// A joined room in the main area, drawn like a session: the host's transcript with its
// tool calls and reasoning, read through the room's guest routes. What a guest may do
// follows the role the host gave it: viewers read, members write, helpers also answer
// the host model's permission requests.
export function RoomChat(props: { room: JoinedRoom }) {
  const remote = roomClient(props.room)
  const roomID = props.room.roomID
  const [joined, { refetch }] = createResource(() => remote.room.guest.get({ roomID }))
  const [permissions, setPermissions] = createSignal<readonly PermissionRequest[]>([])
  const [note, setNote] = createSignal<{ name: string; title: string }>()
  // The poll replaces the answer every few seconds; only a different session remounts the view.
  const sessionID = createMemo(() => joined.latest?.session.id)

  onMount(() => {
    const poll = () => {
      void refetch()
      void remote.room.guest.permission
        .list({ roomID })
        .then(setPermissions)
        .catch(() => setPermissions([]))
      void remote.room.guest
        .messages({ roomID })
        .then((result) => setNote(result.note))
        .catch(() => undefined)
    }
    poll()
    const timer = setInterval(poll, POLL_MS)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <Show when={sessionID()} fallback={<RoomProblem room={props.room} error={joined.error} />} keyed>
      {(id) => (
        <ClientProvider api={guestApi(props.room)}>
          <DataProvider directory={joined.latest?.session.location.directory ?? ""} onError={ignoreGuestUnavailable}>
            <RoomView
              room={props.room}
              sessionID={id}
              role={joined.latest?.role ?? "viewer"}
              host={new URL(props.room.url).host}
              error={joined.error ? errorMessage(joined.error) : undefined}
              permissions={permissions()}
              note={note()}
              onAnswered={(id) => setPermissions((list) => list.filter((item) => item.id !== id))}
            />
          </DataProvider>
        </ClientProvider>
      )}
    </Show>
  )
}

function RoomView(props: {
  room: JoinedRoom
  sessionID: string
  role: keyof typeof ROLE
  host: string
  error?: string
  permissions: readonly PermissionRequest[]
  note?: { name: string; title: string }
  onAnswered: (id: string) => void
}) {
  const theme = useTheme()
  const config = useConfig().data
  const dimensions = useTerminalDimensions()
  const t = useT()
  const remote = roomClient(props.room)
  const [sending, setSending] = createSignal(0)
  const [failure, setFailure] = createSignal<string>()
  const [reading, setReading] = createSignal(false)
  const [document, setDocument] = createSignal<NoteInfo | null>()
  const { currentSyntax: syntax } = useThemes()
  let input: TextareaRenderable | undefined

  onMount(() => setTimeout(() => input?.focus(), 1))

  // The field clears at once so the next message can be typed while this one posts;
  // a failed post puts it back.
  const send = () => {
    const text = input?.plainText.trim()
    if (!text || !input) return
    input.clear()
    setSending((count) => count + 1)
    void remote.room.guest
      .prompt({ roomID: props.room.roomID, text })
      .then(() => setFailure())
      .catch((cause: unknown) => {
        setFailure(errorMessage(cause))
        if (input && !input.plainText) input.setText(text)
      })
      .finally(() => setSending((count) => count - 1))
  }

  const answer = (request: PermissionRequest, decision: "once" | "always" | "reject") =>
    void remote.room.guest.permission
      .reply({ roomID: props.room.roomID, requestID: request.id, decision })
      .then(() => props.onAnswered(request.id))
      .catch((cause: unknown) => setFailure(errorMessage(cause)))

  const toggleNote = () => {
    const next = !reading()
    setReading(next)
    if (next)
      void remote.room.guest
        .note({ roomID: props.room.roomID })
        .then(setDocument)
        .catch((cause: unknown) => setFailure(errorMessage(cause)))
  }

  const padding = () => (dimensions().width < 44 ? 1 : 2)
  const writes = () => props.role !== "viewer"

  return (
    <box flexGrow={1} minHeight={0} paddingLeft={padding()} paddingRight={padding()} paddingBottom={1}>
      <box flexDirection="row" gap={1} paddingTop={1} flexShrink={0}>
        <text fg={theme.text.base} wrapMode="none" truncate flexShrink={1}>
          <span style={{ fg: theme.text.action.secondary.base, bold: true }}>{`⇄ ${t("Multiplayer")}`}</span>
          <span style={{ bold: true }}>{` · ${props.room.name}`}</span>
          <span style={{ fg: theme.text.muted }}>{` · ${t("host {host}", { host: props.host })}`}</span>
        </text>
        <box flexGrow={1} />
        <text fg={theme.text.formfield.base} flexShrink={0}>{`[${t(ROLE[props.role])}]`}</text>
      </box>
      <Show when={props.note}>
        {(bound) => (
          <box flexDirection="row" gap={2} flexShrink={0}>
            <text fg={theme.text.base} wrapMode="none" truncate>
              {`✎ ${t("Note: {title}", { title: bound().title })}`}
              <span style={{ fg: theme.text.muted }}>{` · ${t("the host's AI writes your requests into it")}`}</span>
            </text>
            <box flexGrow={1} />
            <text fg={theme.text.action.primary.base} flexShrink={0} onMouseUp={toggleNote}>
              {reading() ? t("Back to chat") : t("Read note")}
            </text>
          </box>
        )}
      </Show>
      <Show
        when={!reading()}
        fallback={
          <scrollbox flexGrow={1} minHeight={0} paddingTop={1}>
            <Show
              when={document()?.body.trim()}
              fallback={
                <text fg={theme.text.muted}>
                  {document() === null ? t("The note is no longer bound.") : t("The note is empty so far.")}
                </text>
              }
            >
              {(body) => (
                <markdown
                  syntaxStyle={syntax()}
                  content={body()}
                  conceal
                  internalBlockMode="top-level"
                  tableOptions={{ style: "grid", cellPaddingX: 1 }}
                  fg={theme.markdown.text}
                  bg={theme.background.base}
                />
              )}
            </Show>
          </scrollbox>
        }
      >
        <SessionTranscript sessionID={props.sessionID} width={dimensions().width - padding() * 2} />
      </Show>
      <Show when={props.role === "helper" && props.permissions.length > 0}>
        <For each={props.permissions}>
          {(request) => (
            <box
              flexShrink={0}
              marginTop={1}
              border={["left"]}
              customBorderChars={SplitBorder.customBorderChars}
              borderColor={theme.border.base}
              paddingLeft={2}
              backgroundColor={theme.background.raised.base}
            >
              <text fg={theme.text.base} wrapMode="word">
                {request.message ?? `${request.action} ${request.resources.join(", ")}`}
              </text>
              <box flexDirection="row" gap={2}>
                <text fg={theme.text.action.primary.base} onMouseUp={() => answer(request, "once")}>
                  {t("Allow once")}
                </text>
                <text fg={theme.text.action.primary.base} onMouseUp={() => answer(request, "always")}>
                  {t("Always allow")}
                </text>
                <text fg={theme.text.feedback.error.base} onMouseUp={() => answer(request, "reject")}>
                  {t("Deny")}
                </text>
              </box>
            </box>
          )}
        </For>
      </Show>
      <Show when={failure() ?? props.error}>
        {(message) => (
          <text fg={theme.text.feedback.error.base} wrapMode="word" flexShrink={0}>
            {message()}
          </text>
        )}
      </Show>
      <box
        flexShrink={0}
        marginTop={1}
        border={["left"]}
        borderColor={theme.border.base}
        customBorderChars={{ ...SplitBorder.customBorderChars, bottomLeft: "╹" }}
      >
        <box
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={theme.decrease(theme.background.raised.base)}
        >
          <Show
            when={writes()}
            fallback={<text fg={theme.text.muted}>{t("You are watching this room; the host lets you write.")}</text>}
          >
            <textarea
              ref={(element: TextareaRenderable) => {
                input = element
              }}
              minHeight={1}
              maxHeight={6}
              cursorStyle={config.cursor}
              placeholder={sending() > 0 ? t("Sending…") : t("Message the room, enter to send")}
              placeholderColor={theme.text.muted}
              textColor={theme.text.formfield.base}
              focusedTextColor={theme.text.formfield.focused}
              cursorColor={theme.text.formfield.focused}
              keyBindings={[{ name: "return", action: "submit" }]}
              onSubmit={send}
            />
          </Show>
        </box>
      </box>
    </box>
  )
}

// Shown until the host answers, or when it refuses this guest.
function RoomProblem(props: { room: JoinedRoom; error: unknown }) {
  const theme = useTheme()
  const t = useT()
  return (
    <box flexGrow={1} paddingLeft={2} paddingTop={1}>
      <text fg={theme.text.base}>
        <span style={{ fg: theme.text.action.secondary.base, bold: true }}>{`⇄ ${t("Multiplayer")}`}</span>
        <span style={{ bold: true }}>{` · ${props.room.name}`}</span>
      </text>
      <text fg={props.error ? theme.text.feedback.error.base : theme.text.muted} wrapMode="word">
        {props.error ? errorMessage(props.error) : t("Connecting to the host…")}
      </text>
    </box>
  )
}
