"use client"

import { useMemo } from "react"

import { DisconnectedState } from "@/components/dashboard/disconnected-state"
import { Panel } from "@/components/dashboard/panel"
import { LiveFigure } from "@/components/ui/live-figure"
import { PriceScrubber, type ScrubTimeframe } from "@/components/ui/price-scrubber"
import { useLivePrice } from "@/lib/hooks/use-live-price"
import { usePriceHistory } from "@/lib/hooks/use-price-history"
import { HISTORY_TIMEFRAMES, type HistoryTimeframe } from "@/lib/market/types"

/* The primary-market panel. Two real feeds: the Jupiter live price for the header figure, and the
   Binance Klines history (1D · 1W · 1M) for the scrubber's chart. Neither is mocked: while a feed
   has no data the panel shows the disconnected state, and if one drops it keeps the last real data
   but says so — it never swaps in a fabricated number (Rules §1 / §2). */

const UP = "var(--chart-up)"
const DOWN = "var(--chart-down)"

const fmtPrice = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** The three timeframes the chart serves, in pill order. */
const CHART_TIMEFRAMES: ScrubTimeframe[] = ["1D", "1W", "1M"]

/** A real per-point label: clock time within a day, calendar date across a week or month. */
function pointLabel(tf: HistoryTimeframe, unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  if (tf === "1D") {
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function LivePricePanel({ className }: { className?: string }) {
  const { data: live, error: liveError } = useLivePrice()
  const history = usePriceHistory()

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

  const change = live?.change24h ?? null
  const staleNote =
    history.status === "error"
      ? `History feed error: ${history.error ?? "the Binance Klines feed is unavailable"} — showing the last received series.`
      : liveError
        ? `Live price feed error: ${liveError} — the chart shows the last received history.`
        : null

  return (
    <Panel
      title="Primary market — price scrubber"
      action={
        <div className="flex items-baseline gap-2 tabular-nums">
          <LiveFigure intent={null} className="text-[13px] font-medium text-foreground/90">
            {live ? `$${fmtPrice(live.price)}` : "—"}
          </LiveFigure>
          {change !== null ? (
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
            name="Solana"
            symbol="SOL/USDC"
            data={series[activeTf] ?? []}
            seriesByTimeframe={series}
            labelsByTimeframe={labels}
            timeframes={availableTfs}
            timeframe={activeTf}
          />
        </div>
      ) : (
        <DisconnectedState
          status={history.status === "error" ? "Disconnected" : "Awaiting Real-Time Feed / Disconnected"}
          note={
            history.status === "error"
              ? `${history.error ?? "The Binance Klines feed is unavailable."} Retrying every 60 seconds.`
              : "Loading real SOL/USDC history (1D · 1W · 1M) from Binance public Klines."
          }
        />
      )}
    </Panel>
  )
}
