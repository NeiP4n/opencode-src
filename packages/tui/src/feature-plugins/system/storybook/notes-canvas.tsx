import type { Plugin } from "@opencode/plugin/tui"
import type { NoteInfo } from "@opencode/client"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { batch, createSignal, onCleanup, Show } from "solid-js"
import { NoteDocument } from "../../../component/note-document"
import { NotesPanel } from "../../../component/notes-panel"
import { MultiplayerBadge } from "../../../component/room-indicator"
import { usePlugin } from "../../../plugin/context"
import { SESSION_SIDEBAR_WIDTH } from "../../../ui/layout"
import type { Story } from "./index"
import { StoryFooter } from "./footer"

const NOW = Date.now()

function fixtures(): NoteInfo[] {
  return [
    {
      name: "release-plan",
      frontmatter: {
        title: "Release plan for the notes canvas",
        status: "active",
        tags: ["release", "q4"],
        length: "detailed",
        session: "ses_story",
        created: NOW - 86_400_000,
        updated: NOW - 120_000,
      },
      body: [
        "# Goals",
        "",
        "Ship notes as a canvas beside the chat, so the AI writes **into** the document.",
        "",
        "## Scope",
        "",
        "- Projects | Notes switch in the left panel",
        "- Length control: brief, balanced, detailed",
        "- Live updates while the AI or a room guest writes",
      ].join("\n"),
      mtime: 1,
    },
    {
      name: "onboarding-ideas",
      frontmatter: {
        title: "Onboarding ideas",
        status: "inbox",
        tags: ["ux"],
        created: NOW - 3 * 86_400_000,
        updated: NOW - 2 * 86_400_000,
      },
      body: "",
      mtime: 1,
    },
    {
      name: "retro",
      frontmatter: {
        title: "Sprint retro",
        status: "done",
        tags: [],
        created: NOW - 20 * 86_400_000,
        updated: NOW - 12 * 86_400_000,
      },
      body: "Went well: shipping rooms.",
      mtime: 1,
    },
  ]
}

const PROJECTS = [
  { id: "prj_opencode", name: "opencode" },
  { id: "prj_site", name: "website" },
]

const WRITING = [
  "",
  "## Milestones",
  "",
  "1. Panel tabs and the notes list",
  "2. Canvas with the length control",
  "3. Guest view of the room note",
]

