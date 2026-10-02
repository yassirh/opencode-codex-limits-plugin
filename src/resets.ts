export interface BankedReset {
  title?: string
  expiresAt?: number // Unix seconds
}

export interface BankedResets {
  availableCount?: number
  detailsStatus: "ready" | "unavailable"
  credits?: BankedReset[]
}

export function resetCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function expiry(value: unknown): number | undefined {
  const seconds = typeof value === "string" ? Date.parse(value) / 1000 : value
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
    && seconds * 1000 <= 8.64e15 ? seconds : undefined
}

export function parseResetCredits(body: unknown, now = Date.now()): BankedResets | undefined {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return
  const input = body as Record<string, unknown>
  if (!Array.isArray(input.credits)) return
  const credits: BankedReset[] = []
  for (const value of input.credits) {
    if (value === null || typeof value !== "object" || typeof value.status !== "string") return
    if (value.status !== "available") continue
    const expiresAt = expiry(value.expires_at)
    if (expiresAt !== undefined && expiresAt * 1000 <= now) continue
    const title = typeof value.title === "string" && value.title.trim() ? value.title : undefined
    credits.push({
      ...(title === undefined ? {} : { title }),
      ...(expiresAt === undefined ? {} : { expiresAt }),
    })
  }
  credits.sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity))
  const availableCount = resetCount(input.available_count) ?? credits.length
  return {
    availableCount,
    detailsStatus: availableCount === credits.length ? "ready" : "unavailable",
    credits,
  }
}

export function formatExpiry(expiresAt: number | undefined, detailed = false): string {
  if (expiresAt === undefined) return "Expiry unknown"
  return new Date(expiresAt * 1000).toLocaleString(undefined, {
    ...(detailed ? { year: "numeric" as const } : {}),
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    ...(detailed ? { timeZoneName: "short" as const } : {}),
  })
}
