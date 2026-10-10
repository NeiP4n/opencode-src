import { TextAttributes, type InputRenderable } from "@opentui/core"
import { createSignal, For, onMount, Show } from "solid-js"
import type { OrchestraProject, OrchestraTemplate } from "@opencode/client/promise"
import { useConfig } from "../config"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { useLocation } from "../context/location"
import { useTheme } from "../context/theme"
import type { DialogContext } from "../ui/dialog"
import { errorMessage } from "../util/error"
import { useT } from "../util/i18n"
import { isRecord } from "../util/record"
import { Button } from "./devtools-registry"
import { builtinName, openTeamEditor } from "./dialog-teams"

// Create a project, or rename it, move it to another directory or forget it.
// Projects are the operator's own: a name and a directory, nothing discovered.
// A new project may start with an AI team: the template opens its role
// sessions next to the Orchestrator; "No team" opens nothing. Teams themselves
// are edited in the team editor, which comes back here with the typed fields.
type Draft = { name: string; directory: string }

export function DialogProject(props: {
  project?: OrchestraProject
  draft?: Draft
  onDone: () => void
  onClose: () => void
  onEditTeams?: (draft: Draft) => void
}) {
  const client = useClient()
  const location = useLocation()
  const theme = useTheme().surface("dialog")
  const config = useConfig().data
  const t = useT()
  const [error, setError] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [armed, setArmed] = createSignal(false)
  const fields: { name?: InputRenderable; directory?: InputRenderable } = {}
  // Loaded when the dialog opens, which may be while the client is still connecting:
  // a failure is shown with a retry instead of an empty list that silently means "No team".
  const [templates, setTemplates] = createSignal<readonly OrchestraTemplate[]>()
  const [templatesFailed, setTemplatesFailed] = createSignal(false)
  const loadTemplates = () => {
    setTemplatesFailed(false)
    client.api.orchestra.template.list().then(setTemplates, () => setTemplatesFailed(true))
  }
  // 0 is "No team"; n picks templates()[n - 1].
  const [team, setTeam] = createSignal(0)
  const [teamFocused, setTeamFocused] = createSignal(false)
  const focusTeam = () => {
    if (templatesFailed()) loadTemplates()
    fields.name?.blur()
    fields.directory?.blur()
    setTeamFocused(true)
  }
  const focusField = (field: InputRenderable | undefined) => {
    setTeamFocused(false)
    field?.focus()
  }
  const moveTeam = (direction: 1 | -1) => {
    const count = (templates()?.length ?? 0) + 1
    setTeam((team() + direction + count) % count)
  }

  onMount(() => {
    if (!props.project) loadTemplates()
    setTimeout(() => {
      if (fields.name && !fields.name.isDestroyed) fields.name.focus()
    }, 1)
  })

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError()
    await action()
      .then(() => props.onDone())
      .catch((cause: unknown) =>
        // The server names the field it rejected; its own text is English.
        setError(
          isRecord(cause) && cause.field === "directory"
            ? t("Not an existing directory: {directory}", { directory: fields.directory?.value.trim() ?? "" })
            : errorMessage(cause),
        ),
      )
    setBusy(false)
  }

  const save = () => {
    if (busy()) return
    const name = fields.name?.value.trim() ?? ""
    const directory = fields.directory?.value.trim() ?? ""
    if (!directory) return setError(t("Enter the project's path"))
    const project = props.project
    void run(() =>
      project
        ? client.api.orchestra.project.update({ projectID: project.id, name, directory })
        : client.api.orchestra.project.create({ name, directory, template: templates()?.[team() - 1]?.id }),
    )
  }

  const remove = () => {
    const project = props.project
    if (!project || busy()) return
    if (!armed()) return setArmed(true)
    void run(() => client.api.orchestra.project.remove({ projectID: project.id }))
  }

  const editTeams = () =>
    props.onEditTeams?.({ name: fields.name?.value ?? "", directory: fields.directory?.value ?? "" })

  // Tab moves between the fields (and the team list of a new project); enter saves.
  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "tab",
        title: "Next field",
        group: "Project",
        run: () => {
          if (fields.name?.focused) return focusField(fields.directory)
          if (fields.directory?.focused && !props.project) return focusTeam()
          focusField(fields.name)
        },
      },
      { bind: "up", title: "Previous team", group: "Project", enabled: teamFocused, run: () => moveTeam(-1) },
      { bind: "down", title: "Next team", group: "Project", enabled: teamFocused, run: () => moveTeam(1) },
      { bind: "return", title: "Create", group: "Project", enabled: teamFocused, run: save },
      {
        bind: "ctrl+e",
        title: "Edit teams",
        group: "Project",
        enabled: () => !props.project && props.onEditTeams !== undefined,
        run: editTeams,
      },
    ],
  }))

  const input = (key: "name" | "directory", placeholder: string, value: string) => (
    <input
      flexGrow={1}
      value={value}
      cursorStyle={config.cursor}
      ref={(element: InputRenderable) => {
        fields[key] = element
      }}
      onSubmit={save}
      placeholder={placeholder}
      placeholderColor={theme.text.muted}
      textColor={theme.text.formfield.base}
      focusedTextColor={theme.text.formfield.focused}
      cursorColor={theme.text.formfield.focused}
      focusedBackgroundColor={theme.background.formfield.focused}
    />
  )

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          {t(props.project ? "Edit project" : "New project")}
        </text>
        <text fg={theme.text.muted} onMouseUp={props.onClose}>
          esc
        </text>
      </box>
      {/* A click on a field or its label takes focus back from the team list. */}
      <box flexDirection="row" gap={1} onMouseDown={() => focusField(fields.name)}>
        <box width={9}>
          <text fg={theme.text.muted}>{t("Name")}</text>
        </box>
        {input("name", t("My project"), props.project?.name ?? props.draft?.name ?? "")}
      </box>
      <box flexDirection="row" gap={1} onMouseDown={() => focusField(fields.directory)}>
        <box width={9}>
          <text fg={theme.text.muted}>{t("Path")}</text>
        </box>
        {input(
          "directory",
          "/path/to/project",
          props.project?.directory ?? props.draft?.directory ?? location.current?.directory ?? process.cwd(),
        )}
      </box>
      <Show when={!props.project}>
        <box flexDirection="row" gap={1}>
          <box width={9} onMouseUp={focusTeam}>
            <text fg={teamFocused() ? theme.text.formfield.focused : theme.text.muted}>{t("Team")}</text>
          </box>
          <box flexGrow={1}>
            <TeamOption
              selected={team() === 0}
              focused={teamFocused()}
              name={t("No team")}
              detail={t("only the Orchestrator")}
              onClick={() => {
                setTeam(0)
                focusTeam()
              }}
            />
            <For each={templates()}>
              {(template, index) => (
                <TeamOption
                  selected={team() === index() + 1}
                  focused={teamFocused()}
                  name={builtinName(t, template) ?? template.id}
                  detail={template.members
                    .map((member) => (template.origin === "builtin" ? t(member.title) : member.title))
                    .join(", ")}
                  onClick={() => {
                    setTeam(index() + 1)
                    focusTeam()
                  }}
                />
              )}
            </For>
            <Show when={!templates() && !templatesFailed()}>
              <box paddingLeft={2}>
                <text fg={theme.text.muted}>{t("Loading teams…")}</text>
              </box>
            </Show>
            <Show when={templatesFailed()}>
              <box flexDirection="row" gap={1} paddingLeft={2}>
                <text fg={theme.text.feedback.error.base}>{t("Could not load teams")}</text>
                <text fg={theme.text.action.primary.base} onMouseUp={loadTemplates}>
                  {t("Retry")}
                </text>
              </box>
            </Show>
            <Show when={props.onEditTeams}>
              <box paddingLeft={2} onMouseUp={editTeams}>
                <text fg={theme.text.action.primary.base}>{t("Edit teams and roles…")}</text>
              </box>
            </Show>
          </box>
        </box>
      </Show>
      <Show when={error()}>
        {(message) => (
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            {message()}
          </text>
        )}
      </Show>
      <box flexDirection="row" gap={1}>
        <Button variant="primary" disabled={busy()} onClick={save}>
          {t(props.project ? "Save" : "Create")}
        </Button>
        <Show when={props.project}>
          <Button disabled={busy()} onLeave={() => setArmed(false)} onClick={remove}>
            {t(armed() ? "Remove? Sessions stay" : "Remove project")}
          </Button>
        </Show>
        <box flexGrow={1} />
        <text fg={theme.text.muted}>
          {props.project
            ? t("tab next field · enter save")
            : t("tab next field · ↑↓ team · ctrl+e edit teams · enter create")}
        </text>
      </box>
    </box>
  )
}

