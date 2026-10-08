import type { LocationRef } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import type { Destination, Route } from "@opencode/plugin/tui/context"
import { TextAttributes, type KeyEvent, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { statSync } from "node:fs"
import path from "node:path"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useConfig } from "../../config"
import { Keymap } from "../../context/keymap"
import { useTheme, useThemes } from "../../context/theme"
import { usePlugin } from "../../plugin/context"
import { getScrollAcceleration } from "../../util/scroll"
import { NOTES_PATH, listNotes, saveNote, saveWarning, type NoteRow, type NotesFiles } from "./notes-data"

const ROUTE = "notes"
const GROUP = "Notes"
const STAMP_WIDTH = 14
const STATUS_WIDTH = 9

type Mode = "list" | "view" | "edit"

/** What the route carries between `notes.open` and the screen: where it came from, and whose notes it shows. */
type RouteData = { readonly returnRoute?: Route; readonly sessionID?: string }

/** Markdown renderer of the host, so a note reads like a message of the session it came from. */
type Markdown = ReturnType<typeof usePlugin>["markdown"]

export function NotesPage(props: { context: Plugin.Context; markdown: Markdown }) {
  const theme = useTheme()
  const shortcuts = Keymap.useShortcuts()
  const [mode, setMode] = createSignal<Mode>("list")
  const [cursor, setCursor] = createSignal(0)
  const [notice, setNotice] = createSignal<string | undefined>(undefined)
  const [editor, setEditor] = createSignal<TextareaRenderable | undefined>(undefined)
  const data = createMemo(() => routeData(props.context))
  // The router has no history, so the route the screen was opened from travels in the route data.
  const returnRoute = createMemo<Destination>(() => data().returnRoute ?? { type: "home" })
  const location = createMemo(() => noteLocation(props.context, data().sessionID), undefined, {
    equals: (left, right) => left.directory === right.directory,
  })
  const files = createMemo(() => noteFiles(props.context, location()))
  const [listing, { refetch }] = createResource(files, listNotes)
  const rows = () => listing()?.rows ?? []
  const current = () => rows()[Math.min(cursor(), rows().length - 1)]

  const move = (delta: number) => setCursor((index) => Math.max(0, Math.min(index + delta, rows().length - 1)))

  const back = () => {
    if (mode() === "edit") {
      setNotice(undefined)
      setMode("view")
      return
    }
    if (mode() === "view") {
      setMode("list")
      return
    }
    props.context.ui.router.navigate(returnRoute())
  }

  const open = (index: number) => {
    setCursor(index)
    setNotice(undefined)
    setMode("view")
  }

  const edit = () => {
    if (!current()?.parsed) return
    setNotice(undefined)
    setMode("edit")
  }

  const save = async () => {
    const note = current()
    if (!note) return
    const result = await saveNote(files(), note, editor()?.plainText ?? note.body).catch(
      () => ({ ok: false, reason: "failed" }) as const,
    )
    if (!result.ok) {
      setNotice(saveWarning(result.reason, note))
      return
    }
    // Reloading re-reads the note, so the next save compares against the file as it is now.
    await refetch()
    setMode("view")
  }

  props.context.keymap.layer(() => ({
    commands: [
      {
        id: "notes.back",
        title: "Back",
        group: GROUP,
        bind: "escape",
        // While the editor holds the keys, its own layer below owns escape.
        enabled: mode() !== "edit",
        run: back,
      },
      {
        id: "notes.view",
        title: "Open note",
        group: GROUP,
        bind: "return",
        enabled: mode() === "list" && current() !== undefined,
        run: () => open(cursor()),
      },
      {
        id: "notes.edit",
        title: "Edit note",
        group: GROUP,
        bind: "e",
        enabled: mode() === "view" && current()?.parsed === true,
        run: edit,
      },
      {
        id: "notes.next",
        title: "Next note",
        group: GROUP,
        bind: "down,j",
        enabled: mode() === "list",
        run: () => move(1),
      },
      {
        id: "notes.previous",
        title: "Previous note",
        group: GROUP,
        bind: "up,k",
        enabled: mode() === "list",
        run: () => move(-1),
      },
    ],
  }))

  // Offered only when the screen was opened from a chat: elsewhere back is the way out.
  const chat = () =>
    returnRoute().type === "session" ? () => props.context.ui.router.navigate(returnRoute()) : undefined

  props.context.keymap.layer(() => ({
    mode: "global",
    enabled: () => mode() === "edit",
    // The editor owns the keyboard, so its own bindings must win over the managed input layer.
    priority: 1,
    commands: [
      { id: "notes.cancel", bind: "escape", title: "Cancel edit", group: GROUP, run: back },
      { id: "notes.save", title: "Save note", group: GROUP, run: () => void save() },
    ],
  }))

  return (
    <box width="100%" height="100%" backgroundColor={theme.background.base} flexDirection="column">
      <NotesHeader directory={location().directory} onChat={chat} />
      <Show when={notice()}>{(text) => <NoticeText text={text()} />}</Show>
      <Show when={listing.error}>
        <NoticeText text={`Could not read ${NOTES_PATH}. Create it or check the notes folder.`} />
      </Show>
      <Show when={!listing.loading && rows().length === 0 && !listing.error}>
        <NoticeText text={`No notes in ${NOTES_PATH} yet.`} />
      </Show>
      <Show when={mode() === "list"}>
        <NotesList rows={rows()} cursor={cursor()} onOpen={open} />
      </Show>
      <Show when={mode() === "view" && current()}>
        {(note) => <NoteView note={note()} markdown={props.markdown} />}
      </Show>
      <Show when={mode() === "edit" && current()}>
        {(note) => <NoteEditor note={note()} onReady={setEditor} onSave={() => void save()} />}
      </Show>
      <NotesFooter
        mode={mode()}
        shortcut={(id) => shortcuts.get(id)}
        count={rows().length}
        unreadable={listing()?.unreadable.length ?? 0}
        loading={listing.loading}
      />
    </box>
  )
}

