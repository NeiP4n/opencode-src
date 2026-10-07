import { TextAttributes, type RGBA } from "@opentui/core"
import { createMemo, createSignal, For, onMount, Show, type JSX } from "solid-js"
import { Hub } from "@opencode/core/hub/index"
import { HubState } from "@opencode/core/hub/state"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { hubRegistryStatus, type RegistryOptions, type RegistryTool } from "../util/hub-registry"
import { PanelBox, PanelTitle, Row } from "./devtools-panel"

// Interactive catalog control for the Universal Tool Hub. Every row is one
// binary the catalog depends on: the operator installs or removes it, and
// switches it on or off for the model.
//
// The switch is the hint block's opt-in flag. On means the tool is advertised
// in the system prompt and its entries stay discoverable; off (the default) is
// not advertised, and switching a tool off again additionally withdraws its
// entries from the `hub` tool's listing. Nothing else about the session
// changes, and the pre-feature default is untouched: an empty state file shows
// every switch off and behaves exactly as before.
//
// Removal runs a package manager, so it takes two clicks on the same button
// ("Rm" arms, "Remove?" executes); clicking anything else or leaving the
// button disarms it — no typed confirmation, per the owner's request. While
// an action is pending the controls are disabled, the outcome goes through a
// toast, and a failure pins the exact command to rerun by hand to the row note.
//
// The panel is bounded: ten rows per page over a catalog that carries far more
// tools than the popover's 42 usable columns or the terminal has lines.

const PAGE_SIZE = 10
const TOOL_COLUMN = 14

export type RegistryPanelOptions = RegistryOptions & {
  // `hub.json` directory; tests point this at a temp dir instead of the Global
  // state directory so a click never edits the operator's real selection.
  directory?: string
  // Package-manager actions; tests replace them so no command ever runs.
  install?: (tool: string) => Promise<Hub.ActionResult>
  remove?: (tool: string) => Promise<Hub.ActionResult>
}

export function RegistryPanel(props: { options?: RegistryPanelOptions }) {
  const theme = useTheme()
  const toast = useToast()
  const options = props.options ?? {}
  const [enabled, setEnabled] = createSignal<Readonly<Record<string, boolean>>>({})
  // Bumped after anything that can change PATH or the state file, so the
  // memo re-probes instead of trusting a stale readiness count.
  const [revision, setRevision] = createSignal(0)
  const [busy, setBusy] = createSignal<string>()
  const [armed, setArmed] = createSignal<string>()
  const [message, setMessage] = createSignal<string>()
  const [page, setPage] = createSignal(0)

  // A click that lands before the state file resolves is the operator's newest
  // intent, so the slow read must not overwrite it. The panel opens on the
  // opt-in default (everything off) either way.
  let interacted = false
  // Queues hub.json writes: a second click before the first lands would
  // otherwise read-modify-write the file concurrently and lose an update.
  let writes: Promise<void> = Promise.resolve()
  onMount(async () => {
    const state = await HubState.read({ directory: options.directory }).catch(() => ({
      version: 1 as const,
      enabled: {},
    }))
    if (!interacted) setEnabled(state.enabled)
    setRevision((value) => value + 1)
  })

  const status = createMemo(() => {
    revision()
    // Only the registry inputs travel on: `directory` and the injected actions
    // belong to this panel, not to the status probe.
    return hubRegistryStatus({ probe: options.probe, platform: options.platform, enabled: enabled() })
  })
  const pages = createMemo(() => Math.max(1, Math.ceil(status().tools.length / PAGE_SIZE)))
  const rows = createMemo(() => {
    const start = Math.min(page(), pages() - 1) * PAGE_SIZE
    return status().tools.slice(start, start + PAGE_SIZE)
  })

  const runAction = async (tool: string, verb: "installed" | "removed", action: (tool: string) => Promise<Hub.ActionResult>) => {
    setBusy(tool)
    setMessage()
    const result = await action(tool).catch((error: unknown) => ({
      ok: false,
      exit: 1,
      output: error instanceof Error ? error.message : String(error),
      command: "",
    }))
    // The note is one line wide: on failure it pins the command to rerun by
    // hand, while the transient toast carries the manager's own last output
    // line as the reason — the exit code alone decided (plan.md, «Совет ИИ»).
    const reason = `${tool} failed: ${lastLine(result.output)}`
    const line = result.ok ? `${tool} ${verb}` : `${tool}: ${result.command || lastLine(result.output)}`
    setMessage(line)
    toast.show({ message: result.ok ? line : reason, variant: result.ok ? "success" : "error" })
    setBusy()
    setRevision((value) => value + 1)
  }

  const onToggle = (tool: string) => {
    setArmed()
    if (busy() !== undefined) return
    void toggle(tool)
  }

  const onInstall = (tool: string) => {
    setArmed()
    if (busy() !== undefined) return
    void runAction(tool, "installed", options.install ?? Hub.HubActions.installTool)
  }

  const onRemove = (tool: string) => {
    if (busy() !== undefined) return
    // The first click only arms the destructive action; the second runs it.
    if (armed() !== tool) {
      setArmed(tool)
      return
    }
    setArmed()
    void runAction(tool, "removed", options.remove ?? Hub.HubActions.removeTool)
  }

  const toggle = async (tool: string) => {
    interacted = true
    const next = !isOn(tool)
    // Optimistic: the switch reflects the click immediately, and the file write
    // only decides the next session's prompt block.
    setEnabled((previous) => ({ ...previous, [tool]: next }))
    const write = writes.then(() => HubState.setEnabled(tool, next, { directory: options.directory }))
    writes = write.catch(() => undefined)
    // A failed write hands the file-derived value back to the previous selection.
    await write.catch(() => setEnabled((previous) => ({ ...previous, [tool]: !next })))
  }

  const isOn = (tool: string) => enabled()[tool] === true
  const turnOn = () => status().tools.filter((row) => isOn(row.tool)).length

  return (
    <PanelBox>
      <PanelTitle>Registry</PanelTitle>
      <Row label="Ready" value={`${status().ready}/${status().total}`} />
      <Row
        label="Terminals"
        value={status()
          .terminals.map((terminal) => `${terminal.name} ${terminal.present ? "✓" : "×"}`)
          .join(" ")}
      />
      <Row label="For the model" value={`${turnOn()}/${status().tools.length}`} />

      <Header>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          Categories
        </text>
      </Header>
      <text fg={theme.text.muted} wrapMode="word">
        {status()
          .categories.map((entry) => `${entry.name} ${entry.ready}/${entry.total}`)
          .join(" ")}
      </text>

      <Header>
        <box flexDirection="row">
          <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
            Tools
          </text>
          <box flexGrow={1} />
          <Pager
            label={`${page() + 1}/${pages()}`}
            previous={() => setPage((value) => Math.max(0, value - 1))}
            next={() => setPage((value) => Math.min(pages() - 1, value + 1))}
          />
        </box>
      </Header>
      <For each={rows()}>
        {(row) => (
          <ToolRow
            tool={row}
            on={isOn(row.tool)}
            pending={busy() !== undefined}
            working={busy() === row.tool}
            armed={armed() === row.tool}
            onToggle={() => onToggle(row.tool)}
            onInstall={() => onInstall(row.tool)}
            onRemove={() => onRemove(row.tool)}
            onDisarm={() => setArmed()}
          />
        )}
      </For>
      <Show when={rows().length === 0}>
        <text fg={theme.text.muted}>No catalog tools on this platform.</text>
      </Show>

      <Show when={message()}>{(text) => <Note>{text()}</Note>}</Show>
    </PanelBox>
  )
}

