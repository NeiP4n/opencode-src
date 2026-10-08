import { isNoteConflictError, type NoteInfo } from "@opencode/client"
import { createSignal, For, onCleanup } from "solid-js"
import { useData } from "../context/data"
import { useNotes } from "../context/notes"
import { usePromptRef } from "../context/prompt"
import { useTheme } from "../context/theme"
import { usePlugin } from "../plugin/context"
import { emptyPrompt } from "../prompt/history"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { noteTitle } from "../util/note"
import { NoteDocument } from "./note-document"
import { RoomIndicator } from "./room-indicator"

// The bound note of a session, shown as the main document beside its chat.
export function NoteCanvas(props: { sessionID: string; note: NoteInfo; directory: string }) {
  const notes = useNotes()
  const data = useData()
  const toast = useToast()
  const plugins = usePlugin()
  const now = useNow()
  const fail = (error: unknown) => toast.show({ variant: "error", message: errorMessage(error) })
  const update = (patch: Parameters<typeof notes.update>[2]) =>
    void notes.update(props.directory, props.note, patch).catch(fail)

  return (
    <NoteDocument
      note={props.note}
      now={now()}
      writing={data.session.status(props.sessionID) === "running"}
      indicator={<RoomIndicator sessionID={props.sessionID} />}
      renderNode={plugins.markdown()}
      onLength={(length) => update({ length })}
      onStatus={(status) => update({ status })}
      onRename={(title) => update({ title })}
      onTags={(tags) => update({ tags })}
      onChat={() => notes.setChat(props.sessionID, true)}
      onSave={(body, expectedMtime) =>
        notes.save(props.directory, props.note, body, expectedMtime).then(
          () => "saved" as const,
          (error: unknown) => {
            if (!isNoteConflictError(error)) {
              fail(error)
              return "failed" as const
            }
            // Refresh so the warning can offer the version that won.
            notes.reload(props.directory)
            return "conflict" as const
          },
        )
      }
    />
  )
}

const QUICK_ACTIONS = [
  { label: "Continue writing", prompt: "Continue writing the note from where it ends." },
  { label: "Summarize", prompt: "Add a short summary at the top of the note." },
  { label: "Improve", prompt: "Improve the note: clearer structure and wording, same meaning." },
  { label: "Outline", prompt: "Turn the note into a clear outline with headings and bullet points." },
]

// Prompts that write into the bound note. They only fill the composer; nothing
// is sent until the user submits, so they are safe to click.
export function NoteQuickActions(props: { note: NoteInfo }) {
  const theme = useTheme()
  const prompt = usePromptRef()
  const [hovered, setHovered] = createSignal<string>()
  return (
    <box flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={2} paddingRight={1}>
      <text fg={theme.text.muted} wrapMode="none">
        {`✎ ${noteTitle(props.note)}:`}
      </text>
      <For each={QUICK_ACTIONS}>
        {(action) => (
          <box
            flexShrink={0}
            onMouseOver={() => setHovered(action.label)}
            onMouseOut={() => setHovered()}
            onMouseUp={() => {
              prompt.current?.set({ ...emptyPrompt(), text: action.prompt })
              prompt.current?.focus()
            }}
          >
            <text
              fg={hovered() === action.label ? theme.text.action.secondary.hovered : theme.text.action.secondary.base}
              wrapMode="none"
            >
              {action.label}
            </text>
          </box>
        )}
      </For>
    </box>
  )
}

// In the full chat view of a session bound to a note: the way back to the note.
export function NoteChip(props: { sessionID: string; note: NoteInfo }) {
  const theme = useTheme()
  const notes = useNotes()
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      id="session-note-chip"
      flexShrink={1}
      minWidth={0}
      paddingRight={2}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={() => {
        notes.setTab("notes")
        notes.setChat(props.sessionID, false)
      }}
    >
      <text
        fg={hovered() ? theme.text.action.secondary.hovered : theme.text.action.secondary.base}
        wrapMode="none"
        truncate
      >
        {`✎ Note: ${noteTitle(props.note)} · open`}
      </text>
    </box>
  )
}

// Ages in the notes UI move on their own; a minute is fine-grained enough.
export function useNow() {
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 30_000)
  timer.unref?.()
  onCleanup(() => clearInterval(timer))
  return now
}
