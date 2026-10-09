import { TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createResource, createSignal, For, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { OrchestraAccess, OrchestraProject } from "@opencode/client/promise"
import { Orchestra } from "@opencode/schema/orchestra"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useRoute } from "../context/route"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { roomListRevision } from "../util/room"
import { openProjectDialog } from "./dialog-project"
import { useProjects } from "../context/projects"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useNotes, type NotesTab } from "../context/notes"
import { NotesPanel } from "./notes-panel"
import { Row } from "./panel-row"
import { useNow } from "./note-canvas"
import { useT } from "../util/i18n"

// The left panel: the operator's own projects, each a name and a directory,
// with its main session (the orchestrator) and the sessions opened in that
// directory under it, grouped by category. "#" sets a session's category; the
// chip after it is the access the orchestrator has to it, and clicking it steps
// through the levels. The Notes tab swaps the tree for the notes of one project.

const ACCESS_ORDER: readonly OrchestraAccess[] = ["hidden", "read", "write", "full"]

export function ProjectTree(props: { width: number }) {
  const t = useT()
  const client = useClient()
  const data = useData()
  const route = useRoute()
  const theme = useTheme()
  const toast = useToast()
  const dialog = useDialog()
  const projectList = useProjects()
  const projects = projectList.list
  const notes = useNotes()
  const [rooms] = createResource(roomListRevision, () => client.api.room.list().catch(() => []))
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})
  const [access, setAccess] = createStore<Record<string, OrchestraAccess>>({})
  const [category, setCategory] = createStore<Record<string, string | undefined>>({})
  const [hover, setHover] = createSignal<string>()
  // Deleting is permanent, so the first click only arms the button and the second deletes.
  const [armed, setArmed] = createSignal<string>()
  // Hidden as soon as the delete succeeds; the server's deleted event drops the record later.
  const [removed, setRemoved] = createStore<Record<string, boolean>>({})

  const current = () => (route.data.type === "session" ? data.session.get(route.data.sessionID) : undefined)
  const shared = createMemo(() => new Set((rooms.latest ?? []).map((room) => room.sessionID)))
  const owner = (directory: string) =>
    // The deepest project wins when one project directory sits inside another.
    projects()
      .filter((project) => Orchestra.contains(project.directory, directory))
      .toSorted((a, b) => b.directory.length - a.directory.length)[0]

  const sessionProject = () => {
    const session = current()
    return (
      session &&
      projects().find((item) => item.main === session.id || owner(session.location.directory)?.id === item.id)
    )
  }

  // The project of the open session starts expanded so the tree shows where you are.
  createEffect(() => {
    const project = sessionProject()
    if (project && expanded[project.id] === undefined) void expand(project.id)
  })

  // Opening a session makes its project the one the Notes tab shows.
  createEffect(
    on(
      () => sessionProject()?.id,
      (projectID) => {
        if (projectID && projectID !== notes.project()) notes.setProject(projectID)
      },
    ),
  )

  const expand = async (projectID: string) => {
    setExpanded(projectID, true)
    await client.api.orchestra.project
      .sessions({ projectID })
      .then((result) => {
        result.data.forEach((session) => data.session.remember(session))
        setAccess(result.access)
        setCategory(result.category)
      })
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))
  }

  const toggle = (projectID: string) => {
    notes.setProject(projectID)
    if (expanded[projectID]) return setExpanded(projectID, false)
    void expand(projectID)
  }

  const edit = (project?: OrchestraProject) => openProjectDialog(dialog, projectList.refetch, project)

  const openMain = (project: OrchestraProject) =>
    client.api.orchestra.project
      .main({ projectID: project.id })
      .then((session) => {
        data.session.remember(session)
        projectList.mutate((list) =>
          list?.map((item) => (item.id === project.id ? { ...item, main: session.id } : item)),
        )
        route.navigate({ type: "session", sessionID: session.id })
      })
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))

  const cycle = (sessionID: string) => {
    const now = access[sessionID] ?? Orchestra.defaultAccess
    const next = ACCESS_ORDER[(ACCESS_ORDER.indexOf(now) + 1) % ACCESS_ORDER.length]
    setAccess(sessionID, next)
    void client.api.orchestra.access({ sessionID, access: next }).catch((error: unknown) => {
      setAccess(sessionID, now)
      toast.show({ message: errorMessage(error), variant: "error" })
    })
  }

  const categorize = (sessionID: string) =>
    dialog.replace(() => (
      <DialogPrompt
        title="Session category"
        placeholder="Planning, Build, Quality… (empty removes it)"
        value={category[sessionID] ?? ""}
        onCancel={() => dialog.clear()}
        onConfirm={(value) => {
          dialog.clear()
          const previous = category[sessionID]
          setCategory(sessionID, value.trim() || undefined)
          void client.api.orchestra.category({ sessionID, category: value.trim() }).catch((error: unknown) => {
            setCategory(sessionID, previous)
            toast.show({ message: errorMessage(error), variant: "error" })
          })
        }}
      />
    ))

  const remove = (sessionID: string) => {
    if (armed() !== sessionID) return setArmed(sessionID)
    setArmed()
    void client.api.session
      .remove({ sessionID })
      .then(() => {
        setRemoved(sessionID, true)
        data.session.evict(sessionID)
        if (route.data.type === "session" && route.data.sessionID === sessionID) route.navigate({ type: "home" })
      })
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))
  }

  const sessionsOf = (project: OrchestraProject) =>
    data.session
      .list()
      .filter(
        (session) =>
          !session.parentID &&
          !removed[session.id] &&
          session.id !== project.main &&
          owner(session.location.directory)?.id === project.id,
      )

  // Categories in first-seen order; sessions without one come last, under "Other"
  // only when the project uses categories at all.
  const groupsOf = (project: OrchestraProject) => {
    const sessions = sessionsOf(project)
    const names = [...new Set(sessions.flatMap((session) => category[session.id] ?? []))]
    const rest = sessions.filter((session) => !category[session.id])
    return [
      ...names.map((name) => ({ name, sessions: sessions.filter((session) => category[session.id] === name) })),
      ...(rest.length > 0 ? [{ name: names.length > 0 ? "Other" : "", sessions: rest }] : []),
    ]
  }

  return (
    <box width={props.width} height="100%" flexShrink={0} backgroundColor={theme.background.raised.base} paddingTop={1}>
      <box flexDirection="row" paddingLeft={1} paddingRight={1} paddingBottom={1}>
        <Tab tab="projects" label={t("Projects")} hover={hover} setHover={setHover} />
        <text fg={theme.text.muted}>│</text>
        <Tab tab="notes" label={t("Notes")} hover={hover} setHover={setHover} />
        <box flexGrow={1} />
        <Row
          id="new"
          hover={hover}
          setHover={setHover}
          onClick={() => (notes.tab() === "notes" ? notes.setCreating(true) : edit())}
        >
          <text fg={hover() === "new" ? theme.text.action.primary.hovered : theme.text.action.primary.base}>{t("+ New")}</text>
        </Row>
      </box>
      <Show when={notes.tab() === "notes"}>
        <ProjectNotes />
      </Show>
      <scrollbox
        visible={notes.tab() === "projects"}
        flexGrow={notes.tab() === "projects" ? 1 : 0}
        minHeight={0}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <For each={projects()}>
          {(project) => (
            <box>
              <Row id={project.id} hover={hover} setHover={setHover} onClick={() => toggle(project.id)}>
                <text fg={theme.text.muted}>{expanded[project.id] ? "▾ " : "▸ "}</text>
                <box flexGrow={1} minWidth={0}>
                  <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                    {project.name}
                  </text>
                </box>
                <box
                  onMouseUp={(event) => {
                    event.stopPropagation()
                    edit(project)
                  }}
                >
                  <text fg={hover() === project.id ? theme.text.action.primary.base : theme.text.muted}> ⚙</text>
                </box>
              </Row>
              <Show when={expanded[project.id]}>
                <Row
                  id={`${project.id}:main`}
                  hover={hover}
                  setHover={setHover}
                  selected={project.main !== undefined && project.main === current()?.id}
                  onClick={() => void openMain(project)}
                >
                  <text fg={theme.text.action.primary.base}>{"  ★ "}</text>
                  <text fg={theme.text.base} wrapMode="none">
                    Orchestrator
                  </text>
                </Row>
                <For each={groupsOf(project)}>
                  {(group) => (
                    <>
                      <Show when={group.name}>
                        <box paddingLeft={4}>
                          <text fg={theme.text.muted} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                            {group.name}
                          </text>
                        </box>
                      </Show>
                      <For each={group.sessions}>
                        {(session) => (
                          <Row
                            id={session.id}
                            hover={hover}
                            setHover={setHover}
                            selected={session.id === current()?.id}
                            onClick={() => route.navigate({ type: "session", sessionID: session.id })}
                          >
                            <text
                              fg={
                                data.session.status(session.id) === "running"
                                  ? theme.text.feedback.success.base
                                  : theme.text.muted
                              }
                            >
                              {data.session.status(session.id) === "running" ? "  ● " : "  ○ "}
                            </text>
                            <box flexGrow={1} minWidth={0}>
                              <text fg={theme.text.base} wrapMode="none" truncate>
                                {`${shared().has(session.id) ? "⇄ " : ""}${session.title || "Untitled"}`}
                              </text>
                            </box>
                            <box
                              onMouseUp={(event) => {
                                event.stopPropagation()
                                categorize(session.id)
                              }}
                            >
                              <text fg={hover() === session.id ? theme.text.action.primary.base : theme.text.muted}>
                                #{" "}
                              </text>
                            </box>
                            <box
                              onMouseUp={(event) => {
                                event.stopPropagation()
                                cycle(session.id)
                              }}
                            >
                              <text
                                fg={theme.text.formfield.base}
                              >{`[${access[session.id] ?? Orchestra.defaultAccess}]`}</text>
                            </box>
                            <box
                              onMouseOut={() => setArmed()}
                              onMouseUp={(event) => {
                                event.stopPropagation()
                                remove(session.id)
                              }}
                            >
                              <text fg={armed() === session.id ? theme.text.feedback.error.base : theme.text.muted}>
                                {armed() === session.id ? " delete?" : " ×"}
                              </text>
                            </box>
                          </Row>
                        )}
                      </For>
                    </>
                  )}
                </For>
                <Row
                  id={`${project.id}:new`}
                  hover={hover}
                  setHover={setHover}
                  onClick={() => route.navigate({ type: "home", location: { directory: project.directory } })}
                >
                  <text fg={theme.text.muted}>{"  " + t("+ New session")}</text>
                </Row>
              </Show>
            </box>
          )}
        </For>
      </scrollbox>
    </box>
  )
}

