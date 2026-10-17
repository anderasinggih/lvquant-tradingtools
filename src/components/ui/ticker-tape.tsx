"use client"

import { useId, useState, type ReactNode } from "react"
import { useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { usePointed } from "@/components/ui/use-pointed"

/* Ticker Tape from SSYCH Vault.
   A finance tape running under a market header. At rest it stands still; while
   it is pointed at, the symbols drift left on a seamless loop.
   Hovering or focusing holds the tape. Signed moves read green up, red down.
   Strictly no emojis. */

const GREEN = "var(--chart-up)"
const RED = "var(--chart-down)"
const LOOP = 35
const FADE = "linear-gradient(90deg, transparent, black 40px, black calc(100% - 40px), transparent)"

export interface TickerRow {
  symbol: string
  price: number
  change: number
  name?: string
  color?: string
}

const fmtPrice = (v: number) => {
  if (v < 0.0001) return `$${v.toFixed(7)}`
  if (v < 0.01) return `$${v.toFixed(6)}`
  if (v < 1) return `$${v.toFixed(4)}`
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function Pass({
  rows,
  hot,
  onHot,
  onSelect,
  hidden,
  renderIcon,
}: {
  rows: TickerRow[]
  hot: string | null
  onHot: (symbol: string | null) => void
  onSelect?: (symbol: string) => void
  hidden?: boolean
  renderIcon?: (symbol: string, size: number) => ReactNode
}) {
  return (
    <div className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {rows.map((r) => {
        const up = r.change >= 0
        return (
          <button
            key={r.symbol}
            type="button"
            tabIndex={hidden ? -1 : 0}
            aria-label={`${r.symbol} ${fmtPrice(r.price)}, ${up ? "up" : "down"} ${Math.abs(r.change).toFixed(2)}%`}
            onPointerDown={() => onHot(r.symbol)}
            onPointerUp={() => onHot(null)}
            onPointerLeave={() => onHot(null)}
            onFocus={() => onHot(r.symbol)}
            onBlur={() => onHot(null)}
            onClick={() => onSelect?.(r.symbol)}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-full px-4 py-1 outline-none transition-[opacity,background-color] duration-150 hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.08]",
              hot !== null && hot !== r.symbol && "opacity-45",
            )}
          >
            {renderIcon ? (
              <span className="grid shrink-0 place-items-center">{renderIcon(r.symbol, 14)}</span>
            ) : (
              <span
                className="grid size-3.5 shrink-0 place-items-center rounded-full text-[8px] font-bold text-black"
                style={{ backgroundColor: r.color ?? "var(--foreground)" }}
              >
                {r.symbol.slice(0, 1)}
              </span>
            )}
            <span className="text-[12px] font-semibold text-foreground/90">{r.symbol}</span>
            <span className="text-[12px] text-foreground/70">{fmtPrice(r.price)}</span>
            <span className="text-[11px] font-medium" style={{ color: up ? GREEN : RED }}>
              {up ? "+" : "−"}
              {Math.abs(r.change).toFixed(2)}%
            </span>
          </button>
        )
      })}
    </div>
  )
}

export interface TickerTapeProps {
  rows: TickerRow[]
  onSelect?: (symbol: string) => void
  renderIcon?: (symbol: string, size: number) => ReactNode
  className?: string
}

export function TickerTape({ rows, onSelect, renderIcon, className }: TickerTapeProps) {
  const reduced = useReducedMotion()
  const pointed = usePointed()
  const [hot, setHot] = useState<string | null>(null)
  const anim = `tape-${useId().replace(/:/g, "")}`
  const running = pointed.live && hot === null

  if (!rows || rows.length === 0) return null

  return (
    <div
      ref={pointed.ref}
      {...pointed.bind}
      className={cn("w-full overflow-hidden border-y border-foreground/[0.06] bg-foreground/[0.015] py-1.5 tabular-nums", className)}
      role="marquee"
      aria-label={`Market ticker tape, ${rows.length} symbols`}
      onScroll={(e) => {
        e.currentTarget.scrollLeft = 0
      }}
    >
      {reduced ? (
        <Pass rows={rows} hot={hot} onHot={setHot} onSelect={onSelect} renderIcon={renderIcon} />
      ) : (
        <>
          <style>{`@keyframes ${anim} { from { transform: translateX(0) } to { transform: translateX(-50%) } }`}</style>
          <div
            className="flex w-max"
            style={{
              animation: `${anim} ${LOOP}s linear infinite`,
              animationPlayState: running ? "running" : "paused",
            }}
          >
            <Pass rows={rows} hot={hot} onHot={setHot} onSelect={onSelect} renderIcon={renderIcon} />
            <Pass rows={rows} hot={hot} onHot={setHot} onSelect={onSelect} renderIcon={renderIcon} hidden />
          </div>
        </>
      )}
    </div>
  )
}
