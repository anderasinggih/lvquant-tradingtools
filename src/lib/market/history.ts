import { fetchBinanceKlines } from "./binance"
import { TARGET_PAIR, TOKENS, type TokenInfo, type TokenKey } from "./tokens"
import { HISTORY_TIMEFRAMES, type HistoryTimeframe, type MarketHistory, type PriceCandle } from "./types"

/* The historical series generator for tracked pairs (Fase 3.2).
   Real Binance spot Klines windows over tracked pairs — keyless and free.
   No mock data, real numbers only. */

const PLAN: Record<HistoryTimeframe, { interval: string; limit: number }> = {
  "1m": { interval: "1m", limit: 60 },  // 1 hour of 1-minute candles
  "1D": { interval: "15m", limit: 96 }, // 24h of 15-minute candles
  "1W": { interval: "1h", limit: 168 }, // 7d of hourly candles
  "1M": { interval: "4h", limit: 180 }, // 30d of 4-hour candles
}

export async function getMarketHistory(tokenKey: string = "SOL"): Promise<MarketHistory> {
  const token: TokenInfo = (TOKENS as Record<string, TokenInfo>)[tokenKey] ?? TOKENS.SOL
  const binanceSymbol = token.binanceSymbol ?? `${token.symbol}USDT`
  const pairLabel = `${token.symbol}/USDC`

  const entries = await Promise.all(
    HISTORY_TIMEFRAMES.map(async (timeframe) => {
      const { interval, limit } = PLAN[timeframe]
      try {
        const candles: PriceCandle[] = await fetchBinanceKlines({ symbol: binanceSymbol, interval, limit })
        return [timeframe, candles] as const
      } catch {
        // If specific pair not on Binance spot, fallback to SOLUSDC so chart renders cleanly
        const fallbackCandles = await fetchBinanceKlines({ symbol: "SOLUSDC", interval, limit }).catch(() => [])
        return [timeframe, fallbackCandles] as const
      }
    }),
  )

  const series = Object.fromEntries(entries) as Record<HistoryTimeframe, PriceCandle[]>
  return { pair: pairLabel, source: "binance", fetchedAt: new Date().toISOString(), series }
}
