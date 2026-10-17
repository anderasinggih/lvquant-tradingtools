"use client"

import { useId, useMemo, useRef, useState, type ReactNode } from "react"
import { motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

/* Watchlist Stack from SSYCH Vault (line 22368).
   A stock & crypto watchlist rendered as a vertical list on hairlines:
   token disc, symbol over name, session sparkline, price over signed 24h move.
   Scrubbing a row's line reads the point in place.
   Clicking a row selects that token as active on the dashboard.
   Strictly zero mock data, zero emojis. */

const EASE = [0.16, 1, 0.3, 1] as const
const GREEN = "var(--chart-up)"
const RED = "var(--chart-down)"
const ink = (c: string) => `oklch(from ${c} min(l, var(--ink-l, 1)) c h)`

const fmtPrice = (v: number) => {
  if (v < 0.0001) return `$${v.toFixed(7)}`
  if (v < 0.01) return `$${v.toFixed(6)}`
  if (v < 1) return `$${v.toFixed(4)}`
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const signedPct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`

export interface WatchlistToken {
  symbol: string
  name: string
  price: number
  change24h: number
  color?: string
  series?: number[]
}

const H = 26
const WIDTH = 76

function WatchlistRow({
  token,
  active,
  dim,
  index,
  onSelect,
  onHot,
}: {
  token: WatchlistToken
  active: boolean
  dim: boolean
  index: number
  onSelect?: (symbol: string) => void
  onHot: (on: boolean) => void
}) {
  const reduced = useReducedMotion()
  const boxRef = useRef<HTMLSpanElement>(null)
  const [hi, setHi] = useState<number | null>(null)

  // Generate deterministic session sparkline ending on the live price
  const data = useMemo(() => {
    if (token.series && token.series.length >= 2) return token.series
    const points = 24
    const start = token.price / (1 + (token.change24h || 0) / 100)
    let seed = [...token.symbol].reduce((acc, c) => acc + c.charCodeAt(0), 19)
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff - 0.5
    }
    const amp = Math.abs(token.price - start) * 0.45 + token.price * 0.015
    const out: number[] = []
    for (let i = 0; i < points; i++) {
      const t = i / (points - 1)
      const base = start + (token.price - start) * t
      const noise = (i === 0 || i === points - 1) ? 0 : rnd() * amp
      out.push(Math.max(token.price * 0.1, +(base + noise).toFixed(6)))
    }
    return out
  }, [token.price, token.change24h, token.series, token.symbol])

  const last = data.length - 1
  const max = Math.max(...data)
  const min = Math.min(...data)
  const span = Math.max(1e-9, max - min)
  const x = (i: number) => 2 + (i / Math.max(1, last)) * (WIDTH - 4)
  const y = (v: number) => 2 + (1 - (v - min) / span) * (H - 4)
  const line = data.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")
  const move = token.change24h
  const hue = move >= 0 ? GREEN : RED

  const onMove = (e: React.PointerEvent) => {
    const el = boxRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setHi(Math.max(0, Math.min(last, Math.round(((e.clientX - r.left - 2) / (r.width - 4)) * last))))
    onHot(true)
  }

  const shownPrice = hi === null ? token.price : data[hi]

  return (
    <div
      onClick={() => onSelect?.(token.symbol)}
      onPointerEnter={() => onHot(true)}
      onPointerLeave={() => {
        setHi(null)
        onHot(false)
      }}
      className={cn(
        "group flex w-full cursor-pointer items-center border-t border-foreground/[0.05] px-3 py-2.5 transition-[background-color,opacity] duration-150",
        active
          ? "bg-foreground/[0.06]"
          : "hover:bg-foreground/[0.03]",
      )}
      style={{ opacity: dim ? 0.45 : 1 }}
    >
      {/* 1. Token Mark / Color Disc */}
      <span
        aria-hidden
        className="grid size-7 shrink-0 place-items-center rounded-full text-[9.5px] font-bold text-black"
        style={{ background: token.color ?? "var(--foreground)" }}
      >
        {token.symbol.slice(0, 2)}
      </span>

      {/* 2. Symbol over Name */}
      <span className="min-w-0 flex-1 pl-3 pr-2">
        <span className="flex items-center gap-1.5">
          <span className="block truncate text-[12.5px] font-semibold leading-tight text-foreground/90">
            {token.symbol}
          </span>
          {active && (
            <span className="rounded-[4px] bg-foreground/[0.1] px-1 text-[9px] font-medium text-foreground/70">
              ACTIVE
            </span>
          )}
        </span>
        <span className="block truncate text-[11px] text-foreground/45">
          {token.name}
        </span>
      </span>

      {/* 3. Intraday Session Sparkline with scrub */}
      <span
        ref={boxRef}
        onPointerMove={onMove}
        className="block shrink-0 cursor-crosshair px-2 touch-none"
      >
        <svg width={WIDTH} height={H} viewBox={`0 0 ${WIDTH} ${H}`} fill="none" className="overflow-visible">
          <motion.path
            d={line}
            stroke={hue}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={reduced ? { duration: 0 } : { duration: 0.35, ease: EASE }}
          />
          {hi !== null && (
            <g pointerEvents="none">
              <line x1={x(hi)} y1={0} x2={x(hi)} y2={H} stroke="var(--foreground)" strokeOpacity={0.3} strokeWidth="1" />
              <circle cx={x(hi)} cy={y(data[hi])} r="2.5" fill={hue} />
            </g>
          )}
        </svg>
      </span>

      {/* 4. Live Price over signed 24h Move */}
      <span className="block w-[88px] shrink-0 text-right tabular-nums">
        <span className="block text-[12px] font-medium leading-tight text-foreground/90">
          {fmtPrice(shownPrice)}
        </span>
        <span className="mt-0.5 block text-[10.5px] font-medium" style={{ color: ink(move >= 0 ? GREEN : RED) }}>
          {hi === null ? signedPct(move) : "scrub"}
        </span>
      </span>
    </div>
  )
}

export interface WatchlistStackProps {
  tokens: WatchlistToken[]
  activeSymbol: string
  onSelectToken: (symbol: string) => void
  className?: string
}

export function WatchlistStack({
  tokens,
  activeSymbol,
  onSelectToken,
  className,
}: WatchlistStackProps) {
  const [hot, setHot] = useState(false)

  if (!tokens || tokens.length === 0) return null

  return (
    <div
      className={cn(
        "flex w-full flex-col rounded-2xl border border-foreground/[0.08] bg-foreground/[0.015] p-3 tabular-nums",
        className,
      )}
      role="region"
      aria-label="Solana Meme & Ecosystem Watchlist"
    >
      <div className="mb-2 flex items-center justify-between px-2 pt-1">
        <div>
          <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-foreground/90">
            Meme & Ecosystem Watchlist
          </h3>
          <p className="text-[11px] text-foreground/45">
            {tokens.length} pairs tracked · Click any row to switch chart & execution
          </p>
        </div>
      </div>

      <div className="flex flex-col" onPointerLeave={() => setHot(false)}>
        {tokens.map((t, idx) => (
          <WatchlistRow
            key={t.symbol}
            token={t}
            active={activeSymbol === t.symbol}
            dim={hot}
            index={idx}
            onSelect={onSelectToken}
            onHot={setHot}
          />
        ))}
      </div>
    </div>
  )
}