function NotesHeader(props: { directory: string; onChat?: () => void }) {
  const theme = useTheme()
  return (
    <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2} flexShrink={0}>
      <box flexDirection="row" gap={2}>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          notes
        </text>
        <text fg={theme.text.muted} truncate>
          {props.directory}
        </text>
      </box>
      <Show when={props.onChat}>{(onChat) => <NotesAction label="chat" onClick={onChat()} />}</Show>
    </box>
  )
}

function NotesList(props: { rows: readonly NoteRow[]; cursor: number; onOpen: (index: number) => void }) {
  const theme = useTheme()
  return (
    <scrollbox flexGrow={1} contentOptions={{ flexDirection: "column" }}>
      <box flexDirection="row" paddingLeft={2} paddingRight={2} flexShrink={0}>
        <text fg={theme.text.muted} width={STAMP_WIDTH}>
          UPDATED
        </text>
        <text fg={theme.text.muted} width={STATUS_WIDTH}>
          STATUS
        </text>
        <text fg={theme.text.muted} flexGrow={1}>
          TITLE
        </text>
        <text fg={theme.text.muted}>TAGS</text>
      </box>
      <For each={props.rows}>
        {(row, index) => (
          <box
            flexDirection="row"
            paddingLeft={2}
            paddingRight={2}
            onMouseUp={() => props.onOpen(index())}
            backgroundColor={props.cursor === index() ? theme.background.raised.base : undefined}
          >
            <text fg={theme.text.muted} width={STAMP_WIDTH} wrapMode="none">
              {stamp(row.updated)}
            </text>
            <text fg={statusColor(theme, row)} width={STATUS_WIDTH} wrapMode="none">
              {row.status}
            </text>
            <text
              fg={props.cursor === index() ? theme.text.base : theme.text.action.secondary.base}
              flexGrow={1}
              truncate
            >
              {row.title}
            </text>
            <text fg={theme.text.muted} wrapMode="none">
              {row.tags.join(", ")}
            </text>
          </box>
        )}
      </For>
    </scrollbox>
  )
}

