import { withRpcRetry } from "@/lib/solana/retry"

import type { PriceCandle } from "./types"

/* Binance public market-data client — Klines (candlesticks). Keyless and 100% free: no API key,
   no account, no billing. `data-api.binance.vision` is Binance's official public market-data host;
   it mirrors the `/api/v3` market-data endpoints of api.binance.com without authentication.
   Docs: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints#klinecandlestick-data
   The API returns complete bars only; incomplete bars are dropped by the caller (Rules §1). */

const DEFAULT_BASE = "https://data-api.binance.vision"
const REQUEST_TIMEOUT_MS = 8_000

/** Binance public market-data host; `BINANCE_API_BASE` overrides it (e.g. https://api.binance.com). */
function apiBase(): string {
  const base = process.env.BINANCE_API_BASE?.trim()
  return base ? base.replace(/\/+$/, "") : DEFAULT_BASE
}

/** One raw kline: [openTime(ms), open, high, low, close, volume, closeTime(ms), …] (prices are strings). */
export type BinanceKline = [number, string, string, string, string, string, number, ...unknown[]]

/**
 * Fetch the most recent `limit` klines for `symbol` at `interval` (e.g. "SOLUSDC", "15m").
 * Retries transient upstream failures (rate limit / 5xx / timeout) with backoff; a hard 4xx
 * (e.g. 400 bad symbol) fails immediately via {@link withRpcRetry}.
 */
export async function fetchBinanceKlines(params: {
  symbol: string
  interval: string
  limit: number
}): Promise<PriceCandle[]> {
  const url = new URL(`${apiBase()}/api/v3/klines`)
  url.searchParams.set("symbol", params.symbol)
  url.searchParams.set("interval", params.interval)
  url.searchParams.set("limit", String(params.limit))

  const raw = await withRpcRetry(
    async () => {
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      })
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(
          `Binance klines responded ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`,
        )
      }
      return (await res.json()) as BinanceKline[]
    },
    { operation: "klines", provider: "binance" },
  )

  const candles: PriceCandle[] = []
  for (const k of raw) {
    const time = Number(k[0]) / 1000
    const open = Number(k[1])
    const high = Number(k[2])
    const low = Number(k[3])
    const close = Number(k[4])
    const volume = Number(k[5])
    if (![time, open, high, low, close, volume].every(Number.isFinite)) continue
    candles.push({ time, open, high, low, close, volume })
  }
  candles.sort((a, b) => a.time - b.time)
  return candles
}
