import { withRpcRetry } from "@/lib/solana/retry"

import type { JupiterPrice } from "./types"

/* Jupiter Price API V3 client (https://api.jup.ag/price/v3).
   USD price per mint; up to 50 ids per request. Tokens with no reliable price are omitted by
   the API — this client returns exactly what the API returned and lets the caller decide, so a
   missing token is never silently replaced. The optional `x-api-key` raises the rate limit. */

const JUPITER_PRICE_URL = "https://api.jup.ag/price/v3"
const REQUEST_TIMEOUT_MS = 8_000

function apiKey(): string | undefined {
  const key = process.env.JUPITER_API_KEY?.trim()
  return key ? key : undefined
}

/**
 * Fetch USD prices for the given mints from Jupiter. Retries transient upstream failures
 * (rate limit / 5xx / timeout) with backoff; a hard 4xx (e.g. 401) fails immediately.
 */
export async function fetchJupiterPrices(
  mints: string[],
  options?: { apiKey?: string },
): Promise<Record<string, JupiterPrice>> {
  if (mints.length === 0) return {}
  if (mints.length > 50) {
    throw new Error(`Jupiter Price API accepts at most 50 ids, got ${mints.length}`)
  }

  const key = options?.apiKey ?? apiKey()
  const url = `${JUPITER_PRICE_URL}?ids=${mints.join(",")}`
  const headers: Record<string, string> = { Accept: "application/json" }
  if (key) headers["x-api-key"] = key

  return withRpcRetry(
    async () => {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      })
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(
          `Jupiter Price API responded ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`,
        )
      }
      return (await res.json()) as Record<string, JupiterPrice>
    },
    { operation: "price", provider: "jupiter" },
  )
}
