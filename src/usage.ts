import { resetCount, type BankedResets } from "./resets.js"

export interface UsageWindow {
  remainingPercent: number
  resetsAt?: number // Unix seconds
}

export interface UsageSnapshot {
  bankedResets?: BankedResets
  fiveHour?: UsageWindow
  weekly?: UsageWindow
  checkedAt: number // Unix milliseconds
}

const FIVE_HOURS = 5 * 60 * 60
const WEEK = 7 * 24 * 60 * 60

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function windowFrom(value: unknown): { duration: number; window: UsageWindow } | undefined {
  const input = record(value)
  if (!input) return
  const duration = input.limit_window_seconds
  const used = input.used_percent
  if (typeof duration !== "number" || !Number.isFinite(duration)) return
  if (typeof used !== "number" || !Number.isFinite(used)) return

  const reset = input.reset_at
  return {
    duration,
    window: {
      remainingPercent: Math.max(0, Math.min(100, 100 - used)),
      ...(typeof reset === "number" && Number.isSafeInteger(reset) && reset > 0
        ? { resetsAt: reset }
        : {}),
    },
  }
}

export function parseUsage(body: unknown, checkedAt = Date.now()): UsageSnapshot | undefined {
  const rateLimit = record(record(body)?.rate_limit)
  if (!rateLimit) return

  const snapshot: UsageSnapshot = { checkedAt }
  const availableCount = resetCount(record(record(body)?.rate_limit_reset_credits)?.available_count)
  if (availableCount !== undefined) {
    snapshot.bankedResets = { availableCount, detailsStatus: availableCount === 0 ? "ready" : "unavailable" }
  }
  for (const value of [rateLimit.primary_window, rateLimit.secondary_window]) {
    const entry = windowFrom(value)
    if (entry?.duration === FIVE_HOURS) snapshot.fiveHour = entry.window
    if (entry?.duration === WEEK) snapshot.weekly = entry.window
  }
  if (!snapshot.fiveHour && !snapshot.weekly) return
  return snapshot
}

export function formatReset(resetsAt: number | undefined, now = Date.now(), compact = false): string {
  if (resetsAt === undefined) return compact ? "unknown" : "reset time unavailable"
  const remaining = Math.max(0, resetsAt * 1000 - now)
  if (remaining === 0) return compact ? "due" : "reset due; refreshing soon"
  const minutes = Math.ceil(remaining / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (compact) return days ? `${days}d ${hours}h ${String(mins).padStart(2, "0")}m` : hours ? `${hours}h ${String(mins).padStart(2, "0")}m` : `${mins}m`
  const countdown = days ? `${days}d ${hours}h` : hours ? `${hours}h ${mins}m` : `${mins}m`
  return `resets in ${countdown}`
}

export function progressBar(remainingPercent: number, width = 20): { filled: string; empty: string } {
  const safeWidth = Math.max(1, Math.floor(width))
  const percent = Math.max(0, Math.min(100, remainingPercent))
  const filled = Math.round((percent / 100) * safeWidth)
  return { filled: "█".repeat(filled), empty: "░".repeat(safeWidth - filled) }
}
