"use client"

import { useId, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { SEGMENT_OFF, SURFACE, THUMB, TRACK } from "@/components/ui/control-classes"
import { LiveFigure } from "@/components/ui/live-figure"

/* Index Card, rebuilt through the ssych-component skill (2026-09-29).
   What changed against the version before it (in git history), and why:
   · no card: the outline, the card ground, the header band and the two inner rules are
     gone, and so is the dotted paper behind the line. Three 1px gridlines at 5% ink stay
   · the caption is ink, not amber: colour is kept for up and down
   · every figure is tabular (the root sets it, so the tab names with digits line up too)
   · the session time is plain text beside the price while you scrub, not a bordered chip
     riding the pointer
   · the index switcher is a row of quiet pills with one fill that slides to the chosen
     one (it was an underline on a rule)
   · the line is 1.8px with round joins; the change is printed with a true minus sign
   · the chart names itself to a screen reader, with the index and its close
   Motion (2026-10-01): once the plot first comes into view the line and its fill are wiped
   in from the left by one clip, 850ms. Changing index morphs the line and the fill from the
   old session into the new one in 380ms (both walks are 48 samples, so the paths tween
   point for point) and the hue crosses over; it used to wipe out and redraw. Reduced
   motion draws every state at once.
   2026-10-02 audit: it sits in a box now (his call), the surface step at 7% with radius 24
   and a 10px padding, the type 16px in. The eyebrow and the 19px price gave way to the
   three tier header: the index's name at /45 with its symbol at /90, the level at 26px
   with its decimals at /35, then the change in its hue and "today" or the pointed time at
   /45. Index levels are points, so no dollar sign anywhere. Scrubbing changes the figures
   in place; they swap only when a scrub starts or ends or the index changes (they used to
   blur in again on every pointer step). The index switch is cut from the control material
   (TRACK, THUMB, SEGMENT_OFF) and glides on the tab ease; the note is 12px at /70, two
   lines at most. "Russel 2K" is spelled Russell 2000. IndexQuote gains optional `name`
   and `symbol` for the label row, and the pointed level is now anchored to the day's open
   so the move on the sub line is derivable.
   Formulas:
   · open = close − the change written in `delta`
   · level at a sample i = open + (close − open) × i ÷ 47 + 0.0004 × close × (w_i − w_0 −
     (w_47 − w_0) × i ÷ 47), where w is the index's seeded walk; it opens at the open and
     closes on the close exactly
   · pointed move = level − open; percent = move ÷ open × 100
   2026-10-02 round 2: his notes. The index switch is roomier: the box's padding is 6px
   instead of 10, so the track runs 328px wide, and each switch is 30px tall with 4px between
   them (corner 24 = the track's 18 + the 6px gap). The small caps index reads "Russell 2K"
   again on its switch and in the label row. The day's line runs the box's full width, edge
   to edge, with no side padding (the plot is 340 wide now, drawn 1:1); the type keeps its
   16px inset. */

const EASE = [0.16, 1, 0.3, 1] as const
const GREEN = "var(--chart-up)"
const RED = "var(--chart-down)"

/** the plot spans the box's full width, edge to edge (round 2) */
const W = 340
const H = 110
const SAMPLES = 48
/** fractions down the plot where a gridline sits */
const GRID = [0.25, 0.5, 0.75]
/** the walk's units, as a share of the close */
const WIGGLE = 0.0004

export interface IndexQuote {
  /** the short name on its switch */
  label: string
  /** the full name in the label row; falls back to `label` */
  name?: string
  /** the symbol on the label row's right, e.g. "SPX" */
  symbol?: string
  /** Already-formatted close in points, e.g. "5,648.40". */
  price: string
  /** Already-formatted change, e.g. "+63.97 (+1.15%)". A leading − flips the hue. */
  delta: string
  /** Deterministic seed for this index's intraday walk. */
  seed: number
  /** The short read under the line, two lines at most. */
  note: string
}

const DEFAULT_INDICES: IndexQuote[] = [
  {
    label: "S&P 500",
    symbol: "SPX",
    price: "5,648.40",
    delta: "+63.97 (+1.15%)",
    seed: 5,
    note: "Broad strength into the close; 8 of 11 sectors finished green, led by industrials and financials.",
  },
  {
    label: "Dow 30",
    name: "Dow Jones 30",
    symbol: "DJI",
    price: "41,563.08",
    delta: "+228.03 (+0.55%)",
    seed: 31,
    note: "Blue chips ground higher through the session on a soft landing read of the latest inflation print.",
  },
  {
    label: "Nasdaq",
    name: "Nasdaq Composite",
    symbol: "IXIC",
    price: "17,713.62",
    delta: "+197.19 (+1.13%)",
    seed: 77,
    note: "Megacap tech carried the tape; semis rebounded from early weakness to finish near session highs.",
  },
  {
    label: "Russell 2K",
    symbol: "RUT",
    price: "2,178.52",
    delta: "+14.10 (+0.65%)",
    seed: 111,
    note: "Consumer sentiment turned up for the first time in five months, and small caps took the hint.",
  },
]

/** Deterministic intraday walk: same seed, same shape, every render. */
function walk(seed: number, n: number) {
  let s = seed
  let v = 40
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    s = (s * 48271) % 2147483647
    v = Math.max(10, v + (s / 2147483647 - 0.42) * 5)
    out.push(v)
  }
  return out
}

