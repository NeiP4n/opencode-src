import { useData } from "../context/data"
import { Keymap } from "../context/keymap"
import { useNotes } from "../context/notes"
import { useProjects } from "../context/projects"
import { useRoute } from "../context/route"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { useT } from "../util/i18n"
import { NOTE_LENGTHS, noteLength } from "../util/note"

const GROUP = "Notes"

// Palette and slash entries of the notes: they work on the left panel and on the
// note bound to the open session, wherever the keyboard is.
export function NotesCommands() {
  const notes = useNotes()
  const t = useT()
  const data = useData()
  const route = useRoute()
  const dialog = useDialog()
  const toast = useToast()
  const projects = useProjects()
  const sessionID = () => (route.data.type === "session" ? route.data.sessionID : undefined)
  const bound = () => {
    const id = sessionID()
    return id ? notes.bound(id) : undefined
  }

  const show = () => {
    dialog.clear()
    if (projects.list().length === 0)
      return void toast.show({
        variant: "info",
        message: t("Notes live in projects. Create a project first with {command}.", {
          command: t("+ Project"),
        }),
      })
    notes.setTab("notes")
    const id = sessionID()
    if (id) notes.setChat(id, false)
  }

  const setLength = (length: (typeof NOTE_LENGTHS)[number]["value"]) => {
    dialog.clear()
    const note = bound()
    const session = data.session.get(sessionID() ?? "")
    if (!note || !session) return
    void notes
      .update(session.location.directory, note, { length })
      .catch((error: unknown) => toast.show({ variant: "error", message: errorMessage(error) }))
  }

  const toggle = () => {
    dialog.clear()
    const id = sessionID()
    if (!id) return
    if (notes.canvas(id)) return notes.setChat(id, true)
    notes.setTab("notes")
    notes.setChat(id, false)
  }

  Keymap.createLayer(() => {
    const id = sessionID()
    const note = bound()
    return {
      mode: "global",
      commands: [
        {
          id: "notes.open",
          title: "Notes",
          description: t("Show the notes of the project; a chat bound to a note shows it as its document"),
          group: GROUP,
          slash: { name: "notes" },
          palette: true,
          run: show,
        },
        {
          id: "notes.new",
          title: t("New note"),
          group: GROUP,
          palette: true,
          run: () => {
            show()
            notes.setCreating(true)
          },
        },
        {
          id: "notes.view.toggle",
          title: t(id && notes.canvas(id) ? "Show full chat" : "Show bound note"),
          group: GROUP,
          palette: true,
          enabled: note !== undefined,
          run: toggle,
        },
        ...NOTE_LENGTHS.map((length) => ({
          id: `notes.length.${length.value}`,
          title: t("Note length: {length}", { length: t(length.label) }),
          description: t("How much the AI writes into the note bound to this chat"),
          group: GROUP,
          palette: true as const,
          enabled: note !== undefined && noteLength(note) !== length.value,
          run: () => setLength(length.value),
        })),
      ],
    }
  })
  return null
}
