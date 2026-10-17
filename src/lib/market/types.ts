/* Shared market-data types. Dependency-free, so both the server feed and the client hook can
   import them without pulling in Node-only code. */

/** One token's price as returned by the Jupiter Price API V3. */
export interface JupiterPrice {
  usdPrice: number
  liquidity: number | null
  blockId: number | null
  decimals: number | null
  priceChange24h: number | null
  createdAt: string | null
}

/** A normalised quote for one token. */
export interface TokenQuote {
  mint: string
  symbol: string
  usdPrice: number
  decimals: number
  liquidity: number | null
  priceChange24h: number | null
  blockId: number | null
}

/** The live price of the target pair, as served by `/api/market/price`. */
export interface LiveMarketPrice {
  pair: string
  price: number
  base: TokenQuote
  quote: TokenQuote
  change24h: number | null
  blockId: number | null
  source: "jupiter"
  fetchedAt: string
}

export type FeedStatus = "connecting" | "live" | "error"

/** The historical timeframes the price chart serves (Fase 3.2). */
export type HistoryTimeframe = "1m" | "1D" | "1W" | "1M"

export const HISTORY_TIMEFRAMES: HistoryTimeframe[] = ["1m", "1D", "1W", "1M"]

/** One OHLCV candle from a historical series (`time` in unix seconds, prices in USD). */
export interface PriceCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** Real per-timeframe OHLCV history for the target pair, as served by `/api/market/history`. */
export interface MarketHistory {
  pair: string
  source: "binance"
  fetchedAt: string
  /** one candle array per timeframe, oldest → latest (empty when the upstream had none) */
  series: Record<HistoryTimeframe, PriceCandle[]>
}

/** One observed price, stamped when the client received it. */
export interface PriceTick {
  price: number
  at: number
}

export interface LivePriceState {
  status: FeedStatus
  data: LiveMarketPrice | null
  error: string | null
  ticks: PriceTick[]
  lastUpdatedAt: number | null
}
