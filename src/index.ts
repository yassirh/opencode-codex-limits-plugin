import { Plugin } from "@opencode/plugin"
import { Limits, type LimitsResult } from "./rpc.js"
import { parseConfig } from "./config.js"
import { parseUsage, type UsageSnapshot } from "./usage.js"
import { parseResetCredits } from "./resets.js"

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
const RESETS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits"
const CACHE_MS = 90_000

export default Plugin.define({
  id: "codex-limits.server",
  async setup(ctx) {
    let cache: UsageSnapshot | undefined
    let accountKey: string | undefined
    let lastAttempt = 0
    let pending: Promise<UsageSnapshot> | undefined

    const handlers = {
      read: async (input: unknown, { signal }: { signal: AbortSignal }): Promise<LimitsResult> => {
        const connection = await ctx.integration.connection.active("openai")
        if (!connection || connection.type !== "credential") {
          cache = undefined
          accountKey = undefined
          return { status: "unavailable", message: "Connect OpenAI with ChatGPT OAuth in /connect" }
        }

        // Resolve through OpenCode so its OAuth refresh flow owns token updates.
        const credential = await ctx.integration.connection.resolve(connection).catch(() => undefined)
        if (credential?.type !== "oauth") {
          cache = undefined
          accountKey = undefined
          return { status: "unavailable", message: "OpenAI ChatGPT OAuth is unavailable; reconnect in /connect" }
        }
        const accountID = credential.metadata?.accountID
        if (typeof accountID !== "string" || !accountID || !credential.access) {
          cache = undefined
          accountKey = undefined
          return { status: "unavailable", message: "OpenAI account ID is unavailable; reconnect in /connect" }
        }

        const key = `${connection.id}:${accountID}`
        if (key !== accountKey) {
          cache = undefined
          pending = undefined
          lastAttempt = 0
          accountKey = key
        }

        if (cache && Date.now() - cache.checkedAt < CACHE_MS && !(input as { refresh?: boolean }).refresh) {
          return { status: "ready", ...cache }
        }
        if (pending) {
          try {
            return { status: "ready", ...await pending }
          } catch {
            return cache
              ? { status: "stale", ...cache, message: "Could not refresh Codex limits" }
              : { status: "unavailable", message: "Could not fetch Codex limits" }
          }
        }
        // Avoid hammering the usage endpoint on repeated failures or manual refreshes.
        if (Date.now() - lastAttempt < 15_000) {
          return cache
            ? { status: "stale", ...cache, message: "Waiting to retry Codex limits" }
            : { status: "unavailable", message: "Waiting to retry Codex limits" }
        }

        lastAttempt = Date.now()
        const requestedKey = key
        const request = (async () => {
          const requestOptions = {
            headers: {
              Authorization: `Bearer ${credential.access}`,
              "ChatGPT-Account-Id": accountID,
              Accept: "application/json",
            },
            signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
          }
          const response = await fetch(USAGE_URL, requestOptions)
          if (!response.ok) throw new Error(`Codex usage HTTP ${response.status}`)
          const snapshot = parseUsage(await response.json())
          if (!snapshot) throw new Error("Codex usage contains no supported windows")
          if (snapshot.bankedResets?.availableCount !== 0) {
            try {
              const resetResponse = await fetch(RESETS_URL, requestOptions)
              const resets = resetResponse.ok ? parseResetCredits(await resetResponse.json()) : undefined
              snapshot.bankedResets = resets ?? {
                ...snapshot.bankedResets,
                detailsStatus: "unavailable",
              }
            } catch {
              snapshot.bankedResets = { ...snapshot.bankedResets, detailsStatus: "unavailable" }
            }
          }
          if (accountKey === requestedKey) cache = snapshot
          return snapshot
        })()
        pending = request
        try {
          return { status: "ready", ...await request }
        } catch {
          return cache
            ? { status: "stale", ...cache, message: "Could not refresh Codex limits" }
            : { status: "unavailable", message: "Could not fetch Codex limits; check your ChatGPT login" }
        } finally {
          if (pending === request) pending = undefined
        }
      },
    }
    await ctx.rpc.register(Limits, {
      read: async (input, options) => ({
        ...await handlers.read(input, options),
        config: parseConfig(ctx.options),
      }),
    })
  },
})
