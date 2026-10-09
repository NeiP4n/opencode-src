import { Plugin } from "@opencode/plugin/tui"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { DialogMcp } from "../../component/dialog-mcp"
import { useT } from "../../util/i18n"

export function SidebarMcp(props: { context: Plugin.Context; sessionID: string }) {
  const [view, updateView] = props.context.storage.store("view", { initial: { open: true } })
  const theme = props.context.theme
  const t = useT()
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const list = createMemo(() => props.context.data.location.mcp.server.list(session()?.location) ?? [])
  const count = (status: string) => list().filter((item) => item.status.status === status).length
  const collapsible = createMemo(() => list().length > 2)
  const collapsed = () => collapsible() && !view.open

  const dot = (status: string) => {
    if (status === "connected") return theme.text.feedback.success.base
    if (status === "failed") return theme.text.feedback.error.base
    if (status === "disabled") return theme.text.muted
    if (status === "needs_auth") return theme.text.feedback.warning.base
    return theme.text.muted
  }

  return (
    <Show when={list().length > 0}>
      <box>
        <box
          flexDirection="row"
          justifyContent="space-between"
          gap={1}
          onMouseDown={() => {
            if (!collapsible()) return
            void updateView((draft) => {
              draft.open = !draft.open
            }).catch((error) => console.error("Failed to persist MCP sidebar state", error))
          }}
        >
          <text fg={theme.text.base} flexShrink={0}>
            <Show when={collapsible()}>{view.open ? "▼ " : "▶ "}</Show>
            <b>MCP</b>
          </text>
          <text fg={theme.text.muted} wrapMode="none">
            {t("{count}/{total} connected", { count: count("connected"), total: list().length })}
          </text>
        </box>
        {/* Expanded rows already show each problem; keep them visible while collapsed. */}
        <Show when={collapsed() && (count("failed") > 0 || count("needs_auth") > 0)}>
          <text wrapMode="none">
            <Show when={count("failed") > 0}>
              <span style={{ fg: theme.text.feedback.error.base }}>{t("{count} failed", { count: count("failed") })}</span>
            </Show>
            <Show when={count("failed") > 0 && count("needs_auth") > 0}>
              <span style={{ fg: theme.text.muted }}> · </span>
            </Show>
            <Show when={count("needs_auth") > 0}>
              <span style={{ fg: theme.text.feedback.warning.base }}>{t("{count} need sign in", { count: count("needs_auth") })}</span>
            </Show>
          </text>
        </Show>
        <Show when={!collapsed()}>
          <For each={list()}>
            {(item) => {
              const [hovered, setHovered] = createSignal(false)
              return (
                <box
                  flexDirection="row"
                  gap={1}
                  minWidth={0}
                  backgroundColor={hovered() ? theme.background.raised.high : undefined}
                  onMouseOver={() => setHovered(true)}
                  onMouseOut={() => setHovered(false)}
                  onMouseUp={() =>
                    props.context.ui.dialog.show(() => (
                      <DialogMcp initialServer={item.name} details={item.status.status === "failed"} />
                    ))
                  }
                >
                  <text
                    flexShrink={0}
                    style={{
                      fg: dot(item.status.status),
                    }}
                  >
                    •
                  </text>
                  <text fg={theme.text.base} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
                    <b>{item.name}</b>
                  </text>
                  <text
                    fg={item.status.status === "failed" ? theme.text.feedback.error.base : theme.text.muted}
                    wrapMode="none"
                    flexShrink={0}
                  >
                    <Switch fallback={item.status.status}>
                      <Match when={item.status.status === "connected"}>{t("Connected")}</Match>
                      <Match when={item.status.status === "pending"}>{t("Connecting")}</Match>
                      <Match when={item.status.status === "failed"}>{t("Error")}</Match>
                      <Match when={item.status.status === "disabled"}>{t("Disabled")}</Match>
                      <Match when={item.status.status === "needs_auth"}>{t("Sign in")}</Match>
                    </Switch>
                  </text>
                </box>
              )
            }}
          </For>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.mcp",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarMcp context={context} sessionID={props.sessionID} />,
    })
  },
})
