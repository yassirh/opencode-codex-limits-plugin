export interface LimitsConfig {
  levels: { healthy: number; warning: number }
  colors: { healthy: string; warning: string; critical: string }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function color(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}

export function parseConfig(options: unknown): LimitsConfig {
  const input = record(options)
  const levels = record(input.levels)
  const colors = record(input.colors)
  const healthy = levels.healthy === undefined ? 30 : levels.healthy
  const warning = levels.warning === undefined ? 20 : levels.warning
  const validLevels = typeof healthy === "number" && Number.isFinite(healthy)
    && typeof warning === "number" && Number.isFinite(warning)
    && warning >= 0 && warning < healthy && healthy <= 100

  return {
    levels: validLevels ? { healthy, warning } : { healthy: 30, warning: 20 },
    colors: {
      healthy: color(colors.healthy, "#22c55e"),
      warning: color(colors.warning, "#f97316"),
      critical: color(colors.critical, "#ef4444"),
    },
  }
}

export function progressColor(remainingPercent: number, config: LimitsConfig): string {
  return remainingPercent > config.levels.healthy ? config.colors.healthy
    : remainingPercent > config.levels.warning ? config.colors.warning
    : config.colors.critical
}