function NoteView(props: { note: NoteRow; markdown: Markdown }) {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const { currentSyntax: syntax } = useThemes()
  const config = useConfig().data
  let scroll: ScrollBoxRenderable | undefined
  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" gap={2} paddingLeft={2} paddingRight={2} flexShrink={0}>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD} truncate>
          {props.note.title}
        </text>
        <text fg={theme.text.muted}>{stamp(props.note.updated)}</text>
        <text fg={theme.text.muted}>{props.note.tags.join(", ")}</text>
      </box>
      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        flexGrow={1}
        scrollAcceleration={getScrollAcceleration(config)}
      >
        <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <Show when={props.note.parsed} fallback={<NoticeText text="Not a note: no frontmatter." />}>
            <markdown
              syntaxStyle={syntax()}
              renderNode={props.markdown()}
              content={props.note.body}
              conceal
              internalBlockMode="top-level"
              tableOptions={{ style: "grid", cellPaddingX: 1 }}
              fg={theme.markdown.text}
              bg={theme.background.base}
            />
          </Show>
        </box>
      </scrollbox>
      <text fg={theme.text.muted} paddingLeft={2} visible={!!scroll && dimensions().height > 0}>
        {`j/k ↑/↓ scroll (${Math.max(1, (scroll?.scrollHeight ?? 0) - (scroll?.viewport?.height ?? 0))} more)`}
      </text>
    </box>
  )
}

function NoteEditor(props: {
  note: NoteRow
  onReady: (editor: TextareaRenderable) => void
  onSave: () => void
}) {
  const theme = useTheme()
  const config = useConfig().data
  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2}>
      <textarea
        width="100%"
        flexGrow={1}
        wrapMode="word"
        ref={(element: TextareaRenderable) => {
          props.onReady(element)
          element.focus()
        }}
        onKeyDown={(event: KeyEvent) => {
          // The focused textarea takes the keyboard, so the save shortcut is handled here
          // instead of through a keymap layer that would only see the key when nothing is focused.
          console.log("DEBUG keydown", event.name, event.ctrl)
          if (!event.ctrl || event.name !== "s") return
          event.preventDefault()
          event.stopPropagation()
          props.onSave()
        }}
        initialValue={props.note.body}
        textColor={theme.text.formfield.base}
        focusedTextColor={theme.text.formfield.base}
        cursorColor={theme.text.formfield.base}
        backgroundColor={theme.background.formfield.base}
        focusedBackgroundColor={theme.background.formfield.focused}
        cursorStyle={config.cursor}
      />
    </box>
  )
}

function NotesFooter(props: {
  mode: Mode
  shortcut: (id: string) => string | undefined
  count: number
  unreadable: number
  loading: boolean
}) {
  const theme = useTheme()
  return (
    <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2} flexShrink={0}>
      <text fg={theme.text.muted}>{footerLine(props.mode, props.shortcut)}</text>
      <text fg={props.unreadable ? theme.text.feedback.warning.base : theme.text.muted}>
        {props.loading
          ? "reading…"
          : `${props.count} notes${props.unreadable ? ` · ${props.unreadable} unreadable` : ""}`}
      </text>
    </box>
  )
}

function NotesAction(props: { label: string; onClick: () => void }) {
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      paddingLeft={2}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={props.onClick}
    >
      <text
        fg={hovered() ? theme.text.action.secondary.hovered : theme.text.action.secondary.base}
        attributes={TextAttributes.BOLD}
      >
        {props.label}
      </text>
    </box>
  )
}

function NoticeText(props: { text: string }) {
  const theme = useTheme()
  return (
    <box paddingLeft={2} paddingRight={2}>
      <text fg={theme.text.feedback.warning.base} truncate>
        {props.text}
      </text>
    </box>
  )
}

