"use client"

import { useId, useMemo, useRef, useState, type ReactNode } from "react"
import { motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { ICON_BUTTON } from "@/components/ui/control-classes"
import { SegmentedControl } from "@/components/ui/segmented-control"

/* Top Coins Shelf from SSYCH Vault.
   Displays the largest & most active Solana tokens and meme coins side-by-side with
   live prices, scrubbable sparklines, and 24h percentage changes.
   Zero emojis. Clean fintech typography. */

const EASE = [0.16, 1, 0.3, 1] as const
const GREEN = "var(--chart-up)"
const RED = "var(--chart-down)"
const ink = (c: string) => `oklch(from ${c} min(l, var(--ink-l, 1)) c h)`

type RenderIcon = (symbol: string, size: number) => ReactNode

function Mark({ symbol, color, size, renderIcon }: { symbol: string; color?: string; size: number; renderIcon?: RenderIcon }) {
  if (renderIcon) return <>{renderIcon(symbol, size)}</>
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-semibold leading-none text-black"
      style={{
        width: size,
        height: size,
        background: color ?? "var(--foreground)",
        fontSize: Math.max(9, Math.round(size * 0.4)),
      }}
    >
      {symbol.slice(0, 2)}
    </span>
  )
}

export interface CoinData {
  name: string
  symbol: string
  price: number
  change24h: number
  color?: string
  series: number[]
}

export interface CoinRange {
  label: string
  points: number
}

const DEFAULT_RANGES: CoinRange[] = [
  { label: "24H", points: 24 },
  { label: "7D", points: 48 },
  { label: "30D", points: 72 },
]

const COL = 175
const W = COL
const H = 64
const TOP = 6
const BOT = 4

const fmtPrice = (v: number) => {
  if (v < 0.0001) return `$${v.toFixed(7)}`
  if (v < 0.01) return `$${v.toFixed(6)}`
  if (v < 1) return `$${v.toFixed(4)}`
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const signedPct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`

function linePath(vals: number[], m: number, px: (i: number) => number, py: (v: number) => number) {
  const n = vals.length
  let d = ""
  for (let k = 0; k < m; k++) {
    const i = m > 1 && n > 1 ? Math.round((k * (n - 1)) / (m - 1)) : 0
    d += `${k ? " L" : "M"} ${px(i).toFixed(2)} ${py(vals[i]).toFixed(2)}`
  }
  return d
}

function Column({
  coin: c,
  range,
  dim,
  active,
  onSelect,
  onHot,
  renderIcon,
}: {
  coin: CoinData
  range: CoinRange
  dim: boolean
  active: boolean
  onSelect?: (symbol: string) => void
  onHot: (on: boolean) => void
  renderIcon?: RenderIcon
}) {
  const reduced = useReducedMotion()
  const uid = useId().replace(/:/g, "")
  const boxRef = useRef<HTMLDivElement>(null)
  const [hi, setHi] = useState<number | null>(null)

  const data = useMemo(() => {
    const cut = c.series.slice(Math.max(0, c.series.length - range.points))
    return cut.length ? cut : [c.price]
  }, [c.series, c.price, range.points])

  const last = data.length - 1
  const max = Math.max(...data)
  const min = Math.min(...data)
  const span = Math.max(1e-9, max - min)
  const x = (i: number) => (i / Math.max(1, last)) * W
  const y = (v: number) => TOP + (1 - (v - min) / span) * (H - TOP - BOT)
  const line = linePath(data, Math.max(1, c.series.length), x, y)
  const change = data[0] ? ((data[last] - data[0]) / data[0]) * 100 : c.change24h

  const onMove = (e: React.PointerEvent) => {
    const el = boxRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setHi(Math.max(0, Math.min(last, Math.round(((e.clientX - r.left) / r.width) * last))))
    onHot(true)
  }

  const shown = hi ?? last
  const up = change >= 0

  return (
    <div
      ref={boxRef}
      onClick={() => onSelect?.(c.symbol)}
      onPointerMove={onMove}
      onPointerLeave={() => {
        setHi(null)
        onHot(false)
      }}
      className={cn(
        "group relative shrink-0 cursor-pointer rounded-xl border p-3 transition-[opacity,border-color,background-color] duration-150 ease-out",
        active
          ? "border-foreground/30 bg-foreground/[0.04]"
          : "border-foreground/[0.08] hover:border-foreground/20 hover:bg-foreground/[0.02]",
      )}
      style={{ width: COL, opacity: dim ? 0.45 : 1 }}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-2 truncate">
          <Mark symbol={c.symbol} color={c.color} size={22} renderIcon={renderIcon} />
          <span className="truncate text-[12px] font-semibold text-foreground/90">{c.symbol}</span>
        </div>
        <span className="truncate text-[10.5px] text-foreground/45">{c.name}</span>
      </div>

      <motion.div
        key={`${range.label}-${hi === null ? "now" : "scrub"}`}
        role="status"
        className="mt-2"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, ease: EASE }}
      >
        <div className="text-[14px] font-semibold leading-none tracking-[-0.01em] text-foreground/90">
          {fmtPrice(data[shown])}
        </div>
        <div className="mt-1 flex items-baseline gap-1.5 text-[10.5px]">
          {hi === null ? (
            <span className="font-medium" style={{ color: ink(up ? GREEN : RED) }}>
              {signedPct(change)}
            </span>
          ) : (
            <span className="text-foreground/45">{last - hi === 0 ? "current" : `${last - hi}pts ago`}</span>
          )}
        </div>
      </motion.div>

      <div className="relative mt-2 h-14 w-full">
        <svg viewBox={`0 0 ${W} ${H}`} className="overflow-visible" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`grad-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={up ? GREEN : RED} stopOpacity="0.25" />
              <stop offset="100%" stopColor={up ? GREEN : RED} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={`url(#grad-${uid})`} />
          <path d={line} fill="none" stroke={up ? GREEN : RED} strokeWidth="1.5" strokeLinecap="round" />
          {hi !== null && (
            <circle cx={x(hi)} cy={y(data[hi])} r="3" fill="var(--foreground)" />
          )}
        </svg>
      </div>
    </div>
  )
}

