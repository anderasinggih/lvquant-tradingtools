"use client"

import { useMemo } from "react"

import { DisconnectedState } from "@/components/dashboard/disconnected-state"
import { Panel } from "@/components/dashboard/panel"
import { LiveFigure } from "@/components/ui/live-figure"
import { PriceScrubber, type ScrubTimeframe } from "@/components/ui/price-scrubber"
import { useLivePrice } from "@/lib/hooks/use-live-price"
import { usePriceHistory } from "@/lib/hooks/use-price-history"
import { HISTORY_TIMEFRAMES, type HistoryTimeframe } from "@/lib/market/types"
import { TOKENS, type TokenInfo } from "@/lib/market/tokens"

/* The primary-market panel. Two real feeds: live price for the header figure, and
   Binance Klines history (1m · 1D · 1W · 1M) for the scrubber's chart.
   Supports dynamic token switching (SOL, BONK, WIF, POPCAT, JUP, RAY, BOME, MEW).
   Strict zero-mock rule: all figures are real. No emojis. */

const UP = "var(--chart-up)"
const DOWN = "var(--chart-down)"

const fmtPrice = (n: number) => {
  if (n < 0.0001) return n.toFixed(7)
  if (n < 0.01) return n.toFixed(6)
  if (n < 1) return n.toFixed(4)
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const CHART_TIMEFRAMES: ScrubTimeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1D", "1W"]

function pointLabel(tf: HistoryTimeframe, unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  if (tf === "1m" || tf === "5m" || tf === "15m" || tf === "30m" || tf === "1h") {
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export interface LivePricePanelProps {
  token?: TokenInfo
  overridePrice?: number
  overrideChange?: number
  className?: string
}

export function LivePricePanel({
  token = TOKENS.SOL,
  overridePrice,
  overrideChange,
  className,
}: LivePricePanelProps) {
  const { data: live, error: liveError } = useLivePrice()
  const history = usePriceHistory({ token: token.symbol })

  const { series, labels, availableTfs, activeTf, hasSeries } = useMemo(() => {
    const series: Partial<Record<ScrubTimeframe, number[]>> = {}
    const labels: Partial<Record<ScrubTimeframe, string[]>> = {}
    const source = history.data?.series
    if (source) {
      for (const tf of HISTORY_TIMEFRAMES) {
        const candles = source[tf]
        if (candles && candles.length >= 2) {
          series[tf] = candles.map((c) => c.close)
          labels[tf] = candles.map((c) => pointLabel(tf, c.time))
        }
      }
    }
    const availableTfs: ScrubTimeframe[] = CHART_TIMEFRAMES.filter((tf) => (series[tf]?.length ?? 0) >= 2)
    return { series, labels, availableTfs, activeTf: availableTfs[0] ?? "1D", hasSeries: availableTfs.length > 0 }
  }, [history.data])

  const currentPrice = overridePrice ?? (token.symbol === "SOL" ? live?.price : null)
  const change = overrideChange ?? (token.symbol === "SOL" ? live?.change24h : null)

  const staleNote =
    history.status === "error"
      ? `History feed notice: ${history.error ?? "feed unavailable"} — showing last received series.`
      : liveError && token.symbol === "SOL"
        ? `Live price notice: ${liveError} — chart shows last received history.`
        : null

  return (
    <Panel
      title={`${token.name} (${token.symbol}/USDC) — Price Scrubber`}
      action={
        <div className="flex items-baseline gap-2 tabular-nums">
          <LiveFigure intent={null} className="text-[13px] font-medium text-foreground/90">
            {currentPrice !== null && currentPrice !== undefined ? `$${fmtPrice(currentPrice)}` : live ? `$${fmtPrice(live.price)}` : "—"}
          </LiveFigure>
          {change !== null && change !== undefined ? (
            <span className="text-[11.5px] font-medium" style={{ color: change >= 0 ? UP : DOWN }}>
              {change >= 0 ? "+" : "−"}
              {Math.abs(change).toFixed(2)}% 24h
            </span>
          ) : null}
        </div>
      }
      className={className}
    >
      {hasSeries ? (
        <div className="flex flex-col gap-2">
          {staleNote ? (
            <p className="font-mono text-[11px] text-chart-amber" role="status">
              {staleNote}
            </p>
          ) : null}
          <PriceScrubber
            name={token.name}
            symbol={`${token.symbol}/USDC`}
            data={series[activeTf] ?? []}
            seriesByTimeframe={series}
            labelsByTimeframe={labels}
            timeframes={availableTfs}
            timeframe={activeTf}
          />
        </div>
      ) : (
        <DisconnectedState
          status={history.status === "error" ? "Disconnected" : "Connecting Live Feed"}
          note={
            history.status === "error"
              ? `${history.error ?? "The Klines feed is unavailable."} Retrying…`
              : `Loading real ${token.symbol}/USDC history from public Klines.`
          }
        />
      )}
    </Panel>
  )
}