function ToolRow(props: {
  tool: RegistryTool
  on: boolean
  pending: boolean
  working: boolean
  armed: boolean
  onToggle: () => void
  onInstall: () => void
  onRemove: () => void
  onDisarm: () => void
}) {
  const theme = useTheme()
  return (
    <box flexDirection="row">
      <Chip
        disabled={props.pending}
        onClick={props.onToggle}
        color={props.on ? theme.text.feedback.success.base : theme.text.feedback.error.base}
      >
        {props.on ? "[on]" : "[off]"}
      </Chip>
      <box width={TOOL_COLUMN}>
        <text fg={props.tool.installed ? theme.text.base : theme.text.muted} wrapMode="none" truncate>
          {props.tool.tool}
        </text>
      </box>
      <text fg={theme.text.muted}>{props.tool.entries}</text>
      <box flexGrow={1} />
      <Show when={props.working}>
        <text fg={theme.text.muted}>…</text>
      </Show>
      <Show when={!props.working && props.tool.installed}>
        <Chip
          disabled={props.pending}
          onLeave={props.onDisarm}
          onClick={props.onRemove}
          color={theme.text.action.primary.base}
        >
          {props.armed ? "Remove?" : "Rm"}
        </Chip>
      </Show>
      <Show when={!props.working && !props.tool.installed}>
        <Chip disabled={props.pending} onClick={props.onInstall} color={theme.text.action.primary.base}>
          Install
        </Chip>
      </Show>
    </box>
  )
}

function Pager(props: { label: string; previous: () => void; next: () => void }) {
  const theme = useTheme()
  return (
    <box flexDirection="row">
      <Action onClick={props.previous} color={theme.text.action.primary.base}>
        ‹
      </Action>
      <Chip onClick={() => {}} color={theme.text.muted}>
        {props.label}
      </Chip>
      <Action onClick={props.next} color={theme.text.action.primary.base}>
        ›
      </Action>
    </box>
  )
}

function Header(props: { children: JSX.Element }) {
  return <box marginTop={1}>{props.children}</box>
}

function Note(props: { children: string }) {
  const theme = useTheme()
  return (
    <text fg={theme.text.muted} wrapMode="word">
      {props.children}
    </text>
  )
}

function Chip(props: { children: string; color: RGBA; onClick: () => void; disabled?: boolean; onLeave?: () => void }) {
  return (
    <Action onClick={props.onClick} color={props.color} disabled={props.disabled} onLeave={props.onLeave}>
      {` ${props.children} `}
    </Action>
  )
}

function Action(props: {
  children: JSX.Element
  color: RGBA
  onClick: () => void
  disabled?: boolean
  onLeave?: () => void
}) {
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      backgroundColor={hovered() && !props.disabled ? theme.background.raised.high : undefined}
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
      <text fg={props.disabled ? theme.text.muted : props.color}>{props.children}</text>
    </box>
  )
}

function lastLine(value: string) {
  return value
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .at(-1) ?? "failed"
}
