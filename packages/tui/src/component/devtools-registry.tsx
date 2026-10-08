import { TextAttributes, type InputRenderable, type RGBA } from "@opentui/core"
import { createMemo, createSignal, For, Match, onMount, Show, Switch, type JSX } from "solid-js"
import { Hub } from "@opencode/core/hub/index"
import { HubState } from "@opencode/core/hub/state"
import { useConfig } from "../config"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { hubRegistryStatus, type RegistryOptions, type RegistryTool } from "../util/hub-registry"

// Interactive catalog control for the Universal Tool Hub, opened from the
// devtools bar as a centered dialog. Every row is one binary the catalog
// depends on: the operator installs or removes it, and switches it on or off
// for the model.
//
// The switch is the hint block's opt-in flag. On means the tool is advertised
// in the system prompt and its entries stay discoverable; off (the default) is
// not advertised, and switching a tool off again additionally withdraws its
// entries from the `hub` tool's listing. An empty state file shows every switch
// off and behaves exactly as before the feature.
//
// Removal runs a package manager, so it takes two activations of the same
// button ("Remove" arms, "Remove?" executes); moving elsewhere disarms it.
// While an action is pending the controls are disabled, the outcome goes
// through a toast, and a failure pins the exact command to rerun by hand to
// the note line.

const PAGE_SIZE = 12
const TOOL_COLUMN = 16

export type RegistryPanelOptions = RegistryOptions & {
  // `hub.json` directory; tests point this at a temp dir instead of the Global
  // state directory so a click never edits the operator's real selection.
  directory?: string
  // Package-manager actions; tests replace them so no command ever runs.
  install?: (tool: string) => Promise<Hub.ActionResult>
  remove?: (tool: string) => Promise<Hub.ActionResult>
}

