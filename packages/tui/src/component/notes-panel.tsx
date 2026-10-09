import { TextAttributes, type InputRenderable, type KeyEvent } from "@opentui/core"
import type { NoteInfo, NoteStatus } from "@opencode/client"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useConfig } from "../config"
import { useTheme } from "../context/theme"
import { ago, matchesNote, NOTE_STATUS_MARKER, noteTitle } from "../util/note"
import { Row } from "./panel-row"

export type NotesPanelProject = { readonly id: string; readonly name: string }

// The Notes mode of the left panel: the notes of one project, newest first, with a
// filter, an inline "new note" field and a two-click delete. It only renders and
// reports intent; the caller owns the notes API.
export function NotesPanel(props: {
  project?: NotesPanelProject
  projects: readonly NotesPanelProject[]
  notes: readonly NoteInfo[]
  loaded: boolean
  error?: string
  openName?: string
  now: number
  creating: boolean
  onCreating: (creating: boolean) => void
  onPickProject: (projectID: string) => void
  onOpen: (note: NoteInfo) => void
  onCreate: (title: string) => void
  onRemove: (note: NoteInfo) => void
}) {
  const theme = useTheme()
  const config = useConfig().data
  const [hover, setHover] = createSignal<string>()
  const [filter, setFilter] = createSignal("")
  const [picking, setPicking] = createSignal(false)
  // Deleting is permanent, so the first click only arms the button and the second deletes.
  const [armed, setArmed] = createSignal<string>()
  let field: InputRenderable | undefined
  const visible = createMemo(() => props.notes.filter((note) => matchesNote(note, filter())))

  const create = (value: string) => {
    const title = value.trim()
    if (!title) return
    props.onCreating(false)
    props.onCreate(title)
  }

  const remove = (note: NoteInfo) => {
    if (armed() !== note.name) return setArmed(note.name)
    setArmed()
    props.onRemove(note)
  }

  return (
    <box flexGrow={1} minHeight={0}>
      <Row
        id="notes:project"
        hover={hover}
        setHover={setHover}
        onClick={() => props.projects.length > 1 && setPicking((value) => !value)}
      >
        <text fg={theme.text.muted}>{props.projects.length > 1 ? (picking() ? "▾ " : "▸ ") : "  "}</text>
        <box flexGrow={1} minWidth={0}>
          <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
            {props.project?.name ?? "No project"}
          </text>
        </box>
        <text fg={theme.text.muted} wrapMode="none">
          {props.loaded ? `${props.notes.length} ${props.notes.length === 1 ? "note" : "notes"}` : "loading…"}
        </text>
      </Row>
      <Show when={picking()}>
        <For each={props.projects}>
          {(project) => (
            <Row
              id={`notes:project:${project.id}`}
              hover={hover}
              setHover={setHover}
              selected={project.id === props.project?.id}
              onClick={() => {
                setPicking(false)
                props.onPickProject(project.id)
              }}
            >
              <text fg={theme.text.formfield.base} wrapMode="none" truncate>
                {`    ${project.name}`}
              </text>
            </Row>
          )}
        </For>
      </Show>
      <Show when={props.creating}>
        <box flexDirection="row" paddingLeft={1} paddingRight={1}>
          <text fg={theme.text.action.primary.base}>{"+ "}</text>
          <input
            flexGrow={1}
            placeholder="Note title, enter to create"
            placeholderColor={theme.text.muted}
            textColor={theme.text.formfield.base}
            focusedTextColor={theme.text.formfield.focused}
            cursorColor={theme.text.formfield.focused}
            backgroundColor={theme.background.formfield.base}
            focusedBackgroundColor={theme.background.formfield.focused}
            cursorStyle={config.cursor}
            ref={(element: InputRenderable) => {
              field = element
              setTimeout(() => !element.isDestroyed && element.focus(), 1)
            }}
            onSubmit={() => create(field?.value ?? "")}
            onKeyDown={(event: KeyEvent) => {
              if (event.name !== "escape") return
              event.preventDefault()
              props.onCreating(false)
            }}
          />
        </box>
      </Show>
      <Show when={props.notes.length > 0}>
        <box flexDirection="row" paddingLeft={1} paddingRight={1}>
          <text fg={theme.text.muted}>{"⌕ "}</text>
          <input
            flexGrow={1}
            placeholder="Filter by title or #tag"
            placeholderColor={theme.text.muted}
            textColor={theme.text.formfield.base}
            focusedTextColor={theme.text.formfield.focused}
            cursorColor={theme.text.formfield.focused}
            focusedBackgroundColor={theme.background.formfield.focused}
            cursorStyle={config.cursor}
            onInput={(value: string) => setFilter(value)}
          />
        </box>
      </Show>
      <box height={1} />
      {/* The chat of a note is bound to it, so the model writes there and nowhere else. */}
      <box paddingLeft={2} paddingRight={1}>
        <text fg={theme.text.muted} wrapMode="word">
          This chat writes into the selected note only.
        </text>
      </box>
      <scrollbox flexGrow={1} minHeight={0} horizontalScrollbarOptions={{ visible: false }}>
        <For each={visible()}>
          {(note) => (
            <Row
              id={`note:${note.name}`}
              hover={hover}
              setHover={setHover}
              selected={note.name === props.openName}
              onClick={() => props.onOpen(note)}
            >
              <text
                fg={statusColor(theme, note.frontmatter.status)}
              >{`${NOTE_STATUS_MARKER[note.frontmatter.status]} `}</text>
              <box flexGrow={1} minWidth={0}>
                <text fg={theme.text.base} wrapMode="none" truncate>
                  {noteTitle(note)}
                </text>
              </box>
              <text fg={theme.text.muted} wrapMode="none">{` ${ago(note.frontmatter.updated, props.now)}`}</text>
              <box
                onMouseOut={() => setArmed()}
                onMouseUp={(event) => {
                  event.stopPropagation()
                  remove(note)
                }}
              >
                <text
                  fg={
                    armed() === note.name
                      ? theme.text.action.destructive.base
                      : hover() === `note:${note.name}`
                        ? theme.text.action.destructive.hovered
                        : theme.text.muted
                  }
                  wrapMode="none"
                >
                  {armed() === note.name ? " delete?" : " ×"}
                </text>
              </box>
            </Row>
          )}
        </For>
        <Show when={props.error}>
          {(error) => (
            <box paddingLeft={2} paddingRight={1}>
              <text fg={theme.text.feedback.error.base} wrapMode="word">{`Could not read notes: ${error()}`}</text>
            </box>
          )}
        </Show>
        <Show when={props.loaded && !props.error && props.notes.length === 0 && !props.creating}>
          <box paddingLeft={2} paddingRight={1} gap={1}>
            <text fg={theme.text.muted} wrapMode="word">
              No notes yet.
            </text>
            <Row id="notes:empty-new" hover={hover} setHover={setHover} onClick={() => props.onCreating(true)}>
              <text
                fg={hover() === "notes:empty-new" ? theme.text.action.primary.hovered : theme.text.action.primary.base}
              >
                + New note
              </text>
            </Row>
            <text fg={theme.text.muted} wrapMode="word">
              or ask the AI in any chat of this project to write one.
            </text>
          </box>
        </Show>
        <Show when={props.notes.length > 0 && visible().length === 0}>
          <box paddingLeft={2} paddingRight={1}>
            <text fg={theme.text.muted} wrapMode="word">{`No notes match "${filter().trim()}".`}</text>
          </box>
        </Show>
      </scrollbox>
    </box>
  )
}

// Note status is status feedback: active work reads as info, finished work as success.
function statusColor(theme: ReturnType<typeof useTheme>, status: NoteStatus) {
  if (status === "active") return theme.text.feedback.info.base
  if (status === "done") return theme.text.feedback.success.base
  return theme.text.muted
}
