import { Plugin } from "@opencode/plugin/tui"
import { For, Show } from "solid-js"
import { parseConfig, progressColor } from "./config.js"
import { Limits, type LimitsResult } from "./rpc.js"
import { formatExpiry } from "./resets.js"
import { formatReset, progressBar, type UsageWindow } from "./usage.js"

interface LimitsState extends Omit<LimitsResult, "status"> {
  status: LimitsResult["status"] | "loading"
  now: number
  bankedExpanded?: boolean
}

export default Plugin.define({
  id: "codex-limits.tui",
  setup(ctx) {
    const config = parseConfig(ctx.options)
    const rpc = ctx.client.rpc(Limits)
    const [limits, updateLimits] = ctx.storage.memory<LimitsState>("limits", {
      initial: { status: "loading", now: Date.now(), bankedExpanded: true },
    })
    let running = false
    let rerun = false
    let disposed = false

    function toggleBankedResets() {
      updateLimits((draft) => { draft.bankedExpanded = draft.bankedExpanded === false })
    }

    async function refresh(force = false) {
      if (running) {
        if (force) rerun = true
        return
      }
      running = true
      try {
        const result = await rpc.read(
          { refresh: force },
          {
            location: ctx.location ?? ctx.data.location.default(),
            signal: AbortSignal.timeout(10_000),
          },
        )
        if (!disposed) {
          const next = result as LimitsResult
          updateLimits((draft) => {
            draft.status = next.status
            draft.fiveHour = next.fiveHour
            draft.weekly = next.weekly
            draft.bankedResets = next.bankedResets
            draft.checkedAt = next.checkedAt
            draft.message = next.message
            draft.config = next.config
            draft.now = Date.now()
          })
        }
      } catch {
        if (!disposed) updateLimits((draft) => {
          draft.status = draft.fiveHour || draft.weekly ? "stale" : "unavailable"
          draft.message = "OpenCode service unavailable"
        })
      } finally {
        running = false
        if (rerun && !disposed) {
          rerun = false
          void refresh(true)
        }
      }
    }

    function WindowLine(props: { label: string; value?: UsageWindow }) {
      const bar = () => progressBar(props.value?.remainingPercent ?? 0, 15)
      const barColor = () => progressColor(props.value?.remainingPercent ?? 0, limits.config ?? config)
      return (
        <box flexDirection="row" width="100%" justifyContent="space-between" visible={props.value !== undefined}>
          <text fg={ctx.theme.text.base} flexShrink={0}>{props.label}</text>
          <box flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0} justifyContent="flex-end">
            <text fg={ctx.theme.text.base}>{formatReset(props.value?.resetsAt, limits.now, true)} </text>
            <box flexDirection="row" width={15} flexShrink={0}>
              <text fg={barColor()} width={bar().filled.length} flexShrink={0}>{bar().filled}</text>
              <text fg={ctx.theme.text.muted} width={bar().empty.length} flexShrink={0}>{bar().empty}</text>
            </box>
          </box>
        </box>
      )
    }

    function Sidebar(props: { sessionID: string }) {
      if (ctx.data.session.get(props.sessionID)?.model?.providerID !== "openai") return null
      return (
        <box flexDirection="column" gap={1}>
          <text fg={ctx.theme.text.base}><b>Codex limits</b>{limits.status === "stale" ? " (stale)" : ""}</text>
          <WindowLine label="5h" value={limits.fiveHour} />
          <WindowLine label="Weekly" value={limits.weekly} />
          <Show when={limits.bankedResets}>{(resets) => (
            <box flexDirection="column">
              <box onMouseUp={(event) => {
                if (event.button !== 0) return
                event.stopPropagation()
                toggleBankedResets()
              }}>
                <text fg={ctx.theme.text.base} selectable={false}>
                  {limits.bankedExpanded !== false ? "▾" : "▸"} Available resets ({resets().availableCount ?? "Unknown"})
                </text>
              </box>
              <box flexDirection="column" paddingLeft={2} visible={limits.bankedExpanded !== false}>
                <For each={resets().credits}>
                  {(credit) => (
                    <box flexDirection="column">
                      <Show when={credit.title}>
                        <text fg={ctx.theme.text.base}>• {credit.title}</text>
                      </Show>
                      <text fg={ctx.theme.text.muted}>{credit.title ? "  " : "• "}{formatExpiry(credit.expiresAt)}</text>
                    </box>
                  )}
                </For>
                <Show when={resets().availableCount === 0}>
                  <text fg={ctx.theme.text.muted}>No available resets</text>
                </Show>
                <Show when={resets().detailsStatus === "unavailable"}>
                  <text fg={ctx.theme.text.muted}>Reset details unavailable</text>
                </Show>
              </box>
            </box>
          )}</Show>
          <Show when={!limits.fiveHour && !limits.weekly}>
            <text fg={ctx.theme.text.muted}>{limits.message ?? "Loading…"}</text>
          </Show>
        </box>
      )
    }

    const removeSlot = ctx.ui.slot({ append: "sidebar.content", render: ({ sessionID }) => <Sidebar sessionID={sessionID} /> })
    const removeCommand = ctx.ui.slot({
      append: "app",
      render: () => {
        ctx.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "codex-limits.refresh",
            title: "Refresh Codex limits",
            group: "Codex",
            palette: true,
            run: () => refresh(true),
          }, {
            id: "codex-limits.toggle-banked-resets",
            title: "Toggle Codex available resets",
            group: "Codex",
            palette: true,
            run: toggleBankedResets,
          }, {
            id: "codex-limits.reset-details",
            title: "Show Codex reset details",
            group: "Codex",
            palette: true,
            run: async () => {
              await refresh(true)
              const resets = limits.bankedResets
              const lines = [`Available resets: ${resets?.availableCount ?? "Unknown"}`]
              if (limits.status === "stale") lines.push("Last successful snapshot; data may be stale.")
              if (!resets || resets.detailsStatus === "unavailable") lines.push("Reset details unavailable or incomplete.")
              for (const [index, credit] of (resets?.credits ?? []).entries()) {
                if (credit.title) {
                  lines.push(`${index + 1}. ${credit.title}`)
                  lines.push(`   ${formatExpiry(credit.expiresAt, true)}`)
                } else {
                  lines.push(`${index + 1}. ${formatExpiry(credit.expiresAt, true)}`)
                }
                if (credit.expiresAt !== undefined) {
                  lines.push(`   ${credit.expiresAt * 1000 <= limits.now ? "Expired" : `Expires in ${formatReset(credit.expiresAt, limits.now, true)}`}`)
                }
              }
              await ctx.ui.dialog.alert({ title: "Codex available resets", message: lines.join("\n") })
            },
          }],
        }))
        return null
      },
    })
    const stopExecution = ctx.data.on("session.execution.succeeded", (event) => {
      if (ctx.data.session.get(event.data.sessionID)?.model?.providerID !== "openai") return
      void refresh(true)
    })
    const stopSwitch = ctx.data.on("credential.switched", (event) => {
      if (event.data.integrationID !== "openai") return
      updateLimits((draft) => {
        draft.status = "loading"
        draft.fiveHour = undefined
        draft.weekly = undefined
        draft.bankedResets = undefined
        draft.message = undefined
      })
      void refresh(true)
    })
    // This is intentionally independent of the active route: some TUI routes
    // do not report themselves as session routes while the sidebar is visible.
    const poll = setInterval(() => void refresh(true), 90_000)
    const clock = setInterval(() => updateLimits((draft) => { draft.now = Date.now() }), 60_000)
    // Fetch at startup instead of waiting for a session-slot render effect.
    // This keeps the status available when the sidebar mounts after setup.
    void refresh()
    return () => {
      disposed = true
      clearInterval(poll)
      clearInterval(clock)
      stopSwitch()
      stopExecution()
      removeSlot()
      removeCommand()
    }
  },
})