export interface TopCoinsShelfProps {
  coins: CoinData[]
  activeSymbol?: string
  onSelect?: (symbol: string) => void
  renderIcon?: RenderIcon
  className?: string
}

export function TopCoinsShelf({
  coins,
  activeSymbol,
  onSelect,
  renderIcon,
  className,
}: TopCoinsShelfProps) {
  const [range, setRange] = useState<CoinRange>(DEFAULT_RANGES[0])
  const [hot, setHot] = useState(false)
  const [page, setPage] = useState(0)

  if (!coins || coins.length === 0) return null

  const pageSize = 4
  const maxPage = Math.max(0, Math.ceil(coins.length / pageSize) - 1)
  const visibleCoins = coins.slice(page * pageSize, (page + 1) * pageSize)

  return (
    <div className={cn("w-full rounded-2xl border border-foreground/[0.08] bg-foreground/[0.015] p-4", className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-foreground/90">Solana Meme & Ecosystem Coins</h3>
          <p className="text-[11px] text-foreground/45">Real-time prices, scrubbable sparklines, and direct charting</p>
        </div>

        <div className="flex items-center gap-2">
          <SegmentedControl
            options={DEFAULT_RANGES.map((r) => r.label)}
            value={range.label}
            onChange={(lbl) => {
              const r = DEFAULT_RANGES.find((x) => x.label === lbl)
              if (r) setRange(r)
            }}
          />

          {maxPage > 0 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={ICON_BUTTON}
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                aria-label="Previous coins"
              >
                ←
              </button>
              <button
                type="button"
                className={ICON_BUTTON}
                disabled={page >= maxPage}
                onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
                aria-label="Next coins"
              >
                →
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {visibleCoins.map((c) => (
          <Column
            key={c.symbol}
            coin={c}
            range={range}
            dim={hot}
            active={activeSymbol === c.symbol}
            onSelect={onSelect}
            onHot={setHot}
            renderIcon={renderIcon}
          />
        ))}
      </div>
    </div>
  )
}
