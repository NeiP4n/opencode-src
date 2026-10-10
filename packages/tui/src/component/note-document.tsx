import { TextAttributes, type InputRenderable, type MarkdownOptions, type TextareaRenderable } from "@opentui/core"
import type { NoteInfo, NoteLength, NoteStatus } from "@opencode/client"
import { createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import { useConfig } from "../config"
import { Keymap } from "../context/keymap"
import { useTheme, useThemes } from "../context/theme"
import { getScrollAcceleration } from "../util/scroll"
import { useT } from "../util/i18n"
import {
  ago,
  NOTE_LENGTHS,
  NOTE_STATUS_LABEL,
  NOTE_STATUS_MARKER,
  nextStatus,
  noteLength,
  noteTitle,
  parseTags,
} from "../util/note"

export type NoteSaveResult = "saved" | "conflict" | "failed"

type Mode = "view" | "edit" | "title" | "tags"

const GROUP = "Note"

// A note shown as the document of its chat (a canvas): title, status, tags, how
// much the AI writes, the rendered body, and an editor. It renders and reports
// intent; the caller owns the notes API, so a story can drive it with fixtures.
export function NoteDocument(props: {
  note: NoteInfo
  now: number
  writing?: boolean
  indicator?: JSX.Element
  renderNode?: MarkdownOptions["renderNode"]
  onLength: (length: NoteLength) => void
  onStatus: (status: NoteStatus) => void
  onRename: (title: string) => void
  onTags: (tags: string[]) => void
  onSave: (body: string, expectedMtime: NoteInfo["mtime"]) => Promise<NoteSaveResult>
  onChat?: () => void
}) {
  const theme = useTheme()
  const { currentSyntax: syntax } = useThemes()
  const config = useConfig().data
  const t = useT()
  const [mode, setMode] = createSignal<Mode>("view")
  // The version the editor started from: a save is refused when the note moved past it.
  const [base, setBase] = createSignal<NoteInfo["mtime"]>(0)
  const [conflict, setConflict] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [notice, setNotice] = createSignal<string>()
  let editor: TextareaRenderable | undefined

  const changed = () => mode() === "edit" && (conflict() || props.note.mtime !== base())

  // "ago" rides along the age rather than the number, so a language that puts the
  // unit first gets its own word order instead of a glued-together English one.
  const updatedLabel = () => {
    const age = ago(props.note.frontmatter.updated, props.now)
    return age === "now" ? t("updated {age}", { age }) : t("updated {age} ago", { age })
  }

  const edit = () => {
    setBase(props.note.mtime)
    setConflict(false)
    setNotice()
    setMode("edit")
  }

  const cancel = () => {
    setConflict(false)
    setNotice()
    setMode("view")
  }

  const save = async (expectedMtime = base()) => {
    if (!editor || saving()) return
    setSaving(true)
    const result = await props.onSave(editor.plainText, expectedMtime).finally(() => setSaving(false))
    if (result === "saved") return cancel()
    if (result === "conflict") return void setConflict(true)
    setNotice(t("Could not save the note. Your text is still here; try again."))
  }

  // Reloading takes the latest version into the editor, explicitly chosen by the user.
  const reload = () => {
    editor?.replaceText(props.note.body)
    setBase(props.note.mtime)
    setConflict(false)
  }

  const rename = (value: string) => {
    const title = value.trim()
    setMode("view")
    if (title && title !== props.note.frontmatter.title) props.onRename(title)
  }

  const retag = (value: string) => {
    const parsed = parseTags(value)
    setMode("view")
    setNotice(
      parsed.invalid.length
        ? t("Skipped {tags}: tags are lowercase latin letters, digits and hyphens.", {
            tags: parsed.invalid.map((tag) => `"${tag}"`).join(", "),
          })
        : undefined,
    )
    props.onTags(parsed.tags)
  }

  Keymap.createLayer(() => ({
    mode: "global",
    enabled: () => mode() === "view",
    commands: [{ id: "note.edit", title: "Edit note", group: GROUP, palette: true, run: edit }],
  }))

  // One handler for the editor keys: the layer outranks the composer and the session
  // bindings while a field of the note has the keyboard.
  Keymap.createLayer(() => ({
    mode: "global",
    priority: 1,
    enabled: () => mode() !== "view",
    commands: [
      { id: "note.editor.cancel", title: "Cancel", group: GROUP, bind: "escape", run: cancel },
      {
        id: "note.editor.save",
        title: "Save note",
        group: GROUP,
        bind: "ctrl+s",
        enabled: () => mode() === "edit",
        run: () => void save(),
      },
    ],
  }))

  return (
    <box flexGrow={1} minWidth={0} minHeight={0} backgroundColor={theme.background.base}>
      <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1} gap={0}>
        <box flexDirection="row" gap={2}>
          <box flexGrow={1} minWidth={0}>
            <Show
              when={mode() === "title"}
              fallback={
                <Action id="note-title" onClick={() => setMode("title")} tone="plain">
                  <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                    {noteTitle(props.note)}
                  </text>
                </Action>
              }
            >
              <Field value={props.note.frontmatter.title} placeholder={t("Note title")} onSubmit={rename} />
            </Show>
          </box>
          <Show when={mode() !== "edit"}>
            <Action id="note-edit" onClick={edit}>
              {t("✎ Edit")}
            </Action>
          </Show>
          <Show when={props.onChat}>
            {(onChat) => (
              <Action id="note-chat" onClick={onChat()}>
                {t("⇤ Chat")}
              </Action>
            )}
          </Show>
        </box>
        <box flexDirection="row" flexWrap="wrap" columnGap={2}>
          <Action
            id="note-status"
            tone="formfield"
            onClick={() => props.onStatus(nextStatus(props.note.frontmatter.status))}
          >
            {`${NOTE_STATUS_MARKER[props.note.frontmatter.status]} ${t(NOTE_STATUS_LABEL[props.note.frontmatter.status])}`}
          </Action>
          <Show
            when={mode() === "tags"}
            fallback={
              <Action id="note-tags" tone="formfield" onClick={() => setMode("tags")}>
                {props.note.frontmatter.tags.length
                  ? props.note.frontmatter.tags.map((tag) => `#${tag}`).join(" ")
                  : t("+ tags")}
              </Action>
            }
          >
            <box width={30}>
              <Field
                value={props.note.frontmatter.tags.join(" ")}
                placeholder={t("tags, space separated")}
                onSubmit={retag}
              />
            </box>
          </Show>
          <text fg={theme.text.muted} wrapMode="none">
            {updatedLabel()}
          </text>
          {props.indicator}
        </box>
        <box flexDirection="row" flexWrap="wrap" columnGap={1} paddingTop={1}>
          <text fg={theme.text.muted} wrapMode="none">
            {t("Length")}
          </text>
          <For each={NOTE_LENGTHS}>
            {(length) => (
              <Segment
                id={`note-length-${length.value}`}
                selected={noteLength(props.note) === length.value}
                onClick={() => noteLength(props.note) !== length.value && props.onLength(length.value)}
              >
                {t(length.label)}
              </Segment>
            )}
          </For>
        </box>
      </box>
      <box
        flexShrink={0}
        height={1}
        marginLeft={2}
        marginRight={2}
        border={["bottom"]}
        borderColor={theme.border.base}
      />
      <Show when={changed()}>
        <box flexShrink={0} flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={2} paddingRight={2}>
          <text fg={theme.text.feedback.warning.base} wrapMode="word">
            {conflict()
              ? t("Not saved: this note changed since you started editing. Your text is kept.")
              : t("This note changed while you were editing. Your text is kept.")}
          </text>
          <Action id="note-reload" onClick={reload}>
            {t("Reload latest")}
          </Action>
          <Action id="note-overwrite" tone="destructive" onClick={() => void save(props.note.mtime)}>
            {t("Overwrite with mine")}
          </Action>
        </box>
      </Show>
      <Show when={notice()}>
        {(text) => (
          <box flexShrink={0} paddingLeft={2} paddingRight={2}>
            <text fg={theme.text.feedback.warning.base} wrapMode="word">
              {text()}
            </text>
          </box>
        )}
      </Show>
      <Switch>
        <Match when={mode() === "edit"}>
          <box flexGrow={1} minHeight={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
            <textarea
              width="100%"
              flexGrow={1}
              wrapMode="word"
              initialValue={props.note.body}
              placeholder={t("Write in markdown")}
              placeholderColor={theme.text.muted}
              textColor={theme.text.formfield.base}
              focusedTextColor={theme.text.formfield.focused}
              cursorColor={theme.text.formfield.focused}
              backgroundColor={theme.background.formfield.base}
              focusedBackgroundColor={theme.background.formfield.focused}
              cursorStyle={config.cursor}
              ref={(element: TextareaRenderable) => {
                editor = element
                setTimeout(() => !element.isDestroyed && element.focus(), 1)
              }}
            />
          </box>
        </Match>
        <Match when={props.note.body.trim().length === 0}>
          <box flexGrow={1} paddingLeft={2} paddingRight={2} paddingTop={1} gap={1}>
            <text fg={theme.text.muted} wrapMode="word">
              {t("This note is empty.")}
            </text>
            <text fg={theme.text.muted} wrapMode="word">
              {t("Ask the AI to write it here, or press ✎ Edit to start writing yourself.")}
            </text>
          </box>
        </Match>
        <Match when={true}>
          <scrollbox
            flexGrow={1}
            minHeight={0}
            stickyScroll={props.writing}
            stickyStart="bottom"
            scrollAcceleration={getScrollAcceleration(config)}
            horizontalScrollbarOptions={{ visible: false }}
          >
            <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
              <markdown
                syntaxStyle={syntax()}
                renderNode={props.renderNode}
                content={props.note.body}
                streaming={props.writing === true}
                conceal
                internalBlockMode="top-level"
                tableOptions={{ style: "grid", cellPaddingX: 1 }}
                fg={theme.markdown.text}
                bg={theme.background.base}
              />
            </box>
          </scrollbox>
        </Match>
      </Switch>
      <box flexShrink={0} flexDirection="row" paddingLeft={2} paddingRight={2}>
        <text fg={theme.text.muted} wrapMode="none" truncate>
          {mode() === "edit"
            ? saving()
              ? t("Saving…")
              : t("ctrl+s save · esc cancel")
            : mode() === "view"
              ? props.writing
                ? t("The AI is writing into this note…")
                : t("Ask in the chat and the AI writes into this note")
              : t("enter save · esc cancel")}
        </text>
      </box>
    </box>
  )
}

// A clickable label. Actions read as actions; formfield tone is for values the
// user changes in place, like the status and the tags.
function Action(props: {
  id: string
  onClick: () => void
  tone?: "action" | "formfield" | "destructive" | "plain"
  children: JSX.Element
}) {
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)
  const color = () => {
    const state = hovered() ? "hovered" : "base"
    if (props.tone === "formfield") return theme.text.formfield[state]
    if (props.tone === "destructive") return theme.text.action.destructive[state]
    return theme.text.action.primary[state]
  }
  return (
    <box
      id={props.id}
      flexShrink={0}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        event.stopPropagation()
        props.onClick()
      }}
    >
      <Show
        when={props.tone === "plain"}
        fallback={
          <text fg={color()} wrapMode="none">
            {props.children}
          </text>
        }
      >
        {props.children}
      </Show>
    </box>
  )
}

