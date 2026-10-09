import { Plugin } from "@opencode/plugin/tui"
import { createMemo, Show } from "solid-js"
import { contextUsage } from "../../util/session"
import { Locale } from "../../util/locale"
import { SESSION_SIDEBAR_WIDTH } from "../../ui/layout"
import { useT } from "../../util/i18n"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

// Sidebar padding (2 + 2) plus the column reserved for the scrollbar.
const BAR_WIDTH = SESSION_SIDEBAR_WIDTH - 5

export function SidebarContext(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const t = useT()
  const msg = createMemo(() => props.context.data.session.message.list(props.sessionID))
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const cost = createMemo(() => props.context.data.session.cost(props.sessionID))

  const state = createMemo(() =>
    contextUsage(msg(), props.context.data.location.model.list(session()?.location), session()?.revert?.messageID),
  )
  // A nearly full window is about to compact, which is worth flagging as status feedback.
  const level = (percent: number) => {
    if (percent >= 90) return theme.text.feedback.error.base
    if (percent >= 75) return theme.text.feedback.warning.base
    return theme.text.base
  }

  return (
    <Show when={state() || cost() > 0}>
      <box>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text.base}>
            <b>{t("Context")}</b>
          </text>
          <Show when={state()?.percent}>{(percent) => <text fg={level(percent())}>{t("{percent}% used", { percent: percent() })}</text>}</Show>
        </box>
        <Show when={state()?.percent}>
          {(percent) => {
            const filled = () => Math.min(BAR_WIDTH, Math.round((percent() / 100) * BAR_WIDTH))
            return (
              <text wrapMode="none">
                <span style={{ fg: level(percent()) }}>{"█".repeat(filled())}</span>
                <span style={{ fg: theme.text.muted }}>{"░".repeat(BAR_WIDTH - filled())}</span>
              </text>
            )
          }}
        </Show>
        <box flexDirection="row" justifyContent="space-between" gap={1}>
          <Show when={state()}>
            {(value) => (
              <text fg={theme.text.muted} wrapMode="none">
                {Locale.number(value().tokens)}
                <Show when={value().limit}>{(limit) => ` / ${Locale.number(limit())}`}</Show> {t("tokens")}
              </text>
            )}
          </Show>
          <Show when={cost() > 0}>
            <text fg={theme.text.muted} wrapMode="none" flexShrink={0}>
              {t("{cost} spent", { cost: money.format(cost()) })}
            </text>
          </Show>
        </box>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.context",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarContext context={context} sessionID={props.sessionID} />,
    })
  },
})
