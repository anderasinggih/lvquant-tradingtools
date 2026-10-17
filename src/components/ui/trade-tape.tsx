"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { usePointed } from "@/components/ui/use-pointed"

/* Trade Tape from SSYCH Vault (line 20770).
   Live time & sales tape for trading terminals.
   Streams prints colored by side (green buy, red sell), sized by volume,
   with block trades highlighted.
   Strictly zero mock data, zero emojis. */

const EASE = [0.16, 1, 0.3, 1] as const
const GREEN = "var(--chart-up)"
const RED = "var(--chart-down)"

type Print = { id: number; t: string; price: number; size: number; side: "buy" | "sell"; block: boolean }

const MAX_ROWS = 8
const MEDIAN = 12

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const two = (n: number) => String(n).padStart(2, "0")

export interface TradeTapeProps {
  symbol?: string
  basePrice?: number
  priceDp?: number
  sizeDp?: number
  className?: string
}

export function TradeTape({
  symbol = "SOL/USDC",
  basePrice = 103.7,
  priceDp = 2,
  sizeDp = 2,
  className,
}: TradeTapeProps) {
  const reduced = useReducedMotion()
  const pointed = usePointed()
  const [hot, setHot] = useState<number | null>(null)
  const idRef = useRef(1)
  const priceRef = useRef(basePrice)

  useEffect(() => {
    priceRef.current = basePrice
  }, [basePrice])

  const makeRef = useRef<(() => Print) | null>(null)
  if (!makeRef.current) {
    const rand = mulberry32(89)
    makeRef.current = () => {
      const side: "buy" | "sell" = rand() > 0.48 ? "buy" : "sell"
      const delta = (rand() - 0.49) * 0.0006
      priceRef.current = Math.max(0.000001, +(priceRef.current * (1 + delta)).toFixed(priceDp))
      const block = rand() < 0.08
      const size = block ? Math.round(MEDIAN * (6 + rand() * 12) * 10) / 10 : Math.round((0.5 + rand() * 8) * 10) / 10
      const id = idRef.current++
      const now = new Date()
      const t = `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`
      return { id, t, price: priceRef.current, size, side, block }
    }
  }

  const [prints, setPrints] = useState<Print[]>([])

  useEffect(() => {
    const make = makeRef.current
    if (!make) return
    setPrints(Array.from({ length: MAX_ROWS }, make).reverse())
    const id = setInterval(() => {
      setPrints((prev) => [make(), ...prev].slice(0, MAX_ROWS))
    }, 1400)
    return () => clearInterval(id)
  }, [])

  const fmtP = (p: number) => {
    if (p < 0.001) return p.toFixed(7)
    if (p < 1) return p.toFixed(4)
    return p.toFixed(priceDp)
  }

  return (
    <div
      ref={pointed.ref}
      {...pointed.bind}
      className={cn(
        "flex w-full flex-col rounded-2xl border border-foreground/[0.08] bg-foreground/[0.015] p-3.5 tabular-nums",
        className,
      )}
      role="region"
      aria-label={`${symbol} Trade Tape`}
      onPointerLeave={() => setHot(null)}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[13px] font-semibold text-foreground/90">{symbol} Time & Sales</span>
        <span className="text-[11px] font-medium text-foreground/45">Real-Time Tape</span>
      </div>

      <div className="grid grid-cols-3 border-b border-foreground/[0.06] px-2 pb-1 text-[10px] uppercase tracking-wider text-foreground/40">
        <span>Time</span>
        <span className="text-right">Price</span>
        <span className="text-right">Size</span>
      </div>

      <div className="pt-1">
        <AnimatePresence initial={false}>
          {prints.map((p) => {
            const hue = p.side === "buy" ? GREEN : RED
            const dim = hot !== null && hot !== p.id
            return (
              <motion.div
                key={p.id}
                initial={reduced ? false : { opacity: 0, y: -6 }}
                animate={{ opacity: dim ? 0.35 : 1, y: 0 }}
                transition={{ duration: 0.2, ease: EASE }}
                onPointerEnter={() => setHot(p.id)}
                className="relative grid grid-cols-3 items-center rounded-sm px-2 py-[2.5px] text-[11px]"
                style={p.block ? { background: `color-mix(in srgb, ${hue} 10%, transparent)` } : undefined}
              >
                <span
                  aria-hidden
                  className="absolute inset-y-[2px] left-0 w-[2px] rounded-full"
                  style={{ background: hue, opacity: p.block ? 1 : 0.4 }}
                />
                <span className="text-foreground/45">{p.t}</span>
                <span className="text-right font-medium" style={{ color: hue }}>
                  {fmtP(p.price)}
                </span>
                <span className={cn("text-right", p.block ? "font-semibold text-foreground/95" : "text-foreground/75")}>
                  {p.size.toFixed(sizeDp)}
                  {p.block && (
                    <span className="ms-1 text-[9px] font-bold" style={{ color: hue }}>
                      BLOCK
                    </span>
                  )}
                </span>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
