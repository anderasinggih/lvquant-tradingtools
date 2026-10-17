"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { LiveFigure } from "@/components/ui/live-figure"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { usePointed } from "@/components/ui/use-pointed"

/* Order Book from SSYCH Vault (line 18553).
   Two-sided crypto exchange ladder: asks above, bids below, mid price and spread in middle.
   Depth bars scaled to largest cumulative size.
   Strictly no emojis, clean utilitarian layout. */

const EASE = [0.16, 1, 0.3, 1] as const
const GREEN = "var(--chart-up)"
const RED = "var(--chart-down)"
const ink = (c: string) => `oklch(from ${c} min(l, var(--ink-l, 1)) c h)`

export interface OrderBookLevel {
  price: number
  size: number
}

export interface OrderBookProps {
  symbol?: string
  unit?: string
  midPrice?: number
  priceDp?: number
  sizeDp?: number
  className?: string
}

type Side = "bid" | "ask"
type Row = { price: number; size: number; total: number; money: number }

function generateBook(mid: number, tick: number): { bids: OrderBookLevel[]; asks: OrderBookLevel[] } {
  let seed = Math.round(mid * 1000)
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const bids: OrderBookLevel[] = []
  const asks: OrderBookLevel[] = []
  
  let p = mid - tick
  for (let i = 0; i < 7; i++) {
    const wall = rnd() < 0.15 ? 2.5 : 1
    const size = Math.round((0.5 + rnd() * 2) * wall * 100) / 100
    bids.push({ price: Math.max(0, p), size })
    p -= tick * (1 + Math.floor(rnd() * 2))
  }

  p = mid + tick
  for (let i = 0; i < 7; i++) {
    const wall = rnd() < 0.15 ? 2.5 : 1
    const size = Math.round((0.5 + rnd() * 2) * wall * 100) / 100
    asks.push({ price: p, size })
    p += tick * (1 + Math.floor(rnd() * 2))
  }

  return { bids, asks }
}

function ladder(levels: OrderBookLevel[], side: Side): Row[] {
  const sorted = [...levels].sort((a, b) => (side === "bid" ? b.price - a.price : a.price - b.price))
  let total = 0
  let money = 0
  return sorted.map((v) => {
    total += v.size
    money += v.size * v.price
    return { price: v.price, size: v.size, total, money }
  })
}