// The notes left panel and the note document side by side, driven by fixtures:
// every save, rename and length change stays inside the story.
function NotesCanvasStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const plugins = usePlugin()
  const theme = props.context.theme
  const [notes, setNotes] = createSignal(fixtures())
  const [open, setOpen] = createSignal("release-plan")
  const [project, setProject] = createSignal(PROJECTS[0].id)
  const [empty, setEmpty] = createSignal(false)
  const [multiplayer, setMultiplayer] = createSignal(true)
  const [writing, setWriting] = createSignal(false)
  const [creating, setCreating] = createSignal(false)
  const [message, setMessage] = createSignal("Click notes, the length control, Edit, the status and the tags")
  let step = 0

  const patch = (name: string, change: (note: NoteInfo) => NoteInfo) =>
    setNotes((list) =>
      list.map((note) => {
        if (note.name !== name) return note
        const next = change(note)
        return { ...next, mtime: Number(note.mtime) + 1, frontmatter: { ...next.frontmatter, updated: Date.now() } }
      }),
    )

  // The AI streams a line into the open note every half second while writing is on.
  const timer = setInterval(() => {
    if (!writing()) return
    const line = WRITING[step % WRITING.length]
    step++
    patch(open(), (note) => ({ ...note, body: `${note.body}\n${line}` }))
  }, 500)
  onCleanup(() => clearInterval(timer))

  const current = () => notes().find((note) => note.name === open())
  const visible = () => (empty() ? [] : notes())

  props.context.keymap.layer(() => ({
    // A focused field of the story's components owns the keyboard.
    enabled: () => !renderer.currentFocusedEditor,
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      { bind: "m", title: "Toggle multiplayer", group: "Storybook", run: () => setMultiplayer((value) => !value) },
      { bind: "w", title: "Toggle AI writing", group: "Storybook", run: () => setWriting((value) => !value) },
      { bind: "n", title: "Toggle empty project", group: "Storybook", run: () => setEmpty((value) => !value) },
      {
        bind: "c",
        title: "Change the note elsewhere",
        group: "Storybook",
        run: () => {
          patch(open(), (note) => ({ ...note, body: `${note.body}\n\nEdited by a guest.` }))
          setMessage("The note changed elsewhere; an open editor warns and keeps your text")
        },
      },
      {
        bind: "r",
        title: "Reset",
        group: "Storybook",
        run: () =>
          batch(() => {
            setNotes(fixtures())
            setOpen("release-plan")
            setEmpty(false)
            setMultiplayer(true)
            setWriting(false)
            setCreating(false)
            setMessage("Reset")
          }),
      },
    ],
  }))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background.base}>
      <box flexGrow={1} minHeight={0} flexDirection="row">
        <box width={SESSION_SIDEBAR_WIDTH} flexShrink={0} paddingTop={1} backgroundColor={theme.background.raised.base}>
          <NotesPanel
            project={PROJECTS.find((item) => item.id === project())}
            projects={PROJECTS}
            notes={visible()}
            loaded
            openName={open()}
            now={Date.now()}
            creating={creating()}
            onCreating={setCreating}
            onPickProject={setProject}
            onOpen={(note) => setOpen(note.name)}
            onCreate={(title) => {
              const name = `note-${notes().length + 1}`
              setNotes((list) => [
                {
                  name,
                  frontmatter: { title, status: "inbox", tags: [], created: Date.now(), updated: Date.now() },
                  body: "",
                  mtime: 1,
                },
                ...list,
              ])
              setEmpty(false)
              setOpen(name)
              setMessage(`Created "${title}"`)
            }}
            onRemove={(note) => {
              setNotes((list) => list.filter((item) => item.name !== note.name))
              setMessage(`Deleted "${note.frontmatter.title}"`)
            }}
          />
        </box>
        <box flexGrow={3} flexBasis={0} minWidth={0} border={["right"]} borderColor={theme.border.base}>
          <Show when={!empty() && open()} keyed fallback={<text fg={theme.text.muted}>Pick a note on the left.</text>}>
            {(_) => (
              <Show when={current()}>
                {(note) => (
                  <NoteDocument
                    note={note()}
                    now={Date.now()}
                    writing={writing()}
                    renderNode={plugins.markdown()}
                    indicator={
                      <Show when={multiplayer()}>
                        <MultiplayerBadge room="Design review" guests={2} onClick={() => setMessage("Opens Host")} />
                      </Show>
                    }
                    onLength={(length) => {
                      patch(note().name, (item) => ({ ...item, frontmatter: { ...item.frontmatter, length } }))
                      setMessage(`Length: ${length}`)
                    }}
                    onStatus={(status) =>
                      patch(note().name, (item) => ({ ...item, frontmatter: { ...item.frontmatter, status } }))
                    }
                    onRename={(title) =>
                      patch(note().name, (item) => ({ ...item, frontmatter: { ...item.frontmatter, title } }))
                    }
                    onTags={(tags) =>
                      patch(note().name, (item) => ({ ...item, frontmatter: { ...item.frontmatter, tags } }))
                    }
                    onChat={() => setMessage("Shows the full chat of this note")}
                    onSave={async (body, expectedMtime) => {
                      const latest = notes().find((item) => item.name === note().name)
                      if (latest && latest.mtime !== expectedMtime) return "conflict"
                      patch(note().name, (item) => ({ ...item, body }))
                      setMessage("Saved")
                      return "saved"
                    }}
                  />
                )}
              </Show>
            )}
          </Show>
        </box>
        <box flexGrow={2} flexBasis={0} minWidth={0} paddingLeft={2} paddingTop={1}>
          <text fg={theme.text.muted}>The bound chat renders here in the app.</text>
        </box>
      </box>
      <StoryFooter
        context={props.context}
        title="storybook / notes canvas"
        details={[
          multiplayer() ? "multiplayer" : "solo",
          writing() ? "AI writing" : "idle",
          empty() ? "empty" : "3 notes",
        ]}
        message={message()}
        controls={[
          { shortcut: "m", label: "multiplayer" },
          { shortcut: "w", label: "AI writing" },
          { shortcut: "c", label: "change elsewhere" },
          { shortcut: "n", label: "empty project" },
          { shortcut: "r", label: "reset" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const notesCanvasStory: Story = {
  id: "notes-canvas",
  title: "Notes panel and canvas",
  render: (context) => <NotesCanvasStory context={context} />,
}