// One option of the length control; the selected one carries the formfield selection state.
function Segment(props: { id: string; selected: boolean; onClick: () => void; children: string }) {
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)
  const state = () => (props.selected ? "selected" : hovered() ? "hovered" : "base")
  return (
    <box
      id={props.id}
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.selected || hovered() ? theme.background.formfield[state()] : undefined}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        event.stopPropagation()
        props.onClick()
      }}
    >
      <text
        fg={theme.text.formfield[state()]}
        attributes={props.selected ? TextAttributes.BOLD : undefined}
        wrapMode="none"
      >
        {props.selected ? `● ${props.children}` : `○ ${props.children}`}
      </text>
    </box>
  )
}

function Field(props: { value: string; placeholder: string; onSubmit: (value: string) => void }) {
  const theme = useTheme()
  const config = useConfig().data
  let input: InputRenderable | undefined
  return (
    <input
      flexGrow={1}
      value={props.value}
      placeholder={props.placeholder}
      placeholderColor={theme.text.muted}
      textColor={theme.text.formfield.base}
      focusedTextColor={theme.text.formfield.focused}
      cursorColor={theme.text.formfield.focused}
      backgroundColor={theme.background.formfield.base}
      focusedBackgroundColor={theme.background.formfield.focused}
      cursorStyle={config.cursor}
      ref={(element: InputRenderable) => {
        input = element
        setTimeout(() => !element.isDestroyed && element.focus(), 1)
      }}
      onSubmit={() => props.onSubmit(input?.value ?? "")}
    />
  )
}
