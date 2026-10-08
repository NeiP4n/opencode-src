import { TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createResource, createSignal, For, onMount, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import type { OrchestraAccess, OrchestraState, Project } from "@opencode/client/promise"
import path from "node:path"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useRoute } from "../context/route"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"

// The left panel: projects first, each with its main session (the orchestra)
// and the project's sessions under it. The chip after a session is the access
// the orchestra has to it; clicking it steps through the levels.

const ACCESS_ORDER: readonly OrchestraAccess[] = ["hidden", "read", "write", "full"]
const SESSION_LIMIT = 30

export function ProjectTree(props: { width: number }) {
  const client = useClient()
  const data = useData()
  const route = useRoute()
  const theme = useTheme()
  const toast = useToast()
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})
  const [states, setStates] = createStore<Record<string, OrchestraState>>({})
  const [rooms] = createResource(() => client.api.room.list().catch(() => []))
  const [hover, setHover] = createSignal<string>()

  onMount(() => void data.project.sync())

  const current = () => (route.data.type === "session" ? data.session.get(route.data.sessionID) : undefined)
  const shared = createMemo(() => new Set((rooms() ?? []).map((room) => room.sessionID)))

  // The project of the open session starts expanded so the tree shows where you are.
  createEffect(() => {
    const projectID = current()?.projectID
    if (projectID && expanded[projectID] === undefined) void expand(projectID)
  })

  const expand = async (projectID: string) => {
    setExpanded(projectID, true)
    await Promise.all([
      client.api.orchestra.get({ projectID }).then((state) => setStates(projectID, state)),
      client.api.session
        .list({ project: projectID, parentID: null, limit: SESSION_LIMIT, order: "desc" })
        .then((response) => response.data.forEach((session) => data.session.remember(session))),
    ]).catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))
  }

  const toggle = (projectID: string) => {
    if (expanded[projectID]) return setExpanded(projectID, false)
    void expand(projectID)
  }

  const openMain = (project: Project) =>
    client.api.orchestra
      .main({ projectID: project.id })
      .then((session) => {
        data.session.remember(session)
        setStates(project.id, "main", session.id)
        route.navigate({ type: "session", sessionID: session.id })
      })
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))

  const cycle = (projectID: string, sessionID: string) => {
    const now = access(projectID, sessionID)
    const next = ACCESS_ORDER[(ACCESS_ORDER.indexOf(now) + 1) % ACCESS_ORDER.length]
    setStates(projectID, "access", sessionID, next)
    void client.api.orchestra.access({ sessionID, access: next }).catch((error: unknown) => {
      setStates(projectID, "access", sessionID, now)
      toast.show({ message: errorMessage(error), variant: "error" })
    })
  }

  const access = (projectID: string, sessionID: string): OrchestraAccess =>
    states[projectID]?.access[sessionID] ?? "read"

  const sessionsOf = (projectID: string) =>
    data.session
      .list()
      .filter(
        (session) => session.projectID === projectID && !session.parentID && session.id !== states[projectID]?.main,
      )

  return (
    <box width={props.width} height="100%" flexShrink={0} backgroundColor={theme.background.raised.base} paddingTop={1}>
      <box paddingLeft={2} paddingBottom={1}>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          Projects
        </text>
      </box>
      <scrollbox flexGrow={1} minHeight={0} horizontalScrollbarOptions={{ visible: false }}>
        <For each={data.project.list()}>
          {(project) => (
            <box>
              <Row id={project.id} hover={hover} setHover={setHover} onClick={() => toggle(project.id)}>
                <text fg={theme.text.muted}>{expanded[project.id] ? "▾ " : "▸ "}</text>
                <box flexGrow={1} minWidth={0}>
                  <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                    {project.name || path.basename(project.canonical) || project.canonical}
                  </text>
                </box>
              </Row>
              <Show when={expanded[project.id]}>
                <Row
                  id={`${project.id}:main`}
                  hover={hover}
                  setHover={setHover}
                  selected={states[project.id]?.main !== undefined && states[project.id]?.main === current()?.id}
                  onClick={() => void openMain(project)}
                >
                  <text fg={theme.text.action.primary.base}>{"  ★ "}</text>
                  <text fg={theme.text.base} wrapMode="none">
                    Orchestra
                  </text>
                </Row>
                <For each={sessionsOf(project.id)}>
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
                          cycle(project.id, session.id)
                        }}
                      >
                        <text fg={theme.text.formfield.base}>{`[${access(project.id, session.id)}]`}</text>
                      </box>
                    </Row>
                  )}
                </For>
                <Row
                  id={`${project.id}:new`}
                  hover={hover}
                  setHover={setHover}
                  onClick={() => route.navigate({ type: "home", location: { directory: project.canonical } })}
                >
                  <text fg={theme.text.muted}>{"  + New session"}</text>
                </Row>
              </Show>
            </box>
          )}
        </For>
      </scrollbox>
    </box>
  )
}

function Row(props: {
  id: string
  hover: () => string | undefined
  setHover: (id: string | undefined) => void
  selected?: boolean
  onClick: () => void
  children: JSX.Element
}) {
  const theme = useTheme()
  return (
    <box
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={
        props.selected
          ? theme.background.action.primary.focused
          : props.hover() === props.id
            ? theme.background.action.primary.hovered
            : undefined
      }
      onMouseOver={() => props.setHover(props.id)}
      onMouseOut={() => props.setHover(undefined)}
      onMouseUp={props.onClick}
    >
      {props.children}
    </box>
  )
}
