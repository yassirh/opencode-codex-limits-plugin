import assert from "node:assert/strict"
import test from "node:test"
import { parseResetCredits, resetCount } from "../dist/resets.js"
import { parseUsage } from "../dist/usage.js"

test("available resets are sorted by exact expiry, omitting inactive and expired entries", () => {
  assert.deepEqual(parseResetCredits({ credits: [
    { status: "available", expires_at: "2026-10-12T14:30:00Z" },
    { status: "redeemed", expires_at: "2026-10-03T00:00:00Z" },
    { status: "available", expires_at: "2026-10-01T00:00:00Z" },
    { status: "available", expires_at: 1790985600 },
    { status: "available", expires_at: null },
    { status: "available", reset_type: "other", expires_at: 1790985600 },
  ] }, Date.parse("2026-10-02T00:00:00Z")), {
    availableCount: 4,
    detailsStatus: "ready",
    credits: [{ expiresAt: 1790985600 }, { expiresAt: 1790985600 }, { expiresAt: Date.parse("2026-10-12T14:30:00Z") / 1000 }, {}],
  })
})

test("reset titles come directly from the API without type fallbacks", () => {
  const result = parseResetCredits({ credits: [
    { status: "available", reset_type: "codex_rate_limits", title: "Full reset (Weekly + 5 hr)" },
    { status: "available", reset_type: "other", title: "A different reset" },
    { status: "available", reset_type: "codex_rate_limits" },
    { status: "available", title: null },
    { status: "available", title: " " },
  ] })
  assert.equal(result.availableCount, 5)
  assert.deepEqual(result.credits.map((credit) => credit.title), [
    "Full reset (Weekly + 5 hr)", "A different reset", undefined, undefined, undefined,
  ])
})

test("missing and incomplete reset details never invent a zero count or expiry", () => {
  for (const body of [null, {}, { credits: null }, { credits: [null] }, { credits: [{}] }]) {
    assert.equal(parseResetCredits(body), undefined)
  }
  assert.deepEqual(parseResetCredits({ available_count: 2, credits: [] }), {
    availableCount: 2, detailsStatus: "unavailable", credits: [],
  })
  assert.deepEqual(parseResetCredits({ available_count: 0, credits: [] }), {
    availableCount: 0, detailsStatus: "ready", credits: [],
  })
  assert.deepEqual(parseResetCredits({ credits: [{ status: "available", expires_at: "bad date" }] }), {
    availableCount: 1, detailsStatus: "ready", credits: [{}],
  })
  for (const value of [undefined, null, -1, 0.5, "2", Infinity]) assert.equal(resetCount(value), undefined)
})

test("usage preserves known banked counts while distinguishing missing metadata", () => {
  const rate_limit = { primary_window: { limit_window_seconds: 18000, used_percent: 10 } }
  assert.equal(parseUsage({ rate_limit }).bankedResets, undefined)
  assert.deepEqual(parseUsage({ rate_limit, rate_limit_reset_credits: { available_count: 2 } }).bankedResets, {
    availableCount: 2, detailsStatus: "unavailable",
  })
})
