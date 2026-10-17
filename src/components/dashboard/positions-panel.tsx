"use client"

import { useCallback, useEffect, useState } from "react"

import { Panel } from "@/components/dashboard/panel"
import { DisconnectedState } from "@/components/dashboard/disconnected-state"
import { SegmentedControl } from "@/components/ui/segmented-control"

/* Active positions and trade history. Reads live data from `/api/bot/state`.
   Strict zero-mock rule: if there are 0 open positions or trades, cleanly shows
   the utilitarian DisconnectedState explaining the exact live status without dummy rows.
   Zero emojis per user directive. */

interface PositionItem {
  id: string
  pair: string
  baseSymbol: string
  quoteSymbol: string
  baseAmount: number
  entryPriceUsd: number
  currentPriceUsd?: number
  entryNotionalUsd: number
  currentNotionalUsd?: number
  unrealizedPnlUsd?: number
  unrealizedPnlPct?: number
  stopLossPriceUsd?: number
  takeProfitPriceUsd?: number
  trailingArmed?: boolean
  trailingExitPriceUsd?: number | null
  openedAt: string
}

interface TradeItem {
  id: string
  pair: string
  entryPriceUsd: number
  exitPriceUsd: number
  exitReason: string
  pnlUsd: number
  pnlPct: number
  openedAt: string
  closedAt: string
}

interface BotStateResponse {
  openPositions: number
  positions: PositionItem[]
  trades?: TradeItem[]
}

const VIEWS = ["Active positions", "Trade history"] as const
type View = (typeof VIEWS)[number]

const NOTES: Record<View, string> = {
  "Active positions": "No active positions open on the wallet. Orders will appear here upon strategy signal fill.",
  "Trade history": "No completed trades in current session. Filled swaps with execution receipts will list here.",
}

export function PositionsPanel() {
  const [view, setView] = useState<View>(VIEWS[0])
  const [positions, setPositions] = useState<PositionItem[]>([])
  const [trades, setTrades] = useState<TradeItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetchPositions = useCallback(async () => {
    try {
      const res = await fetch("/api/bot/state", { cache: "no-store" })
      if (!res.ok) return
      const data = (await res.json()) as BotStateResponse
      if (Array.isArray(data?.positions)) {
        setPositions(data.positions)
      }
      if (Array.isArray(data?.trades)) {
        setTrades(data.trades)
      }
    } catch {
      // transient network error ignored
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchPositions()
    const interval = setInterval(fetchPositions, 3000)
    return () => clearInterval(interval)
  }, [fetchPositions])

  return (
    <Panel
      title={view}
      action={<SegmentedControl options={[...VIEWS]} value={view} onChange={(v) => setView(v as View)} label="Positions view" />}
      className="min-h-[260px]"
    >
      {view === "Active positions" && positions.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px] tabular-nums">
            <thead>
              <tr className="border-b border-foreground/[0.08] text-foreground/45">
                <th className="pb-2 font-normal">Pair</th>
                <th className="pb-2 font-normal">Size (Notional)</th>
                <th className="pb-2 font-normal">Entry</th>
                <th className="pb-2 font-normal">Mark Price</th>
                <th className="pb-2 font-normal">Live PnL</th>
                <th className="pb-2 font-normal">Exit Targets (SL / TP)</th>
                <th className="pb-2 font-normal">Opened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/[0.04]">
              {positions.map((p) => {
                const mark = p.currentPriceUsd ?? p.entryPriceUsd
                const pnlUsd = p.unrealizedPnlUsd ?? 0
                const pnlPct = p.unrealizedPnlPct ?? 0
                const isProfit = pnlUsd >= 0

                return (
                  <tr key={p.id} className="text-foreground/90">
                    <td className="py-2.5 font-medium">{p.pair}</td>
                    <td className="py-2.5">
                      <span className="font-mono">{p.baseAmount.toFixed(4)} {p.baseSymbol}</span>
                      <span className="ml-1 text-[11px] text-foreground/40">(${p.entryNotionalUsd.toFixed(2)})</span>
                    </td>
                    <td className="py-2.5 font-mono">${p.entryPriceUsd.toFixed(2)}</td>
                    <td className="py-2.5 font-mono">${mark.toFixed(2)}</td>
                    <td className="py-2.5 font-mono">
                      <span className={isProfit ? "text-chart-up font-medium" : "text-chart-down font-medium"}>
                        {isProfit ? "+" : ""}${pnlUsd.toFixed(2)} ({isProfit ? "+" : ""}{pnlPct.toFixed(2)}%)
                      </span>
                    </td>
                    <td className="py-2.5 text-[11px]">
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-chart-down">SL ${p.stopLossPriceUsd?.toFixed(2) ?? "—"}</span>
                        <span className="text-foreground/25">/</span>
                        <span className="text-chart-up">TP ${p.takeProfitPriceUsd?.toFixed(2) ?? "—"}</span>
                      </div>
                    </td>
                    <td className="py-2.5 text-foreground/45 font-mono text-[11px]">{new Date(p.openedAt).toLocaleTimeString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : view === "Trade history" && trades.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px] tabular-nums">
            <thead>
              <tr className="border-b border-foreground/[0.08] text-foreground/45">
                <th className="pb-2 font-normal">Pair</th>
                <th className="pb-2 font-normal">Entry USD</th>
                <th className="pb-2 font-normal">Exit USD</th>
                <th className="pb-2 font-normal">Reason</th>
                <th className="pb-2 font-normal">PnL USD</th>
                <th className="pb-2 font-normal">Closed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/[0.04]">
              {trades.map((t) => {
                const isProfit = t.pnlUsd >= 0
                return (
                  <tr key={t.id} className="text-foreground/90">
                    <td className="py-2.5 font-medium">{t.pair}</td>
                    <td className="py-2.5">${t.entryPriceUsd.toFixed(2)}</td>
                    <td className="py-2.5">${t.exitPriceUsd.toFixed(2)}</td>
                    <td className="py-2.5 font-mono text-[11px] uppercase text-foreground/60">{t.exitReason}</td>
                    <td className={`py-2.5 font-mono font-medium ${isProfit ? "text-chart-up" : "text-chart-down"}`}>
                      {isProfit ? "+" : ""}${t.pnlUsd.toFixed(2)} ({isProfit ? "+" : ""}{t.pnlPct.toFixed(2)}%)
                    </td>
                    <td className="py-2.5 text-foreground/45">{new Date(t.closedAt).toLocaleTimeString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <DisconnectedState note={loading ? "Connecting to trading engine state..." : NOTES[view]} />
      )}
    </Panel>
  )
}

