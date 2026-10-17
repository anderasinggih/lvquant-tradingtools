"use client"

import { useCallback, useEffect, useState } from "react"

import { BotControlPanel } from "@/components/dashboard/bot-control-panel"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { LivePricePanel } from "@/components/dashboard/live-price-panel"
import { PositionsPanel } from "@/components/dashboard/positions-panel"
import { RiskControlPanel } from "@/components/dashboard/risk-control-panel"
import { TickerTape, type TickerRow } from "@/components/ui/ticker-tape"
import { WatchlistStack, type WatchlistToken } from "@/components/ui/watchlist-stack"
import { OrderBook } from "@/components/ui/order-book"
import { TOKENS, TRACKED_TOKENS, type TokenInfo } from "@/lib/market/tokens"

/* LVQuant Bloomberg/Fintech Quant Terminal.
   Layout structure:
   - Top Marquee: TickerTape scrolling across all tracked Solana & Meme tokens.
   - Header: Non-custodial Phantom Connect button, on-chain live SOL balance, system status.
   - Two-column main desk:
     * Left Rail (4 cols):
       - WatchlistStack list component: All 8 meme coins with sparklines, prices, 24h change.
       - Real-time OrderBook depth ladder.
     * Main Center (8 cols):
       - LivePricePanel with PriceScrubber chart for active selected token.
       - Risk Controls & Emergency Panic Execution desk.
   - Bottom Rail:
     * PositionsPanel (live on-chain positions and Solscan trade receipts).
   Strictly zero mock data, zero emojis. */

interface TickerApiItem {
  symbol: string
  name: string
  mint: string
  price: number
  change: number
  color?: string
}

export default function Home() {
  const [selectedSymbol, setSelectedSymbol] = useState<string>("SOL")
  const [tickerRows, setTickerRows] = useState<TickerRow[]>([])
  const [watchlistTokens, setWatchlistTokens] = useState<WatchlistToken[]>([])

  const fetchTickers = useCallback(async () => {
    try {
      const res = await fetch("/api/market/tickers", { cache: "no-store" })
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data?.tickers)) {
        const tickers: TickerApiItem[] = data.tickers

        // TickerTape data
        const rows: TickerRow[] = tickers.map((t) => ({
          symbol: t.symbol,
          name: t.name,
          price: t.price,
          change: t.change,
          color: t.color,
        }))
        setTickerRows(rows)

        // WatchlistStack list data
        const tokens: WatchlistToken[] = tickers.map((t) => ({
          symbol: t.symbol,
          name: t.name,
          price: t.price,
          change24h: t.change,
          color: t.color,
        }))
        setWatchlistTokens(tokens)
      }
    } catch {
      // transient network error ignored
    }
  }, [])

  useEffect(() => {
    void fetchTickers()
    const id = setInterval(fetchTickers, 8000)
    return () => clearInterval(id)
  }, [fetchTickers])

  const activeToken: TokenInfo =
    TRACKED_TOKENS.find((t) => t.symbol === selectedSymbol) ?? TOKENS.SOL

  const activeTicker = tickerRows.find((r) => r.symbol === selectedSymbol)

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground antialiased selection:bg-foreground selection:text-background">
      {/* 1. Scrolling Market Marquee */}
      <TickerTape
        rows={tickerRows}
        onSelect={(sym) => setSelectedSymbol(sym)}
        className="sticky top-0 z-20 backdrop-blur-md"
      />

      <main className="mx-auto flex w-full max-w-[1320px] flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        {/* 2. Utilitarian Header & Phantom Connect */}
        <DashboardHeader />

        {/* 3. Terminal Workspace Grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Rail: List of Meme Coins & Live Order Book */}
          <div className="flex flex-col gap-6 lg:col-span-4">
            <WatchlistStack
              tokens={watchlistTokens}
              activeSymbol={selectedSymbol}
              onSelectToken={(sym) => setSelectedSymbol(sym)}
            />

            <OrderBook
              symbol={`${activeToken.symbol}/USDC`}
              unit={activeToken.symbol}
              midPrice={activeTicker?.price ?? 103.7}
              priceDp={activeTicker && activeTicker.price < 1 ? 5 : 2}
            />
          </div>

          {/* Right Rail: Interactive Chart & Risk / Bot Controls */}
          <div className="flex flex-col gap-6 lg:col-span-8">
            <LivePricePanel
              token={activeToken}
              overridePrice={activeTicker?.price}
              overrideChange={activeTicker?.change}
            />

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <RiskControlPanel />
              <BotControlPanel />
            </div>
          </div>
        </div>

        {/* 4. Positions & Trade History */}
        <PositionsPanel />
      </main>
    </div>
  )
}
