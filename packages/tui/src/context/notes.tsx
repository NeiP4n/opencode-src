import { isNoteConflictError, type NoteInfo, type NoteLength, type NoteStatus } from "@opencode/client"
import { createSignal, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { errorMessage } from "../util/error"
import { useClient } from "./client"
import { useData } from "./data"
import { createSimpleContext } from "./helper"
import { useRoute } from "./route"
import { useStorage } from "./storage"

export type NotesTab = "projects" | "notes"

type Listing = { notes: NoteInfo[]; error?: string }

// Notes of every directory a view asked for, kept fresh from the note.updated
// events of the server so a note the AI is writing updates while it is open.
// The left panel tab and the note-or-chat choice per session live here too,
// because the panel, the session frame and the commands all read them.
export const { use: useNotes, provider: NotesProvider } = createSimpleContext({
  name: "Notes",
  init: () => {
    const client = useClient()
    const data = useData()
    const route = useRoute()
    const [panel, updatePanel] = useStorage().store<{ tab?: NotesTab; project?: string }>("notes-panel", {
      initial: {},
    })
    // Sessions whose bound note the user put aside to read the full chat.
    const [chat, setChat] = createStore<Record<string, boolean>>({})
    const [listings, setListings] = createStore<Record<string, Listing>>({})
    // The "new note" field of the panel, opened by its button or by the palette.
    const [creating, setCreating] = createSignal(false)
    const requested = new Set<string>()
    const inflight = new Set<string>()
    // A write that lands while a listing is in flight must not be lost, so it re-reads once more.
    const stale = new Set<string>()

    const load = (directory: string) => {
      requested.add(directory)
      if (inflight.has(directory)) return void stale.add(directory)
      inflight.add(directory)
      void client.api.note
        .list({ location: { directory } })
        .then(
          (result) => setListings(directory, { notes: [...result.data], error: undefined }),
          (error: unknown) =>
            setListings(directory, { notes: listings[directory]?.notes ?? [], error: errorMessage(error) }),
        )
        .finally(() => {
          inflight.delete(directory)
          if (stale.delete(directory)) load(directory)
        })
    }

    const reloadAll = () => [...requested].forEach(load)

    onCleanup(
      client.event.on("note.updated", (event) => {
        const matching = [...requested].filter((directory) => directory === event.location?.directory)
        // The event names the location the server resolved; when it is not one this client keys
        // its listings by, every listing re-reads rather than miss the change.
        ;(matching.length ? matching : [...requested]).forEach(load)
      }),
    )
    onCleanup(client.event.on("server.connected", reloadAll))

    const upsert = (directory: string, note: NoteInfo) =>
      setListings(
        produce((draft) => {
          const listing = draft[directory] ?? { notes: [] }
          listing.notes = [note, ...listing.notes.filter((item) => item.name !== note.name)]
          draft[directory] = listing
        }),
      )

    const list = (directory: string) => {
      if (!requested.has(directory)) {
        requested.add(directory)
        queueMicrotask(() => load(directory))
      }
      return listings[directory]?.notes ?? []
    }

    const bound = (sessionID: string) => {
      const session = data.session.get(sessionID)
      if (!session) return
      // Newest first, like the server's own binding lookup when several notes claim a chat.
      return list(session.location.directory).find((note) => note.frontmatter.session === sessionID)
    }

    // Metadata changes carry intent, not text, so a note the AI rewrote meanwhile
    // takes the change on top of its latest version instead of refusing it.
    const update = async (
      directory: string,
      note: NoteInfo,
      patch: { title?: string; status?: NoteStatus; tags?: string[]; length?: NoteLength },
    ) => {
      const location = { directory }
      const result = await client.api.note
        .update({ location, name: note.name, ...patch, expectedMtime: note.mtime })
        .catch(async (error: unknown) => {
          if (!isNoteConflictError(error)) throw error
          const latest = await client.api.note.get({ location, name: note.name })
          return client.api.note.update({ location, name: note.name, ...patch, expectedMtime: latest.data.mtime })
        })
      upsert(directory, result.data)
      return result.data
    }

    const link = async (directory: string, note: NoteInfo, session: string | undefined) => {
      const result = await client.api.note.link({
        location: { directory },
        name: note.name,
        session,
        expectedMtime: note.mtime,
      })
      upsert(directory, result.data)
      return result.data
    }

    const setTab = (tab: NotesTab) => void updatePanel((draft) => void (draft.tab = tab)).catch(() => undefined)

    // The chat of a note is the session its frontmatter names. A note without one, or
    // whose session is gone, gets a new session in its directory bound to it, so the
    // AI of that chat writes into the note from the first prompt.
    const open = async (directory: string, note: NoteInfo) => {
      const sessionID = (await existingSession(note.frontmatter.session)) ?? (await bindNewSession(directory, note))
      setChat(sessionID, false)
      setTab("notes")
      route.navigate({ type: "session", sessionID })
    }

    // A new note starts with its own chat, so the first prompt already writes into it.
    const start = async (directory: string, title: string) => {
      const created = data.session.create({ title, location: { directory } })
      await created.request
      const result = await client.api.note.create({ location: { directory }, title, session: created.id })
      upsert(directory, result.data)
      setChat(created.id, false)
      setTab("notes")
      route.navigate({ type: "session", sessionID: created.id })
    }

    const existingSession = async (sessionID: string | undefined) => {
      if (!sessionID) return
      if (data.session.get(sessionID)) return sessionID
      const session = await client.api.session.get({ sessionID }).catch(() => undefined)
      if (!session) return
      data.session.remember(session)
      return sessionID
    }

    const bindNewSession = async (directory: string, note: NoteInfo) => {
      const created = data.session.create({ title: note.frontmatter.title || note.name, location: { directory } })
      await created.request
      await link(directory, note, created.id)
      return created.id
    }

    const tab = () => panel.tab ?? "projects"

    return {
      tab,
      setTab,
      creating,
      setCreating,
      open,
      start,
      project: () => panel.project,
      setProject: (projectID: string) =>
        void updatePanel((draft) => void (draft.project = projectID)).catch(() => undefined),
      chat: (sessionID: string) => chat[sessionID] === true,
      setChat: (sessionID: string, value: boolean) => setChat(sessionID, value),
      list,
      error: (directory: string) => listings[directory]?.error,
      loaded: (directory: string) => listings[directory] !== undefined,
      reload: load,
      bound,
      // The note a session shows as its document: bound, in Notes mode, and not put aside for the chat.
      canvas: (sessionID: string) => (tab() === "notes" && !chat[sessionID] ? bound(sessionID) : undefined),
      async create(directory: string, input: { title: string; body?: string; length?: NoteLength; session?: string }) {
        const result = await client.api.note.create({ location: { directory }, ...input })
        upsert(directory, result.data)
        return result.data
      },
      async save(directory: string, note: NoteInfo, body: string, expectedMtime: NoteInfo["mtime"] = note.mtime) {
        const result = await client.api.note.edit({ location: { directory }, name: note.name, body, expectedMtime })
        upsert(directory, result.data)
        return result.data
      },
      async get(directory: string, name: string) {
        const result = await client.api.note.get({ location: { directory }, name })
        upsert(directory, result.data)
        return result.data
      },
      update,
      link,
      async remove(directory: string, note: NoteInfo) {
        await client.api.note.remove({ location: { directory }, name: note.name, expectedMtime: Number(note.mtime) })
        setListings(directory, "notes", (notes) => notes.filter((item) => item.name !== note.name))
      },
    }
  },
})
