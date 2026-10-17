import { fetchBinanceKlines } from "./binance"
import { TARGET_PAIR } from "./tokens"
import { HISTORY_TIMEFRAMES, type HistoryTimeframe, type MarketHistory, type PriceCandle } from "./types"

/* The historical series generator for the target pair (Fase 3.2).
   Each timeframe is a real Binance spot Klines window over SOLUSDC — keyless and free, no API key
   or billing. Nothing is generated, padded or back-filled; a timeframe the exchange returns no
   candles for stays an empty array, which the UI reads as disconnected rather than drawing a line
   from invented numbers (Rules §1 / §2). */

/** Candle interval and candle count per timeframe — each window is a readable series. */
const PLAN: Record<HistoryTimeframe, { interval: string; limit: number }> = {
  "1D": { interval: "15m", limit: 96 }, // 24h of 15-minute candles
  "1W": { interval: "1h", limit: 168 }, // 7d of hourly candles
  "1M": { interval: "4h", limit: 180 }, // 30d of 4-hour candles
}

/** Binance spot symbol for the target pair (base symbol + quote symbol, e.g. "SOLUSDC"). */
const SYMBOL = `${TARGET_PAIR.base.symbol}${TARGET_PAIR.quote.symbol}`

/** Read the real per-timeframe OHLCV history for the target pair. */
export async function getMarketHistory(): Promise<MarketHistory> {
  const entries = await Promise.all(
    HISTORY_TIMEFRAMES.map(async (timeframe) => {
      const { interval, limit } = PLAN[timeframe]
      const candles: PriceCandle[] = await fetchBinanceKlines({ symbol: SYMBOL, interval, limit })
      return [timeframe, candles] as const
    }),
  )

  const series = Object.fromEntries(entries) as Record<HistoryTimeframe, PriceCandle[]>
  return { pair: TARGET_PAIR.label, source: "binance", fetchedAt: new Date().toISOString(), series }
}
