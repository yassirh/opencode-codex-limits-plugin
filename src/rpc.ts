import { Rpc } from "@opencode/plugin/rpc"
import type { UsageWindow } from "./usage.js"
import type { BankedResets } from "./resets.js"
import type { LimitsConfig } from "./config.js"

export interface LimitsResult {
  status: "ready" | "stale" | "unavailable"
  fiveHour?: UsageWindow
  weekly?: UsageWindow
  bankedResets?: BankedResets
  checkedAt?: number
  message?: string
  config?: LimitsConfig
}

const window = {
  type: "object",
  properties: {
    remainingPercent: { type: "number" },
    resetsAt: { type: "number" },
  },
  required: ["remainingPercent"],
  additionalProperties: false,
} as const

export const Limits = Rpc.define({
  id: "codex-limits",
  methods: {
    read: {
      input: {
        type: "object",
        properties: { refresh: { type: "boolean" } },
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["ready", "stale", "unavailable"] },
          fiveHour: window,
          weekly: window,
          bankedResets: {
            type: "object",
            properties: {
              availableCount: { type: "integer", minimum: 0 },
              detailsStatus: { type: "string", enum: ["ready", "unavailable"] },
              credits: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    expiresAt: { type: "number" },
                    title: { type: "string" },
                  },
                  additionalProperties: false,
                },
              },
            },
            required: ["detailsStatus"],
            additionalProperties: false,
          },
          checkedAt: { type: "number" },
          message: { type: "string" },
          config: {
            type: "object",
            properties: {
              levels: {
                type: "object",
                properties: { healthy: { type: "number" }, warning: { type: "number" } },
                required: ["healthy", "warning"],
                additionalProperties: false,
              },
              colors: {
                type: "object",
                properties: {
                  healthy: { type: "string" },
                  warning: { type: "string" },
                  critical: { type: "string" },
                },
                required: ["healthy", "warning", "critical"],
                additionalProperties: false,
              },
            },
            required: ["levels", "colors"],
            additionalProperties: false,
          },
        },
        required: ["status"],
        additionalProperties: false,
      },
    },
  },
  events: {},
})
