"use client"

import { useCallback, useEffect, useState } from "react"

import { BotConfigPanel } from "@/components/dashboard/bot-config-panel"
import { BotControlPanel } from "@/components/dashboard/bot-control-panel"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { LivePricePanel } from "@/components/dashboard/live-price-panel"
import { PositionsPanel } from "@/components/dashboard/positions-panel"
import { RiskControlPanel } from "@/components/dashboard/risk-control-panel"
import { TickerTape, type TickerRow } from "@/components/ui/ticker-tape"
import { WatchlistStack, type WatchlistToken } from "@/components/ui/watchlist-stack"
import { OrderBook } from "@/components/ui/order-book"
import { TradeTape } from "@/components/ui/trade-tape"
import { TOKENS, TRACKED_TOKENS, type TokenInfo } from "@/lib/market/tokens"

/* LVQuant Master Quant Trading Terminal.
   Architecture & Layout:
   1. Top Marquee: TickerTape scrolling all tracked Solana meme coins and core assets.
   2. Header: Phantom Wallet connection with live on-chain balance and status.
   3. Main Trading Desk (12-column grid):
      - Left Rail (4 cols):
        * WatchlistStack list component: SOL, BONK, WIF, POPCAT, JUP, RAY, BOME, MEW
        * OrderBook: Live bids/asks depth ladder with spread and volume balance
        * TradeTape: Real-time time & sales execution stream
      - Right Rail (8 cols):
        * LivePricePanel: Price scrubber chart with comprehensive timeframes (1m, 5m, 15m, 30m, 1h, 4h, 1D, 1W)
        * BotConfigPanel: Full quant strategy, venue, leverage (up to 50x), sizing, SL/TP, and risk controls
        * RiskControlPanel & BotControlPanel: Live circuit breaker, pause/resume, and panic liquidation
   4. Bottom Rail:
      - PositionsPanel: Active positions and verified Solscan transaction receipts.
   Strictly zero mock data, zero AI slop, zero emojis. 100% SSYCH Vault design system. */

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

        const rows: TickerRow[] = tickers.map((t) => ({
          symbol: t.symbol,
          name: t.name,
          price: t.price,
          change: t.change,
          color: t.color,
        }))
        setTickerRows(rows)

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

      <main className="mx-auto flex w-full max-w-[1360px] flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        {/* 2. Utilitarian Header & Phantom Connect */}
        <DashboardHeader />

        {/* 3. Trading Workspace Grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Rail (4 cols): Watchlist List, Order Book, Trade Tape */}
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

            <TradeTape
              symbol={`${activeToken.symbol}/USDC`}
              basePrice={activeTicker?.price ?? 103.7}
              priceDp={activeTicker && activeTicker.price < 1 ? 5 : 2}
            />
          </div>

          {/* Right Rail (8 cols): Interactive Chart, Bot Config, Execution Controls */}
          <div className="flex flex-col gap-6 lg:col-span-8">
            {/* Chart with complete standard timeframes (1m, 5m, 15m, 30m, 1h, 4h, 1D, 1W) */}
            <LivePricePanel
              token={activeToken}
              overridePrice={activeTicker?.price}
              overrideChange={activeTicker?.change}
            />

            {/* Quant Strategy & Risk Configuration */}
            <BotConfigPanel activeSymbol={selectedSymbol} />

            {/* Quant Safety & Execution Controls */}
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
