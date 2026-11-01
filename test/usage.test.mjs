import assert from "node:assert/strict"
import test from "node:test"
import { parseUsage, formatReset, progressBar, progressLabel } from "../dist/usage.js"

test("identifies windows by duration, independent of primary/secondary position", () => {
  const result = parseUsage({ rate_limit: {
    primary_window: { limit_window_seconds: 604800, used_percent: 21, reset_at: 1780100000 },
    secondary_window: { limit_window_seconds: 18000, used_percent: 34.5, reset_at: 1780000000 },
  } }, 123)
  assert.deepEqual(result, {
    checkedAt: 123,
    fiveHour: { remainingPercent: 65.5, resetsAt: 1780000000 },
    weekly: { remainingPercent: 79, resetsAt: 1780100000 },
  })
})

test("weekly-only payload never invents a 5h window", () => {
  const result = parseUsage({ rate_limit: {
    primary_window: { limit_window_seconds: 604800, used_percent: 10 },
    secondary_window: null,
  } }, 123)
  assert.deepEqual(result, { checkedAt: 123, weekly: { remainingPercent: 90 } })
})

test("rejects unusable percentages and clamps out-of-range values", () => {
  assert.equal(parseUsage({ rate_limit: { primary_window: { limit_window_seconds: 18000, used_percent: "20" } } }), undefined)
  assert.deepEqual(parseUsage({ rate_limit: { primary_window: { limit_window_seconds: 18000, used_percent: 120 } } }, 123)?.fiveHour, { remainingPercent: 0 })
  assert.equal(formatReset(undefined), "reset time unavailable")
  assert.equal(formatReset(100, 100_000), "reset due; refreshing soon")
})

test("renders remaining capacity as a fixed-width progress bar", () => {
  assert.deepEqual(progressBar(65), { filled: "█████████████", empty: "░░░░░░░" })
  assert.deepEqual(progressBar(-10, 4), { filled: "", empty: "░░░░" })
  assert.deepEqual(progressBar(110, 4), { filled: "████", empty: "" })
})

test("centers whole remaining percentages and preserves the fill boundary behind the label", () => {
  assert.deepEqual(progressLabel(0, 15), { left: 6, filled: "", empty: "0%" })
  assert.deepEqual(progressLabel(9.4, 15), { left: 6, filled: "", empty: "9%" })
  assert.deepEqual(progressLabel(9.5, 15), { left: 6, filled: "", empty: "10%" })
  assert.deepEqual(progressLabel(49.5, 15), { left: 6, filled: "5", empty: "0%" })
  assert.deepEqual(progressLabel(50, 15), { left: 6, filled: "50", empty: "%" })
  assert.deepEqual(progressLabel(65.5, 15), { left: 6, filled: "66%", empty: "" })
  assert.deepEqual(progressLabel(99.5, 15), { left: 5, filled: "100%", empty: "" })
  assert.deepEqual(progressLabel(100, 15), { left: 5, filled: "100%", empty: "" })
  assert.deepEqual(progressLabel(-10, 15), progressLabel(0, 15))
  assert.deepEqual(progressLabel(110, 15), progressLabel(100, 15))
})