function Tab(props: {
  tab: NotesTab
  label: string
  hover: () => string | undefined
  setHover: (id: string | undefined) => void
}) {
  const theme = useTheme()
  const notes = useNotes()
  const id = `tab:${props.tab}`
  const active = () => notes.tab() === props.tab
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      onMouseOver={() => props.setHover(id)}
      onMouseOut={() => props.setHover(undefined)}
      onMouseUp={() => notes.setTab(props.tab)}
    >
      <text
        fg={
          active()
            ? theme.text.action.primary.selected
            : props.hover() === id
              ? theme.text.action.secondary.hovered
              : theme.text.muted
        }
        attributes={active() ? TextAttributes.BOLD | TextAttributes.UNDERLINE : undefined}
      >
        {props.label}
      </text>
    </box>
  )
}

// The Notes tab: the notes of the project of the open session, or of the project
// last picked, or of the first one.
function ProjectNotes() {
  const notes = useNotes()
  const route = useRoute()
  const toast = useToast()
  const projects = useProjects().list
  const now = useNow()
  const project = createMemo(() => projects().find((item) => item.id === notes.project()) ?? projects()[0])
  const directory = () => project()?.directory
  const openName = () => (route.data.type === "session" ? notes.bound(route.data.sessionID)?.name : undefined)
  const fail = (error: unknown) => toast.show({ variant: "error", message: errorMessage(error) })

  return (
    <NotesPanel
      project={project()}
      projects={projects()}
      notes={directory() ? notes.list(directory()!) : []}
      loaded={directory() ? notes.loaded(directory()!) : true}
      error={directory() ? notes.error(directory()!) : undefined}
      openName={openName()}
      now={now()}
      creating={notes.creating()}
      onCreating={notes.setCreating}
      onPickProject={notes.setProject}
      onOpen={(note) => {
        const target = directory()
        if (target) void notes.open(target, note).catch(fail)
      }}
      onCreate={(title) => {
        const target = directory()
        if (target) void notes.start(target, title).catch(fail)
      }}
      onRemove={(note) => {
        const target = directory()
        if (!target) return
        void notes.remove(target, note).catch(fail)
      }}
    />
  )
}
