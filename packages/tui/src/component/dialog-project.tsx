import { TextAttributes, type InputRenderable } from "@opentui/core"
import { createSignal, onMount, Show } from "solid-js"
import type { OrchestraProject } from "@opencode/client/promise"
import { useConfig } from "../config"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { useLocation } from "../context/location"
import { useTheme } from "../context/theme"
import type { DialogContext } from "../ui/dialog"
import { errorMessage } from "../util/error"
import { Button } from "./devtools-registry"

// Create a project, or rename it, move it to another directory or forget it.
// Projects are the operator's own: a name and a directory, nothing discovered.
export function DialogProject(props: { project?: OrchestraProject; onDone: () => void; onClose: () => void }) {
  const client = useClient()
  const location = useLocation()
  const theme = useTheme().surface("dialog")
  const config = useConfig().data
  const [error, setError] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [armed, setArmed] = createSignal(false)
  const fields: { name?: InputRenderable; directory?: InputRenderable } = {}

  onMount(() =>
    setTimeout(() => {
      if (fields.name && !fields.name.isDestroyed) fields.name.focus()
    }, 1),
  )

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError()
    await action()
      .then(() => props.onDone())
      .catch((cause: unknown) => setError(errorMessage(cause)))
    setBusy(false)
  }

  const save = () => {
    if (busy()) return
    const name = fields.name?.value.trim() ?? ""
    const directory = fields.directory?.value.trim() ?? ""
    if (!directory) return setError("Enter the project's path")
    const project = props.project
    void run(() =>
      project
        ? client.api.orchestra.project.update({ projectID: project.id, name, directory })
        : client.api.orchestra.project.create({ name, directory }),
    )
  }

  const remove = () => {
    const project = props.project
    if (!project || busy()) return
    if (!armed()) return setArmed(true)
    void run(() => client.api.orchestra.project.remove({ projectID: project.id }))
  }

  // Tab moves between the two fields; enter in either saves.
  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "tab",
        title: "Next field",
        group: "Project",
        run: () => (fields.name?.focused ? fields.directory : fields.name)?.focus(),
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
          {props.project ? "Edit project" : "New project"}
        </text>
        <text fg={theme.text.muted} onMouseUp={props.onClose}>
          esc
        </text>
      </box>
      <box flexDirection="row" gap={1}>
        <box width={6}>
          <text fg={theme.text.muted}>Name</text>
        </box>
        {input("name", "My project", props.project?.name ?? "")}
      </box>
      <box flexDirection="row" gap={1}>
        <box width={6}>
          <text fg={theme.text.muted}>Path</text>
        </box>
        {input(
          "directory",
          "/path/to/project",
          props.project?.directory ?? location.current?.directory ?? process.cwd(),
        )}
      </box>
      <Show when={error()}>
        {(message) => (
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            {message()}
          </text>
        )}
      </Show>
      <box flexDirection="row" gap={1}>
        <Button disabled={busy()} onClick={save}>
          {props.project ? "Save" : "Create"}
        </Button>
        <Show when={props.project}>
          <Button disabled={busy()} onLeave={() => setArmed(false)} onClick={remove}>
            {armed() ? "Remove? Sessions stay" : "Remove project"}
          </Button>
        </Show>
        <box flexGrow={1} />
        <text fg={theme.text.muted}>tab next field · enter save</text>
      </box>
    </box>
  )
}

export function openProjectDialog(dialog: DialogContext, onDone: () => void, project?: OrchestraProject) {
  dialog.replace(
    () => (
      <DialogProject
        project={project}
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
