import assert from "node:assert/strict"
import test from "node:test"
import { parseConfig, progressColor } from "../dist/config.js"

test("default health colors respect strict threshold boundaries", () => {
  const config = parseConfig(undefined)
  assert.equal(progressColor(30.1, config), "#22c55e")
  assert.equal(progressColor(30, config), "#f97316")
  assert.equal(progressColor(20.1, config), "#f97316")
  assert.equal(progressColor(20, config), "#ef4444")
  assert.equal(progressColor(0, config), "#ef4444")
})

test("custom colors and thresholds support partial overrides", () => {
  const config = parseConfig({
    levels: { healthy: 60, warning: 40 },
    colors: { healthy: "#ABCDEF", critical: "#123456" },
  })
  assert.equal(progressColor(61, config), "#ABCDEF")
  assert.equal(progressColor(60, config), "#f97316")
  assert.equal(progressColor(40, config), "#123456")
  assert.deepEqual(parseConfig({ levels: { healthy: 50 } }).levels, { healthy: 50, warning: 20 })
  assert.deepEqual(parseConfig({ levels: { warning: 10 } }).levels, { healthy: 30, warning: 10 })
})

test("invalid options fall back without discarding valid color overrides", () => {
  for (const levels of [
    { healthy: 20, warning: 20 }, { healthy: 10 }, { warning: -1 },
    { healthy: 101 }, { warning: "10" }, { healthy: NaN }, { warning: Infinity },
  ]) {
    assert.deepEqual(parseConfig({ levels }).levels, { healthy: 30, warning: 20 })
  }
  const config = parseConfig({ colors: { healthy: "green", warning: "#123", critical: "#123456" } })
  assert.deepEqual(config.colors, { healthy: "#22c55e", warning: "#f97316", critical: "#123456" })
  for (const options of [null, [], "invalid", { levels: null, colors: [] }]) {
    assert.deepEqual(parseConfig(options), parseConfig(undefined))
  }
})