export function RegistryPanel(props: {
  options?: RegistryPanelOptions
  onClose?: () => void
  // Makes the chosen terminal the shell tool's shell too, where that shell can be permission-checked.
  onShell?: (shell: string) => void
}) {
  const theme = useTheme().surface("dialog")
  const toast = useToast()
  const options = props.options ?? {}
  const install = options.install ?? Hub.HubActions.installTool
  const remove = options.remove ?? Hub.HubActions.removeTool
  const [enabled, setEnabled] = createSignal<Readonly<Record<string, boolean>>>({})
  // Bumped after anything that can change PATH or the state file, so the
  // memo re-probes instead of trusting a stale readiness count.
  const [revision, setRevision] = createSignal(0)
  const [busy, setBusy] = createSignal<string>()
  const [armed, setArmed] = createSignal<string>()
  const [message, setMessage] = createSignal<string>()
  const [page, setPage] = createSignal(0)
  const [cursor, setCursor] = createSignal(0)
  const [query, setQuery] = createSignal("")
  const [terminal, setTerminal] = createSignal<Hub.Backend>()
  const config = useConfig().data

  // A click that lands before the state file resolves is the operator's newest
  // intent, so the slow read must not overwrite it.
  let interacted = false
  // Queues hub.json writes: a second click before the first lands would
  // otherwise read-modify-write the file concurrently and lose an update.
  let writes: Promise<void> = Promise.resolve()
  onMount(async () => {
    const state = await HubState.read({ directory: options.directory })
    if (!interacted) setEnabled(state.enabled)
    setTerminal(state.terminal)
    setRevision((value) => value + 1)
  })

  const status = createMemo(() => {
    revision()
    // Only the registry inputs travel on: `directory` and the injected actions
    // belong to this panel, not to the status probe.
    return hubRegistryStatus({
      probe: options.probe,
      platform: options.platform,
      manager: options.manager,
      enabled: enabled(),
    })
  })
  // Every word of the query must appear in the tool's name or in the id, title,
  // description or category of a catalog entry that needs it, so "yaml" or
  // "docker logs" finds the binary behind the recipe.
  const visible = createMemo(() => {
    const words = query()
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 0)
    if (words.length === 0) return status().tools
    return status().tools.filter((row) => {
      const text = (haystack.get(row.tool) ?? row.tool).toLowerCase()
      return words.every((word) => text.includes(word))
    })
  })
  const pages = createMemo(() => Math.max(1, Math.ceil(visible().length / PAGE_SIZE)))
  const current = createMemo(() => Math.min(page(), pages() - 1))
  const rows = createMemo(() => visible().slice(current() * PAGE_SIZE, current() * PAGE_SIZE + PAGE_SIZE))
  const selected = () => rows()[Math.min(cursor(), rows().length - 1)]
  const missing = createMemo(() => status().tools.filter((row) => !row.installed))
  const isOn = (tool: string) => enabled()[tool] === true
  // Without a choice the hub prefers nu, then pwsh, then bash, whichever is installed.
  const aiTerminal = () =>
    terminal() ??
    (["nu", "pwsh", "bash"] as const).find((name) =>
      status().terminals.some((item) => item.name === name && item.present),
    )

  const chooseTerminal = (name: Hub.Backend) => {
    setTerminal(name)
    void HubState.setTerminal(name, { directory: options.directory }).catch((error: unknown) =>
      toast.show({ message: error instanceof Error ? error.message : String(error), variant: "error" }),
    )
    // nu cannot be permission-checked as a general shell, so the shell tool keeps bash then.
    if (name !== "nu") props.onShell?.(name)
  }

  const runAction = async (
    tool: string,
    verb: "installed" | "removed",
    action: (tool: string) => Promise<Hub.ActionResult>,
  ) => {
    setBusy(tool)
    setMessage()
    const result = await action(tool).catch((error: unknown) => ({
      ok: false,
      exit: 1,
      output: error instanceof Error ? error.message : String(error),
      command: "",
    }))
    // The note pins the command to rerun by hand, while the toast says why it failed.
    const reason = Hub.HubActions.failureReason(result.output)
    setMessage(result.ok ? `${tool} ${verb}` : `${tool}: ${result.command || reason}`)
    toast.show({
      message: result.ok ? `${tool} ${verb}` : `${tool} failed: ${reason}`,
      variant: result.ok ? "success" : "error",
    })
    setBusy()
    setRevision((value) => value + 1)
    return result.ok
  }

  const onInstall = (tool: string) => {
    setArmed()
    if (busy() !== undefined) return
    void runAction(tool, "installed", install)
  }

  const onRemove = (tool: string) => {
    if (busy() !== undefined) return
    // The first activation only arms the destructive action; the second runs it.
    if (armed() !== tool) {
      setArmed(tool)
      return
    }
    setArmed()
    void runAction(tool, "removed", remove)
  }

  // Installs one tool at a time so a failure names the tool that caused it and
  // stops there instead of burying it under the rest of the batch.
  const onInstallMissing = async () => {
    setArmed()
    if (busy() !== undefined) return
    for (const row of missing()) {
      if (!(await runAction(row.tool, "installed", install))) return
    }
  }

  const onToggle = (tool: string) => {
    setArmed()
    if (busy() !== undefined) return
    void setSwitch([tool], !isOn(tool))
  }

  const setSwitch = async (tools: readonly string[], next: boolean) => {
    interacted = true
    const previous = enabled()
    // Optimistic: the switch reflects the click immediately, and the file write
    // only decides the next session's prompt block.
    setEnabled({ ...previous, ...Object.fromEntries(tools.map((tool) => [tool, next])) })
    const write = tools.reduce(
      (chain, tool) => chain.then(() => HubState.setEnabled(tool, next, { directory: options.directory })),
      writes,
    )
    writes = write.catch(() => undefined)
    // A failed write hands back the previous selection.
    await write.catch(() => setEnabled(previous))
  }

  const move = (delta: number) => {
    setArmed()
    setCursor((value) => Math.max(0, Math.min(rows().length - 1, value + delta)))
  }
  const turn = (delta: number) => {
    setArmed()
    setPage((value) => Math.max(0, Math.min(pages() - 1, value + delta)))
    setCursor(0)
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "up", title: "Previous tool", group: "Registry", run: () => move(-1) },
      { bind: "down", title: "Next tool", group: "Registry", run: () => move(1) },
      { bind: "left", title: "Previous page", group: "Registry", run: () => turn(-1) },
      { bind: "right", title: "Next page", group: "Registry", run: () => turn(1) },
      {
        bind: "tab",
        title: "Switch tool for the model",
        group: "Registry",
        run: () => {
          const row = selected()
          if (row) onToggle(row.tool)
        },
      },
      {
        bind: "return",
        title: "Install or remove tool",
        group: "Registry",
        run: () => {
          const row = selected()
          if (!row) return
          if (row.installed) return onRemove(row.tool)
          onInstall(row.tool)
        },
      },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          Registry
        </text>
        <text fg={theme.text.muted} onMouseUp={() => props.onClose?.()}>
          esc
        </text>
      </box>

      <box flexDirection="row" gap={3}>
        <Stat label="Ready" value={`${status().ready}/${status().total}`} />
        <Stat
          label="For the model"
          value={`${status().tools.filter((row) => isOn(row.tool)).length}/${status().tools.length}`}
        />
      </box>

      <box flexDirection="row" gap={1}>
        <text fg={theme.text.muted}>AI terminal</text>
        <For each={status().terminals}>
          {(item) => (
            <Switch>
              <Match when={item.present}>
                <Button
                  variant={aiTerminal() === item.name ? "primary" : "secondary"}
                  disabled={busy() !== undefined}
                  onClick={() => chooseTerminal(item.name)}
                >
                  {`${aiTerminal() === item.name ? "●" : "○"} ${item.name}`}
                </Button>
              </Match>
              <Match when={busy() === item.name}>
                <text fg={theme.text.muted}>{`${item.name} …`}</text>
              </Match>
              <Match when={item.installable}>
                <Button disabled={busy() !== undefined} onClick={() => onInstall(item.name)}>
                  {`Install ${item.name}`}
                </Button>
              </Match>
              <Match when={true}>
                <text fg={theme.text.muted}>{`${item.name}: ${item.manual ?? "no installer here"}`}</text>
              </Match>
            </Switch>
          )}
        </For>
      </box>
      <Show when={aiTerminal() === "nu"}>
        <text fg={theme.text.muted} wrapMode="word">
          Hub commands run in nu. Other shell commands stay in bash, where they can be permission-checked.
        </text>
      </Show>

      <text fg={theme.text.muted} wrapMode="word">
        {status()
          .categories.map((entry) => `${entry.name} ${entry.ready}/${entry.total}`)
          .join("  ")}
      </text>

      <box flexDirection="row" gap={1}>
        <text fg={theme.text.muted}>Search</text>
        <input
          flexGrow={1}
          onInput={(value) => {
            setQuery(value)
            setPage(0)
            setCursor(0)
            setArmed()
          }}
          focusedBackgroundColor={theme.background.formfield.focused}
          cursorColor={theme.text.formfield.focused}
          cursorStyle={config.cursor}
          focusedTextColor={theme.text.formfield.focused}
          placeholder="tool, category or task: yaml, ports, docker logs"
          placeholderColor={theme.text.muted}
          ref={(input: InputRenderable) => {
            setTimeout(() => {
              if (!input.isDestroyed) input.focus()
            }, 1)
          }}
        />
        <text fg={theme.text.muted}>{`${visible().length}/${status().tools.length}`}</text>
      </box>

      <box flexDirection="row" gap={1}>
        <Button
          variant="primary"
          disabled={busy() !== undefined || missing().length === 0}
          onClick={() => void onInstallMissing()}
        >
          {`Install missing (${missing().length})`}
        </Button>
        <Button
          disabled={busy() !== undefined}
          onClick={() =>
            void setSwitch(
              status()
                .tools.filter((row) => row.installed)
                .map((row) => row.tool),
              true,
            )
          }
        >
          All installed on
        </Button>
        <Button
          disabled={busy() !== undefined}
          onClick={() =>
            void setSwitch(
              status().tools.map((row) => row.tool),
              false,
            )
          }
        >
          All off
        </Button>
        <box flexGrow={1} />
        <Button onClick={() => turn(-1)}>‹</Button>
        <text fg={theme.text.muted}>{`Tools ${current() + 1}/${pages()}`}</text>
        <Button onClick={() => turn(1)}>›</Button>
      </box>

      <box>
        <For each={rows()}>
          {(row, index) => (
            <ToolRow
              tool={row}
              on={isOn(row.tool)}
              active={index() === cursor()}
              pending={busy() !== undefined}
              working={busy() === row.tool}
              armed={armed() === row.tool}
              onHover={() => setCursor(index())}
              onToggle={() => onToggle(row.tool)}
              onInstall={() => onInstall(row.tool)}
              onRemove={() => onRemove(row.tool)}
              onDisarm={() => setArmed()}
            />
          )}
        </For>
        <Show when={rows().length === 0}>
          <text fg={theme.text.muted}>
            {query() ? `Nothing matches "${query()}".` : "No catalog tools on this platform."}
          </text>
        </Show>
      </box>

      <Show when={message()}>
        {(text) => (
          <text fg={theme.text.muted} wrapMode="word">
            {text()}
          </text>
        )}
      </Show>
      <text fg={theme.text.muted}>↑↓ select · tab model on/off · enter install/remove · ←→ page · esc close</text>
    </box>
  )
}