export function OrderBook({
  symbol = "SOL/USDC",
  unit = "SOL",
  midPrice = 103.7,
  priceDp = 2,
  sizeDp = 2,
  className,
}: OrderBookProps) {
  const reduced = useReducedMotion()
  const { ref, live, bind } = usePointed()
  const [hot, setHot] = useState<{ side: Side; i: number } | null>(null)
  const [balanceOn, setBalanceOn] = useState(false)

  const tick = useMemo(() => {
    if (midPrice < 0.001) return 0.0000001
    if (midPrice < 1) return 0.0001
    if (midPrice < 10) return 0.01
    return 0.1
  }, [midPrice])

  const [book, setBook] = useState(() => generateBook(midPrice, tick))

  useEffect(() => {
    setBook(generateBook(midPrice, tick))
  }, [midPrice, tick])

  // Small live jitter when pointed at
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => {
      setBook((b) => {
        const rndDelta = (Math.random() - 0.5) * tick * 0.1
        const newMid = Math.max(0.000001, midPrice + rndDelta)
        return generateBook(newMid, tick)
      })
    }, 1200)
    return () => clearInterval(id)
  }, [live, midPrice, tick])

  const bidRows = useMemo(() => ladder(book.bids, "bid").slice(0, 6), [book.bids])
  const askRows = useMemo(() => ladder(book.asks, "ask").slice(0, 6), [book.asks])

  const bestBid = bidRows[0]?.price ?? midPrice - tick
  const bestAsk = askRows[0]?.price ?? midPrice + tick
  const spread = Math.max(0, bestAsk - bestBid)
  const bps = midPrice > 0 ? (spread / midPrice) * 10000 : 0

  const bidTotal = bidRows[bidRows.length - 1]?.total ?? 0
  const askTotal = askRows[askRows.length - 1]?.total ?? 0
  const largest = Math.max(bidTotal, askTotal, 1e-9)
  const bidShare = bidTotal + askTotal > 0 ? (bidTotal / (bidTotal + askTotal)) * 100 : 50

  const shown = hot ? (hot.side === "bid" ? bidRows : askRows)[hot.i] : null

  const formatPriceVal = (p: number) => {
    if (p < 0.001) return p.toFixed(7)
    if (p < 1) return p.toFixed(4)
    return p.toFixed(priceDp)
  }

  const level = (r: Row, side: Side, i: number) => {
    const hue = side === "bid" ? GREEN : RED
    const lit = hot !== null && hot.side === side && i <= hot.i
    const dim = hot !== null && !lit
    return (
      <button
        key={`${side}-${r.price}-${i}`}
        type="button"
        onPointerEnter={() => setHot({ side, i })}
        onFocus={() => setHot({ side, i })}
        onBlur={() => setHot(null)}
        className="relative grid w-full grid-cols-3 items-center px-2 py-[2.5px] text-left text-[11px] tabular-nums outline-none transition-opacity duration-150"
        style={{ opacity: dim ? 0.35 : 1 }}
      >
        <motion.span
          aria-hidden
          className="absolute inset-y-px right-0 w-full rounded-[2px]"
          style={{
            originX: 1,
            background: `color-mix(in srgb, ${hue} ${lit ? 25 : 12}%, transparent)`,
          }}
          initial={reduced ? false : { scaleX: 0 }}
          animate={{ scaleX: r.total / largest }}
          transition={reduced ? { duration: 0 } : { duration: 0.25, ease: EASE }}
        />
        <span className="relative font-medium" style={{ color: ink(hue) }}>
          {formatPriceVal(r.price)}
        </span>
        <span className="relative text-right text-foreground/90">{r.size.toFixed(sizeDp)}</span>
        <span className="relative text-right text-foreground/45">{r.total.toFixed(sizeDp)}</span>
      </button>
    )
  }

  return (
    <div
      ref={ref}
      {...bind}
      className={cn("w-full rounded-2xl border border-foreground/[0.08] bg-foreground/[0.015] p-3.5 tabular-nums", className)}
      role="group"
      aria-label={`${symbol} order book`}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[13px] font-semibold text-foreground/90">{symbol} Depth</span>
        <span className="text-[11px] text-foreground/45">Spread {spread < 0.01 ? spread.toFixed(5) : spread.toFixed(2)}</span>
      </div>

      <div className="grid grid-cols-3 px-2 pb-1 text-[10px] uppercase tracking-wider text-foreground/40">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>

      <div onPointerLeave={() => setHot(null)}>
        {/* Asks (sell orders) */}
        <div className="flex flex-col-reverse">{askRows.map((r, i) => level(r, "ask", i))}</div>

        {/* Mid market spread bar */}
        <div className="flex items-baseline justify-between gap-3 border-y border-foreground/[0.06] bg-foreground/[0.02] px-2 py-1.5">
          <span className="text-[14px] font-semibold text-foreground/95">{formatPriceVal(midPrice)}</span>
          <LiveFigure
            intent={hot ? `${hot.side}-${hot.i}` : balanceOn ? "balance" : null}
            className="flex items-baseline gap-2 text-[10.5px] text-foreground/45"
          >
            {shown && hot ? (
              <span className="font-medium text-foreground/90">
                {shown.total.toFixed(sizeDp)} {unit} to {formatPriceVal(shown.price)}
              </span>
            ) : balanceOn ? (
              <>
                <span style={{ color: ink(GREEN) }}>Bids {bidShare.toFixed(0)}%</span>
                <span style={{ color: ink(RED) }}>Asks {(100 - bidShare).toFixed(0)}%</span>
              </>
            ) : (
              <span>{bps.toFixed(1)} bps</span>
            )}
          </LiveFigure>
        </div>

        {/* Bids (buy orders) */}
        <div className="flex flex-col">{bidRows.map((r, i) => level(r, "bid", i))}</div>
      </div>

      {/* Balance visualizer */}
      <div
        tabIndex={0}
        onPointerEnter={() => setBalanceOn(true)}
        onPointerLeave={() => setBalanceOn(false)}
        className="mt-2 px-1 py-1"
      >
        <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-foreground/[0.08]">
          <span
            className="absolute inset-y-0 left-0 transition-all duration-300"
            style={{ width: `${bidShare}%`, background: GREEN }}
          />
          <span
            className="absolute inset-y-0 right-0 transition-all duration-300"
            style={{ width: `${100 - bidShare}%`, background: RED }}
          />
        </div>
      </div>
    </div>
  )
}
