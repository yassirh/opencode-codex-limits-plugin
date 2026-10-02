import assert from "node:assert/strict"
import test from "node:test"
import plugin from "../dist/index.js"

test("server uses the active OAuth account, caches safely and marks failed refreshes stale", async () => {
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  let time = 1_000_000
  let current = { type: "credential", id: "oauth-1" }
  let credential = { type: "oauth", access: "token-1", metadata: { accountID: "account-1" } }
  let fail = false
  const requests = []
  let read
  Date.now = () => time
  globalThis.fetch = async (url, init) => {
    requests.push({ url, authorization: init.headers.Authorization, account: init.headers["ChatGPT-Account-Id"] })
    if (fail) return new Response("", { status: 503 })
    if (url.endsWith("rate-limit-reset-credits")) return Response.json({
      available_count: 1,
      credits: [{ status: "available", reset_type: "codex_rate_limits", title: "Full reset (Weekly + 5 hr)", expires_at: 5000 }],
    })
    return Response.json({ rate_limit: {
      primary_window: { used_percent: 40, limit_window_seconds: 18000, reset_at: 2000 },
      secondary_window: { used_percent: 20, limit_window_seconds: 604800, reset_at: 3000 },
    } })
  }
  try {
    await plugin.setup({
      options: { levels: { healthy: 80, warning: 20 }, colors: { warning: "#ff9900" } },
      integration: { connection: {
        active: async () => current,
        resolve: async () => credential,
      } },
      rpc: { register: async (_definition, handlers) => { read = handlers.read } },
    })
    const first = await read({}, { signal: new AbortController().signal })
    assert.equal(first.status, "ready")
    assert.equal(first.fiveHour.remainingPercent, 60)
    assert.equal(first.weekly.remainingPercent, 80)
    assert.deepEqual(first.config, {
      levels: { healthy: 80, warning: 20 },
      colors: { healthy: "#22c55e", warning: "#ff9900", critical: "#ef4444" },
    })
    assert.deepEqual(first.bankedResets, {
      availableCount: 1, detailsStatus: "ready", credits: [{ title: "Full reset (Weekly + 5 hr)", expiresAt: 5000 }],
    })
    assert.equal(requests[1].authorization, "Bearer token-1")
    assert.equal(requests[1].account, "account-1")
    assert.deepEqual(requests[0], {
      url: "https://chatgpt.com/backend-api/wham/usage",
      authorization: "Bearer token-1",
      account: "account-1",
    })
    assert.equal(JSON.stringify(first).includes("token-1"), false)

    await read({}, { signal: new AbortController().signal })
    assert.equal(requests.length, 2)
    time += 91_000
    fail = true
    const stale = await read({}, { signal: new AbortController().signal })
    assert.equal(stale.status, "stale")
    assert.equal(stale.fiveHour.remainingPercent, 60)
    assert.deepEqual(stale.config, first.config)

    current = { type: "credential", id: "oauth-2" }
    credential = { type: "oauth", access: "token-2", metadata: { accountID: "account-2" } }
    const other = await read({}, { signal: new AbortController().signal })
    assert.equal(other.status, "unavailable")
    assert.equal(other.fiveHour, undefined)
    assert.deepEqual(other.config, first.config)
    assert.equal(requests.at(-1).account, "account-2")

    credential = { type: "key", key: "api-key" }
    const apiKey = await read({}, { signal: new AbortController().signal })
    assert.equal(apiKey.status, "unavailable")
    assert.equal(apiKey.fiveHour, undefined)
    assert.equal(requests.length, 4)
  } finally {
    globalThis.fetch = originalFetch
    Date.now = originalNow
  }
})

test("reset detail failures preserve quota and count, and zero resets skips the extra request", async () => {
  const originalFetch = globalThis.fetch
  let availableCount = 2
  let resetRequests = 0
  let read
  globalThis.fetch = async (url) => {
    if (url.endsWith("rate-limit-reset-credits")) {
      resetRequests++
      throw new Error("Reset endpoint unavailable")
    }
    return Response.json({
      rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18000 } },
      rate_limit_reset_credits: { available_count: availableCount },
    })
  }
  try {
    for (const count of [2, 0]) {
      availableCount = count
      await plugin.setup({
        integration: { connection: {
          active: async () => ({ type: "credential", id: "oauth" }),
          resolve: async () => ({ type: "oauth", access: "token", metadata: { accountID: "account" } }),
        } },
        rpc: { register: async (_definition, handlers) => { read = handlers.read } },
      })
      const result = await read({}, { signal: new AbortController().signal })
      assert.equal(result.status, "ready")
      assert.equal(result.fiveHour.remainingPercent, 90)
      assert.deepEqual(result.bankedResets, {
        availableCount: count, detailsStatus: count === 0 ? "ready" : "unavailable",
      })
    }
    assert.equal(resetRequests, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