// Searchable text per tool: its name plus every catalog entry that requires it.
const haystack = Hub.all.reduce((map, entry) => {
  const text = `${entry.id} ${entry.title} ${entry.description} ${entry.category}`
  for (const tool of entry.requires ?? []) map.set(tool, `${map.get(tool) ?? tool} ${text}`)
  return map
}, new Map<string, string>())

function Stat(props: { label: string; value: string }) {
  const theme = useTheme().surface("dialog")
  return (
    <box flexDirection="row" gap={1}>
      <text fg={theme.text.muted}>{props.label}</text>
      <text fg={theme.text.base}>{props.value}</text>
    </box>
  )
}

function ToolRow(props: {
  tool: RegistryTool
  on: boolean
  active: boolean
  pending: boolean
  working: boolean
  armed: boolean
  onHover: () => void
  onToggle: () => void
  onInstall: () => void
  onRemove: () => void
  onDisarm: () => void
}) {
  const theme = useTheme().surface("dialog")
  return (
    <box
      flexDirection="row"
      gap={1}
      backgroundColor={props.active ? theme.background.action.primary.focused : undefined}
      onMouseOver={props.onHover}
    >
      <Action
        disabled={props.pending}
        onClick={props.onToggle}
        color={props.on ? theme.text.formfield.selected : theme.text.formfield.base}
      >
        {props.on ? " [on] " : " [off]"}
      </Action>
      <box width={TOOL_COLUMN}>
        <text fg={props.tool.installed ? theme.text.base : theme.text.muted} wrapMode="none" truncate>
          {props.tool.tool}
        </text>
      </box>
      <box width={11}>
        <text fg={theme.text.muted}>{`${props.tool.entries} ${props.tool.entries === 1 ? "entry" : "entries"}`}</text>
      </box>
      <text fg={props.tool.installed ? theme.text.feedback.success.base : theme.text.feedback.warning.base}>
        {props.tool.installed ? "installed" : "missing"}
      </text>
      <box flexGrow={1} />
      <Show when={props.working}>
        <text fg={theme.text.muted}>…</text>
      </Show>
      <Show when={!props.working && props.tool.installed}>
        <Button disabled={props.pending} onLeave={props.onDisarm} onClick={props.onRemove}>
          {props.armed ? "Remove?" : "Remove"}
        </Button>
      </Show>
      <Show when={!props.working && !props.tool.installed}>
        <Button disabled={props.pending} onClick={props.onInstall}>
          Install
        </Button>
      </Show>
    </box>
  )
}