/** NotesFiles over the client: every note is read whole, which a notes folder can afford. */
function noteFiles(context: Plugin.Context, location: LocationRef): NotesFiles {
  const decoder = new TextDecoder()
  return {
    list: async () =>
      (await context.client.file.list({ location, path: NOTES_PATH })).data
        .filter((entry) => entry.type === "file")
        .map((entry) => entry.path),
    read: async (file) => ({
      text: decoder.decode(await context.client.file.read({ location, path: file })),
      mtimeMs: localMtime(location.directory, file),
    }),
    write: async (file, text) => {
      await context.client.file.write({ location, path: file, payload: new TextEncoder().encode(text) })
    },
  }
}

/**
 * `client.file.read` answers with bytes only, so the mtime of a note on this machine comes from
 * the host filesystem. A location that is not local has no mtime to compare, and the byte
 * comparison of the save check carries the whole check there.
 */
function localMtime(directory: string, file: string) {
  return statSync(path.join(directory, file), { throwIfNoEntry: false })?.mtimeMs ?? 0
}

/** The route body: it reads the host markdown renderer, so the page itself stays free of it. */
function NotesRoute(props: { context: Plugin.Context }) {
  return <NotesPage context={props.context} markdown={usePlugin().markdown} />
}

function noteLocation(context: Plugin.Context, sessionID: string | undefined) {
  const fallback = context.data.location.default()
  if (!sessionID) return fallback
  return context.data.session.get(sessionID)?.location ?? fallback
}

function routeData(context: Plugin.Context): RouteData {
  const route = context.ui.router.current()
  if (route.type !== "plugin") return {}
  return (route.data ?? {}) as RouteData
}

function footerLine(mode: Mode, shortcut: (id: string) => string | undefined) {
  if (mode === "list") return joinHints([hint(shortcut, "notes.view", "open"), hint(shortcut, "notes.back", "back")])
  if (mode === "view") return joinHints([hint(shortcut, "notes.edit", "edit"), hint(shortcut, "notes.back", "list")])
  return joinHints([hint(shortcut, "notes.save", "save"), hint(shortcut, "notes.back", "cancel")])
}

function hint(shortcut: (id: string) => string | undefined, id: string, label: string) {
  const key = shortcut(id)
  if (!key) return undefined
  return `${key} ${label}`
}

function joinHints(parts: (string | undefined)[]) {
  return parts.filter((part): part is string => part !== undefined).join(" · ")
}

const stampFormat = new Intl.DateTimeFormat("en-US", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

function stamp(updated: number) {
  if (!updated) return "—"
  return stampFormat.format(new Date(updated))
}

function statusColor(theme: ReturnType<typeof useTheme>, row: NoteRow) {
  if (!row.parsed) return theme.text.feedback.warning.base
  if (row.status === "done" || row.status === "archived") return theme.text.muted
  return theme.text.action.secondary.base
}

export default Plugin.define({
  id: "opencode.notes",
  setup(context) {
    const open = (sessionID?: string) => {
      const route = context.ui.router.current()
      if (route.type === "plugin" && route.name === ROUTE) return
      // The router exposes a mutable store, so the route is copied before it is replaced.
      context.ui.dialog.clear()
      context.ui.router.navigate({
        type: "plugin",
        name: ROUTE,
        data: { returnRoute: { ...route }, ...(sessionID ? { sessionID } : {}) },
      })
    }
    context.ui.router.register({
      name: ROUTE,
      render: () => <NotesRoute context={context} />,
    })
    context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "notes.open",
              title: "Notes",
              description: "Browse and edit the notes of this project",
              group: GROUP,
              slash: { name: "notes" },
              palette: true,
              run() {
                const route = context.ui.router.current()
                open(route.type === "session" ? route.sessionID : undefined)
              },
            },
          ],
        }))
        return null
      },
    })
    context.ui.slot({
      append: "session.composer.top",
      render: (input) => (
        <box flexDirection="row" justifyContent="flex-end">
          <NotesAction label="notes" onClick={() => open(input.sessionID)} />
        </box>
      ),
    })
  },
})