function TeamOption(props: { selected: boolean; focused: boolean; name: string; detail: string; onClick: () => void }) {
  const theme = useTheme().surface("dialog")
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      flexDirection="row"
      gap={1}
      backgroundColor={
        props.selected && props.focused
          ? theme.background.formfield.focused
          : hovered()
            ? theme.background.formfield.hovered
            : undefined
      }
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={props.onClick}
    >
      <text fg={props.selected ? theme.text.formfield.focused : theme.text.muted}>{props.selected ? "●" : "○"}</text>
      <text fg={props.selected ? theme.text.formfield.focused : theme.text.formfield.base} wrapMode="none">
        {props.name}
      </text>
      <box flexGrow={1} minWidth={0}>
        <text fg={theme.text.muted} wrapMode="none" truncate>
          {`· ${props.detail}`}
        </text>
      </box>
    </box>
  )
}

export function openProjectDialog(
  dialog: DialogContext,
  onDone: () => void,
  project?: OrchestraProject,
  draft?: Draft,
) {
  dialog.replace(
    () => (
      <DialogProject
        project={project}
        draft={draft}
        onEditTeams={(typed) =>
          openTeamEditor(dialog, { back: () => openProjectDialog(dialog, onDone, undefined, typed) })
        }
        onClose={() => dialog.clear()}
        onDone={() => {
          dialog.clear()
          onDone()
        }}
      />
    ),
    undefined,
    { size: "large" },
  )
  dialog.setCentered(true)
}