/** Session clock across the samples, open to close, spread evenly. */
function timeAt(i: number, n: number, openMin: number, closeMin: number) {
  const m = openMin + Math.round((i / (n - 1)) * (closeMin - openMin))
  const h = Math.floor(m / 60)
  return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
}

const points = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${points(Math.abs(v))}`

export interface IndexCardProps {
  /** what the indices are; read in the aria-label (it was a visible eyebrow before 2026-10-02) */
  eyebrow?: string
  /** One switch per index; four fit the 340px width. */
  indices?: IndexQuote[]
  /** Which index opens selected. */
  defaultIndex?: number
  /** Session bounds for the scrub readout, in minutes past midnight. */
  openMinutes?: number
  closeMinutes?: number
  /** Fires when an index is chosen. */
  onSelect?: (index: IndexQuote, i: number) => void
  className?: string
}

/**
 * Markets block in a box: one index level, the day's line you can scrub, a short read and
 * a switch to change index. Scrubbing snaps a rule to the nearest sample, reads that
 * level, its move from the open and its session time in the header, and dims the line to
 * the right of the pointer. Changing index swaps level, line and read together.
 */
export function IndexCard({
  eyebrow = "Markets",
  indices = DEFAULT_INDICES,
  defaultIndex = 3,
  openMinutes = 570,
  closeMinutes = 960,
  onSelect,
  className,
}: IndexCardProps) {
  const reduced = useReducedMotion() ?? false
  const uid = useId().replace(/:/g, "")
  const [active, setActive] = useState(Math.min(Math.max(defaultIndex, 0), indices.length - 1))
  const idx = indices[active]

  const up = !idx.delta.trim().startsWith("-") && !idx.delta.trim().startsWith("−")
  const hue = up ? GREEN : RED
  /** the change as written, with every hyphen minus made a true minus */
  const delta = idx.delta.replace(/-(?=[\d.])/g, "−")

  /* the level at every sample, anchored to the day's open and its close (formulas above) */
  const close = parseFloat(idx.price.replace(/,/g, ""))
  const change = parseFloat(idx.delta.trim().replace(/^−/, "-").replace(/,/g, "").replace(/[^\d.+-].*$/, "")) || 0
  const open = close - change
  const data = useMemo(() => {
    const w = walk(idx.seed, SAMPLES)
    const n = w.length
    const drift = w[n - 1] - w[0]
    return w.map((v, i) => open + ((close - open) * i) / (n - 1) + WIGGLE * close * (v - w[0] - (drift * i) / (n - 1)))
  }, [idx.seed, open, close])
  const n = data.length
  const min = Math.min(...data)
  const max = Math.max(...data)
  const px = (i: number) => (i / (n - 1)) * W
  const py = (v: number) => 6 + (1 - (v - min) / (max - min || 1)) * (H - 12)
  const line = data.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" L")

  // the rule snaps to the NEAREST sample and drives the readout at once
  const svgRef = useRef<SVGSVGElement>(null)
  const seen = useInView(svgRef, { once: true, amount: 0.3 })
  const shown = seen || reduced
  const [hover, setHover] = useState<number | null>(null)
  const onMove = (e: React.PointerEvent) => {
    const el = svgRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W
    setHover(Math.max(0, Math.min(n - 1, Math.round((x / W) * (n - 1)))))
  }
  const onLeave = () => setHover(null)

  const pointed = hover == null || !Number.isFinite(close) ? null : data[hover]
  const [whole, decimals] = (pointed == null ? idx.price : points(pointed)).split(".")
  const move = pointed == null ? change : pointed - open
  const pct = open ? (move / open) * 100 : 0
  const moveText = pointed == null ? delta : `${signed(move)} (${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%)`
  const crossX = hover == null ? 0 : px(hover)

  return (
    <div
      className={cn("w-[340px] max-w-full overflow-hidden rounded-[24px] p-1.5 tabular-nums", SURFACE, className)}
      role="group"
      aria-label={`${eyebrow}: ${idx.name ?? idx.label}, ${idx.price} points, ${delta} today`}
    >
      <div className="px-2.5 pt-2.5">
        {/* the header, three tiers (spec 14.1) */}
        <div className="mb-3 flex items-baseline justify-between text-[12px]">
          <span className="truncate text-foreground/45">{idx.name ?? idx.label}</span>
          {idx.symbol && <span className="shrink-0 pl-3 font-medium text-foreground/90">{idx.symbol}</span>}
        </div>
        <div role="status">
          {/* the figures swap only when a scrub starts or ends or the index changes */}
          <LiveFigure intent={`${active}-${hover == null ? "close" : "scrub"}`}>
            <p className="m-0 text-[26px] font-semibold leading-none tracking-[-0.02em] text-foreground/90">
              {whole}
              {decimals && <span className="text-foreground/35">.{decimals}</span>}
            </p>
            <p className="mb-0 mt-2 flex items-baseline gap-[7px] text-[12px] font-medium" style={{ color: move >= 0 ? GREEN : RED }}>
              <span>{moveText}</span>
              <span className="font-normal text-foreground/45">{hover == null ? "today" : timeAt(hover, n, openMinutes, closeMinutes)}</span>
            </p>
          </LiveFigure>
        </div>
      </div>

      {/* the day's line; right of the pointer dims */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="-mx-1.5 mt-4 block w-[calc(100%+12px)] max-w-none cursor-crosshair touch-none overflow-visible"
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        onPointerCancel={onLeave}
        role="img"
        aria-label={`${idx.name ?? idx.label} through the session, closing at ${idx.price} points, ${delta}`}
      >
        <defs>
          <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={hue} stopOpacity="0.14" style={{ transition: reduced ? "none" : "stop-color 200ms" }} />
            <stop offset="100%" stopColor={hue} stopOpacity="0" style={{ transition: reduced ? "none" : "stop-color 200ms" }} />
          </linearGradient>
          {/* the entrance: one clip wipes the line and its fill in from the left, once */}
          <clipPath id={`${uid}-wipe`}>
            <motion.rect
              x={-4}
              y={-4}
              height={H + 8}
              initial={{ width: reduced ? W + 8 : 0 }}
              animate={{ width: shown ? W + 8 : 0 }}
              transition={reduced ? { duration: 0 } : { duration: 0.85, ease: EASE }}
            />
          </clipPath>
          <clipPath id={`${uid}-left`}>
            <rect x={0} y={0} width={crossX} height={H} />
          </clipPath>
        </defs>

        {GRID.map((f) => (
          <line key={f} x1={0} x2={W} y1={f * H} y2={f * H} stroke="var(--foreground)" strokeOpacity={0.05} strokeWidth={1} />
        ))}

        {/* the whole line, which steps back while scrubbing; a new index morphs it in place */}
        <g clipPath={`url(#${uid}-wipe)`} opacity={hover == null ? 1 : 0.45} style={{ transition: reduced ? "none" : "opacity 200ms" }}>
          <motion.path
            initial={false}
            animate={{ d: `M${line} L ${W},${H} L 0,${H} Z` }}
            transition={reduced ? { duration: 0 } : { duration: 0.38, ease: EASE }}
            fill={`url(#${uid}-fill)`}
          />
          <motion.path
            initial={false}
            animate={{ d: `M${line}` }}
            transition={reduced ? { duration: 0 } : { duration: 0.38, ease: EASE }}
            fill="none"
            stroke={hue}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transition: reduced ? "none" : "stroke 200ms" }}
          />
        </g>

        {/* a full-strength copy, kept to the LEFT of the pointer */}
        {hover != null && (
          <g clipPath={`url(#${uid}-left)`} pointerEvents="none">
            <path d={`M${line} L ${W},${H} L 0,${H} Z`} fill={`url(#${uid}-fill)`} />
            <path d={`M${line}`} fill="none" stroke={hue} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        )}

        {hover != null && (
          <g pointerEvents="none">
            <line x1={crossX} x2={crossX} y1={0} y2={H} stroke="var(--foreground)" strokeOpacity={0.18} strokeWidth={1} />
            <circle cx={crossX} cy={py(data[hover])} r={3} fill={hue} stroke="var(--background)" strokeWidth={1.5} />
          </g>
        )}
      </svg>

      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={idx.label}
          className="mx-2.5 mb-0 mt-3 line-clamp-2 text-[12px] leading-[1.5] text-foreground/70"
          initial={{ opacity: reduced ? 1 : 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.1 } }}
          transition={reduced ? { duration: 0 } : { duration: 0.3, ease: EASE }}
        >
          {idx.note}
        </motion.p>
      </AnimatePresence>

      {/* the index switch, in the control material; it sits on the box's edge so the corners
          nest: 30px switches + 2px padding + 1px border = 36 tall, corner 18; 18 + the 6px gap = 24 */}
      <div className={cn("mt-4 flex gap-1", TRACK)} role="group" aria-label="Index">
        {indices.map((ix, i) => (
          <button
            key={ix.label}
            type="button"
            aria-pressed={active === i}
            aria-label={`${ix.name ?? ix.label}, ${ix.price} points`}
            onClick={() => {
              setActive(i)
              onLeave()
              onSelect?.(ix, i)
            }}
            className={cn(
              "relative h-[30px] flex-1 whitespace-nowrap rounded-full px-2 text-center text-[11.5px] font-medium outline-none transition-colors duration-150 focus-visible:text-foreground/90",
              active === i ? "text-foreground/90" : SEGMENT_OFF,
            )}
          >
            {active === i &&
              (reduced ? (
                <span aria-hidden className={cn("absolute inset-0 rounded-full", THUMB)} />
              ) : (
                <motion.span
                  aria-hidden
                  layoutId={`${uid}-pill`}
                  className={cn("absolute inset-0 rounded-full", THUMB)}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                />
              ))}
            <span className="relative">{ix.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