// Primary is a filled chip for the main action of a section. Secondary keeps the
// theme's transparent background, so brackets mark it as clickable.
export function Button(props: {
  children: string
  onClick: () => void
  disabled?: boolean
  onLeave?: () => void
  variant?: "primary" | "secondary"
}) {
  const theme = useTheme().surface("dialog")
  const [hovered, setHovered] = createSignal(false)
  const primary = () => props.variant === "primary"
  const state = () => (props.disabled ? "disabled" : hovered() ? "hovered" : primary() ? "focused" : "base")
  return (
    <box
      paddingLeft={primary() ? 1 : 0}
      paddingRight={primary() ? 1 : 0}
      backgroundColor={
        props.disabled
          ? undefined
          : primary()
            ? theme.background.action.primary[hovered() ? "hovered" : "focused"]
            : hovered()
              ? theme.background.action.primary.hovered
              : undefined
      }
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => {
        setHovered(false)
        props.onLeave?.()
      }}
      onMouseUp={(event) => {
        event.stopPropagation()
        if (!props.disabled) props.onClick()
      }}
    >
      <text fg={theme.text.action.primary[state()]}>{primary() ? props.children : `[ ${props.children} ]`}</text>
    </box>
  )
}

function Action(props: {
  children: JSX.Element
  color: RGBA
  onClick: () => void
  disabled?: boolean
  onLeave?: () => void
  background?: RGBA
}) {
  const theme = useTheme().surface("dialog")
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      backgroundColor={hovered() && !props.disabled ? theme.background.raised.high : props.background}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => {
        setHovered(false)
        props.onLeave?.()
      }}
      onMouseUp={(event) => {
        event.stopPropagation()
        if (!props.disabled) props.onClick()
      }}
    >
      <text fg={props.disabled ? theme.text.action.primary.disabled : props.color}>{props.children}</text>
    </box>
  )
}
