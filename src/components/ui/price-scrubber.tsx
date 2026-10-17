"use client"

import { useId, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { AxisTag } from "@/components/ui/chart-overlay"
import { SegmentedControl } from "@/components/ui/segmented-control"

/* Price Scrubber: the wide price chart (560px, the Price chart family's width).
   A magnet crosshair snaps to the real datum, the pointed price is tagged on the axis,
   and scrubbing reads the point into the header in place, recolouring the chart off the
   window's first price. A soft wash rides the cursor.
   Data (Rules §1): the series is passed in from the live feed — this component never invents
   one. `labels` carries the real per-point time; `timeframes`, when provided, windows the
   series by its trailing length. `seriesByTimeframe`/`labelsByTimeframe` carry real per-timeframe
   history (Fase 3.2) and, when present for the active pill, are drawn as-is instead of windowing.
   Formulas:
   · move = the pointed price (or the last) − the window's first price
   · percent = move ÷ the window's first price × 100 */

const EASE = [0.16, 1, 0.3, 1] as const
const GREEN = "var(--chart-up)"
const RED = "var(--chart-down)"

/** every timeframe the scrubber knows about (the caller chooses which to show as pills) */
export type ScrubTimeframe = "1D" | "1W" | "1M" | "1Y" | "All"

/** trailing window length per timeframe */
const N: Record<ScrubTimeframe, number> = { "1D": 78, "1W": 84, "1M": 90, "1Y": 120, All: 150 }

function timeLabel(tf: ScrubTimeframe, f: number): string {
  const clamp = (x: number, top: number) => Math.max(0, Math.min(top, x))
  switch (tf) {
    case "1D": {
      const m = 570 + Math.round(f * 390)
      return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
    }
    case "1W":
      return ["Mon", "Tue", "Wed", "Thu", "Fri"][clamp(Math.floor(f * 5), 4)]
    case "1M":
      return `Day ${1 + Math.round(f * 29)}`
    case "1Y":
      return ["Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul"][clamp(Math.floor(f * 12), 11)]
    case "All":
      return `’${22 + clamp(Math.floor(f * 4), 4)}`
  }
}

const AXES: Record<ScrubTimeframe, string[]> = {
  "1D": ["09:30", "11:30", "13:30", "15:30"],
  "1W": ["Mon", "Wed", "Fri"],
  "1M": ["Wk 1", "Wk 2", "Wk 3", "Wk 4"],
  "1Y": ["Aug", "Nov", "Feb", "May"],
  All: ["’22", "’23", "’24", "’25", "’26"],
}

/** what the move is measured over, at rest */
const WINDOW: Record<ScrubTimeframe, string> = { "1D": "today", "1W": "past week", "1M": "past month", "1Y": "past year", All: "all time" }

const axisUsd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`
const fmtPrice = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const W = 560
const H = 220
const PAD = { l: 10, r: 66, t: 18, b: 26 }
const PLOT_W = W - PAD.l - PAD.r
const PLOT_H = H - PAD.t - PAD.b

/* the hover wash: half-width of the falloff in svg units and how far the rest of
   the series drops back while it is lit; the ramp plateaus around the cursor
   and tails off steeply, peaking under 1 so it reads as brightness, not bloom */
const SPOT = 215
const SPOT_DIM = 0.2
const SPOT_STOPS: [number, number][] = [
  [0, 0],
  [0.1, 0],
  [0.22, 0.05],
  [0.32, 0.2],
  [0.4, 0.5],
  [0.5, 0.78],
  [0.6, 0.5],
  [0.68, 0.2],
  [0.78, 0.05],
  [0.9, 0],
  [1, 0],
]

/** Three evenly spaced labels from a real per-point label array. */
function pickThree(labels: string[]): string[] {
  if (labels.length === 0) return []
  if (labels.length <= 3) return labels
  return [labels[0], labels[Math.floor((labels.length - 1) / 2)], labels[labels.length - 1]]
}

/**
 * The scrub chart: a magnet crosshair snaps to the real datum with the price
 * tagged on the axis, and scrubbing updates the header, which recolours the
 * whole chart off the reference price. A soft wash rides the
 * cursor, so the line reads lighter under the pointer and settles back on the
 * far sides. Timeframe pills, when supplied, morph the chart in place.
 */
export function PriceScrubber({
  name = "Market",
  symbol = "SOL/USDC",
  data,
  labels,
  windowLabel = "live session",
  timeframes,
  seriesByTimeframe,
  labelsByTimeframe,
  timeframe = "1Y",
  className,
}: {
  /** the market's name, on the label row's left */
  name?: string
  /** the ticker, on the label row's right */
  symbol?: string
  /** the real price series, oldest → latest (never generated here) */
  data: number[]
  /** real per-point time labels, aligned to `data` */
  labels?: string[]
  /** the window the move is measured over, at rest */
  windowLabel?: string
  /** when provided, shows the timeframe pills and windows the series by their trailing length */
  timeframes?: ScrubTimeframe[]
  /** real per-timeframe series (oldest → latest); drawn as-is for the active pill when present */
  seriesByTimeframe?: Partial<Record<ScrubTimeframe, number[]>>
  /** real per-timeframe time labels, aligned to `seriesByTimeframe` */
  labelsByTimeframe?: Partial<Record<ScrubTimeframe, string[]>>
  /** the timeframe the chart opens on (only used with `timeframes`) */
  timeframe?: ScrubTimeframe
  className?: string
}) {
  const reduced = useReducedMotion()
  const uid = useId().replace(/:/g, "")
  const svgRef = useRef<SVGSVGElement>(null)
  const [tf, setTf] = useState<ScrubTimeframe>(() =>
    timeframes?.includes(timeframe) ? timeframe : (timeframes?.[0] ?? timeframe),
  )
  const [hi, setHi] = useState<number | null>(null)

  const series = useMemo(() => {
    const real = timeframes ? seriesByTimeframe?.[tf] : undefined
    if (real && real.length >= 2) return real
    return timeframes ? data.slice(-N[tf]) : data
  }, [seriesByTimeframe, data, timeframes, tf])
  const seriesLabels = useMemo(() => {
    const real = timeframes ? labelsByTimeframe?.[tf] : undefined
    if (real && real.length === series.length) return real
    return labels ? (timeframes ? labels.slice(-N[tf]) : labels) : undefined
  }, [labelsByTimeframe, series, labels, timeframes, tf])
  const n = series.length

  const { min, max } = useMemo(() => {
    if (series.length === 0) return { min: 0, max: 1 }
    const lo = Math.min(...series)
    const top = Math.max(...series)
    const pad = (top - lo) * 0.08
    return { min: lo - pad, max: top + pad }
  }, [series])

  if (n < 2) return null

  const x = (i: number) => PAD.l + (i / (n - 1)) * PLOT_W
  const y = (v: number) => PAD.t + (1 - (v - min) / (max - min || 1)) * PLOT_H

  const onMove = (e: React.PointerEvent) => {
    const el = svgRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    setHi(Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / PLOT_W) * (n - 1)))))
  }

  const reference = series[0]
  const activeIdx = hi ?? n - 1
  const activeVal = series[activeIdx]
  const delta = activeVal - reference
  const deltaPct = (delta / reference) * 100
  const up = delta >= 0
  const hue = up ? GREEN : RED

  const line = series.map((v, idx) => `${idx === 0 ? "M" : "L"}${x(idx).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
  const area = `${line} L${x(n - 1).toFixed(1)},${H - PAD.b} L${x(0).toFixed(1)},${H - PAD.b} Z`
  const badgeY = y(activeVal)
  const crossX = x(activeIdx)
  const tagY = Math.max(PAD.t + 8, Math.min(H - PAD.b - 8, badgeY))
  const [whole, cents] = fmtPrice(activeVal).split(".")

  const atRest = hi === null
  const atLabel = (i: number) =>
    seriesLabels && seriesLabels[i] !== undefined
      ? seriesLabels[i]
      : timeframes
        ? timeLabel(tf, i / (n - 1))
        : `#${i + 1}`
  const windowText = atRest ? (timeframes ? WINDOW[tf] : windowLabel) : atLabel(activeIdx)
  const realLabels = timeframes ? labelsByTimeframe?.[tf] : undefined
  const axisLabels = realLabels
    ? pickThree(realLabels)
    : timeframes
      ? AXES[tf]
      : seriesLabels
        ? pickThree(seriesLabels)
        : []

  return (
    <div className={cn("w-[560px]", className)}>
      {/* the header, three tiers (spec 14.1); scrubbing reads the point in place, the timeframe switch sits on its right */}
      <div className="mb-3 flex items-baseline justify-between text-[12px]">
        <span className="truncate text-foreground/45">{name}</span>
        <span className="shrink-0 pl-3 font-medium text-foreground/90">{symbol}</span>
      </div>
      <div className="mb-2 flex items-end justify-between gap-4 tabular-nums" role="status">
        <div>
          <p className="m-0 text-[26px] font-semibold leading-none tracking-[-0.02em] text-foreground/90">
            {whole}
            <span className="text-foreground/35">.{cents}</span>
          </p>
          <p className="mb-0 mt-2 flex items-baseline gap-[7px] text-[12px] font-medium" style={{ color: hue }}>
            <span>
              {up ? "+" : "−"}
              {fmtPrice(Math.abs(delta))} · {up ? "+" : "−"}
              {Math.abs(deltaPct).toFixed(2)}%
            </span>
            <span className="font-normal text-foreground/45">{windowText}</span>
          </p>
        </div>
        {timeframes && timeframes.length > 0 ? (
          <SegmentedControl
            options={[...timeframes]}
            value={tf}
            onChange={(v) => {
              setTf(v as ScrubTimeframe)
              setHi(null)
            }}
            label="Timeframe"
            className="shrink-0"
          />
        ) : null}
      </div>

      <svg
        ref={svgRef}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block cursor-crosshair touch-none"
        role="img"
        aria-label={`${name} (${symbol}) price over the ${windowLabel}, ${fmtPrice(series[n - 1])}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHi(null)}
      >
        <defs>
          <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={hue} stopOpacity="0.16" />
            <stop offset="100%" stopColor={hue} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}-hot`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={hue} stopOpacity="0.24" />
            <stop offset="100%" stopColor={hue} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((f) => {
          const gy = PAD.t + f * PLOT_H
          /* a figure steps aside while the pointed tag sits on it */
          const under = hi !== null && Math.abs(gy - tagY) < 12
          return (
            <g key={f}>
              <line x1={PAD.l} y1={gy} x2={W - PAD.r} y2={gy} stroke="var(--foreground)" strokeOpacity={0.05} />
              <text
                x={W - PAD.r + 8}
                y={gy + 3}
                fontSize={9}
                fill="var(--foreground)"
                fillOpacity={0.45}
                className="tabular-nums"
                style={{ opacity: under ? 0 : 1, transition: reduced ? "none" : "opacity 150ms" }}
              >
                {axisUsd(max - f * (max - min))}
              </text>
            </g>
          )
        })}

        {axisLabels.map((t, idx, arr) => (
          <text key={`${t}-${idx}`} x={PAD.l + (idx / (arr.length - 1 || 1)) * PLOT_W} y={H - 8} textAnchor={idx === 0 ? "start" : idx === arr.length - 1 ? "end" : "middle"} fontSize={9} fill="var(--foreground)" fillOpacity={0.45}>
            {t}
          </text>
        ))}

        {/* area and line, re-keyed on the timeframe so they redraw; they sit back while scrubbing */}
        <g opacity={hi === null ? 1 : SPOT_DIM} style={{ transition: reduced ? "none" : "opacity 0.22s" }}>
          <motion.path key={`a-${tf}`} d={area} fill={`url(#${uid}-fill)`} initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} transition={reduced ? { duration: 0 } : { duration: 0.4, ease: EASE, delay: 0.35 }} />
          <motion.path key={`l-${tf}`} d={line} fill="none" stroke={hue} strokeWidth={1.8} strokeLinejoin="round" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={reduced ? { duration: 0 } : { duration: 0.85, ease: EASE }} />
        </g>

        {/* the wash: a full-strength copy revealed through a mask that rides the cursor */}
        <AnimatePresence>
          {hi !== null && (
            <motion.g key="spot" pointerEvents="none" initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.16 } }} transition={reduced ? { duration: 0 } : { duration: 0.2, ease: EASE }}>
              <defs>
                <linearGradient id={`${uid}-ramp`} gradientUnits="userSpaceOnUse" x1={crossX - SPOT} y1="0" x2={crossX + SPOT} y2="0">
                  {SPOT_STOPS.map(([offset, o]) => (
                    // oxlint-disable-next-line shadcn/no-raw-colors -- mask stop: a mask reads luminance, so it stays white in both themes
                    <stop key={offset} offset={`${offset * 100}%`} stopColor="white" stopOpacity={o} />
                  ))}
                </linearGradient>
                <mask id={`${uid}-mask`} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
                  <rect x={0} y={0} width={W} height={H} fill={`url(#${uid}-ramp)`} />
                </mask>
              </defs>
              <g mask={`url(#${uid}-mask)`}>
                <path d={area} fill={`url(#${uid}-hot)`} />
                <path d={line} fill="none" stroke={hue} strokeWidth={1.8} strokeLinejoin="round" />
              </g>
            </motion.g>
          )}
        </AnimatePresence>

        {/* magnet crosshair: rule, snapped dot and the pointed price tagged on the axis (chart-overlay.tsx) */}
        {hi !== null && (
          <g pointerEvents="none">
            <line x1={crossX} y1={PAD.t} x2={crossX} y2={H - PAD.b} stroke="var(--foreground)" strokeOpacity={0.2} strokeWidth={1} />
            <line x1={PAD.l} y1={badgeY} x2={W - PAD.r} y2={badgeY} stroke="var(--foreground)" strokeOpacity={0.14} strokeDasharray="3 3" strokeWidth={1} />
            <circle cx={crossX} cy={badgeY} r={3.5} fill={hue} stroke="var(--background)" strokeWidth={1.75} />
            <AxisTag x={W - PAD.r + 4} y={tagY} width={58} color={hue}>
              {fmtPrice(activeVal)}
            </AxisTag>
          </g>
        )}
      </svg>
    </div>
  )
}
