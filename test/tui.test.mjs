import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import plugin from "../dist/tui.js"
import { createComputed, createMemo, createRoot, createSignal } from "solid-js/dist/solid.js"
import { progressColor } from "../dist/config.js"
import { formatReset } from "../dist/usage.js"

test("TUI build uses reactive Solid JSX and OpenCode memory storage", async () => {
  const code = await readFile(new URL("../dist/tui.js", import.meta.url), "utf8")
  assert.match(code, /from "solid-js\/dist\/solid\.js"/)
  assert.match(code, /get when\(\)/)
  assert.doesNotMatch(code, /@opentui\/solid\/jsx-runtime/)
  assert.match(code, /ctx\.storage\.memory\("limits"/)
  assert.match(code, /get value\(\)\s*\{\s*return limits\.fiveHour;/)
  assert.match(code, /get value\(\)\s*\{\s*return limits\.weekly;/)
})

test("refresh replaces an expired quota window and updates the clock immediately", async () => {
  const claims = new Map()
  let commands
  const now = Date.now()
  let snapshot = { status: "ready", fiveHour: { remainingPercent: 0, resetsAt: Math.floor(now / 1000) - 60 } }
  const state = { status: "loading", now: now - 600_000 }
  const cleanup = plugin.setup({
    client: { rpc: () => ({ read: async () => snapshot }) },
    data: {
      on: () => () => {},
      location: { default: () => ({ directory: "/workspace" }) },
    },
    storage: { memory: () => [state, (update) => update(state)] },
    ui: { slot: (claim) => {
      claims.set(claim.append, claim)
      return () => claims.delete(claim.append)
    } },
    keymap: { layer: (getLayer) => { commands = getLayer().commands } },
  })
  try {
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(formatReset(state.fiveHour.resetsAt, state.now, true), "due")
    snapshot = {
      status: "ready",
      fiveHour: { remainingPercent: 98, resetsAt: Math.floor(now / 1000) + 18000 },
      weekly: { remainingPercent: 49, resetsAt: Math.floor(now / 1000) + 86400 },
    }
    claims.get("app").render()
    await commands.find((command) => command.id === "codex-limits.refresh").run()
    assert.equal(state.fiveHour.remainingPercent, 98)
    assert.equal(state.fiveHour.resetsAt, snapshot.fiveHour.resetsAt)
    assert.equal(state.weekly.resetsAt, snapshot.weekly.resetsAt)
    assert.ok(state.now >= now)
    assert.equal(formatReset(state.fiveHour.resetsAt, state.now, true), "5h 00m")
  } finally {
    cleanup()
  }
})

test("banked reset toggle is reactive and stays collapsed across refreshes", async () => {
  const claims = new Map()
  let commands
  let dispose
  const observed = []
  const serverConfig = {
    levels: { healthy: 80, warning: 20 },
    colors: { healthy: "#22c55e", warning: "#f97316", critical: "#ef4444" },
  }
  const [getState, setState] = createSignal({
    status: "ready", now: Date.now(),
    bankedResets: {
      availableCount: 2, detailsStatus: "ready",
      credits: [{ expiresAt: 1900000000 }, { expiresAt: 1900100000 }],
    },
  })
  const state = new Proxy({}, {
    get: (_target, key) => getState()[key],
    ownKeys: () => Reflect.ownKeys(getState()),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  })
  createRoot((stop) => {
    dispose = stop
    const expanded = createMemo(() => state.bankedExpanded !== false)
    createComputed(() => observed.push(expanded()))
  })
  const cleanup = plugin.setup({
    client: { rpc: () => ({ read: async () => ({
      status: "ready", bankedResets: state.bankedResets, config: serverConfig,
    }) }) },
    data: {
      on: () => () => {},
      location: { default: () => ({ directory: "/workspace" }) },
      session: { get: () => ({ model: { providerID: "openai" } }) },
    },
    storage: { memory: () => [state, (update) => {
      const draft = { ...state }
      update(draft)
      setState(draft)
    }] },
    ui: { slot: (claim) => {
      claims.set(claim.append, claim)
      return () => claims.delete(claim.append)
    } },
    keymap: { layer: (getLayer) => { commands = getLayer().commands } },
  })
  try {
    await new Promise((resolve) => setImmediate(resolve))
    // The automatically loaded TUI may receive no options; server settings must still reach it.
    assert.deepEqual(state.config, serverConfig)
    assert.equal(progressColor(74, state.config), "#f97316")
    claims.get("app").render()
    const toggle = commands.find((command) => command.id === "codex-limits.toggle-banked-resets")
    toggle.run()
    assert.equal(state.bankedExpanded, false)
    await commands.find((command) => command.id === "codex-limits.refresh").run()
    assert.equal(state.bankedExpanded, false)
    toggle.run()
    assert.equal(state.bankedExpanded, true)
    assert.deepEqual(observed, [true, false, true])
  } finally {
    dispose()
    cleanup()
  }
})

test("registers the refresh keymap only after the app slot mounts and fetches at startup", async () => {
  const claims = new Map()
  let mounted = false
  let registered = false
  let reads = 0
  const handlers = new Map()
  const state = { status: "loading", now: Date.now() }
  const cleanup = plugin.setup({
    client: { rpc: () => ({ read: async () => {
      reads++
      return { status: "unavailable" }
    } }) },
    data: {
      on: (type, handler) => {
        handlers.set(type, handler)
        return () => handlers.delete(type)
      },
      location: { default: () => ({ directory: "/workspace" }) },
      session: { get: () => ({ model: { providerID: "openai" } }) },
    },
    storage: { memory: () => [state, (update) => update(state)] },
    ui: { slot(claim) {
      claims.set(claim.append, claim)
      return () => claims.delete(claim.append)
    } },
    keymap: { layer(getLayer) {
      assert.equal(mounted, true)
      assert.equal(getLayer().commands[0].id, "codex-limits.refresh")
      registered = true
    } },
  })
  try {
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(reads, 1)
    handlers.get("session.execution.succeeded")({ data: { sessionID: "ses_1" } })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(reads, 2)
    assert.equal(registered, false)
    assert.equal(claims.has("sidebar.content"), true)
    mounted = true
    claims.get("app").render()
    assert.equal(registered, true)
  } finally {
    cleanup()
  }
  assert.equal(claims.size, 0)
  assert.equal(handlers.size, 0)
})
