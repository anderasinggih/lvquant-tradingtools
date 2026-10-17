"use client"

import { useCallback, useEffect, useState } from "react"

import { Panel } from "@/components/dashboard/panel"
import { BUTTON, BUTTON_PRIMARY } from "@/components/ui/control-classes"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { cn } from "@/lib/utils"

/* Bot Quant Configuration Panel (Fase 4 & 5).
   Enables setting quant trading strategy parameters, execution venue (Spot vs Drift Leverage),
   position sizing, stop loss, take profit, trailing stops, slippage, and circuit breaker.
   Strictly zero mock data, zero emojis. Utilizes 100% SSYCH Vault design tokens. */

const STRATEGIES = ["EMA Trend", "Mean Reversion", "Breakout"] as const
const VENUES = ["Jupiter Spot", "Drift Perp"] as const
const LEVERAGES = ["1x", "2x", "5x", "10x", "20x", "50x"] as const
const SIZES = ["2%", "5%", "10%", "20%"] as const
const STOP_LOSSES = ["1.5%", "2.5%", "5.0%"] as const
const TAKE_PROFITS = ["3.0%", "6.0%", "12.0%"] as const
const TRAILING_STOPS = ["Disabled", "Arm +2% / Trail 1%"] as const
const SLIPPAGES = ["50 bps (0.5%)", "100 bps (1.0%)", "200 bps (2.0%)"] as const
const DAILY_LIMITS = ["$50", "$100", "$250", "$500"] as const
const MODES = ["Dry-Run", "Live Mainnet"] as const

export const DEFAULT_BOT_PAIRS = [
  "SOL/USDC",
  "BONK/USDC",
  "WIF/USDC",
  "POPCAT/USDC",
  "PNUT/USDC",
  "GOAT/USDC",
  "JUP/USDC",
  "RAY/USDC",
] as const

interface QuantBotConfigResponse {
  pair?: string
  strategy?: (typeof STRATEGIES)[number]
  venue?: (typeof VENUES)[number]
  leverage?: number
  sizePct?: number
  stopLossPct?: number
  takeProfitPct?: number
  trailingStopEnabled?: boolean
  trailingArmPct?: number
  trailingOffsetPct?: number
  slippageBps?: number
  dailyLossLimitUsd?: number
  mode?: (typeof MODES)[number]
  updatedAt?: string
}

export function BotConfigPanel({
  className,
  activeSymbol,
}: {
  className?: string
  activeSymbol?: string
}) {
  const [pair, setPair] = useState<string>("SOL/USDC")
  const [strategy, setStrategy] = useState<(typeof STRATEGIES)[number]>("EMA Trend")
  const [venue, setVenue] = useState<(typeof VENUES)[number]>("Jupiter Spot")
  const [leverage, setLeverage] = useState<(typeof LEVERAGES)[number]>("1x")
  const [size, setSize] = useState<(typeof SIZES)[number]>("5%")
  const [stopLoss, setStopLoss] = useState<(typeof STOP_LOSSES)[number]>("2.5%")
  const [takeProfit, setTakeProfit] = useState<(typeof TAKE_PROFITS)[number]>("6.0%")
  const [trailingStop, setTrailingStop] = useState<(typeof TRAILING_STOPS)[number]>("Arm +2% / Trail 1%")
  const [slippage, setSlippage] = useState<(typeof SLIPPAGES)[number]>("100 bps (1.0%)")
  const [dailyLimit, setDailyLimit] = useState<(typeof DAILY_LIMITS)[number]>("$100")
  const [mode, setMode] = useState<(typeof MODES)[number]>("Dry-Run")

  const [savedStatus, setSavedStatus] = useState<string | null>(null)
  const [errorStatus, setErrorStatus] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Load active persisted config from backend on mount
  useEffect(() => {
    let active = true
    const loadConfig = async () => {
      try {
        const res = await fetch("/api/bot/config", { cache: "no-store" })
        if (!res.ok) return
        const cfg = (await res.json()) as QuantBotConfigResponse
        if (!active || !cfg) return

        if (cfg.pair) setPair(cfg.pair.toUpperCase())
        if (cfg.strategy && STRATEGIES.includes(cfg.strategy)) setStrategy(cfg.strategy)
        if (cfg.venue && VENUES.includes(cfg.venue)) setVenue(cfg.venue)
        if (cfg.leverage) {
          const levStr = `${cfg.leverage}x` as (typeof LEVERAGES)[number]
          if (LEVERAGES.includes(levStr)) setLeverage(levStr)
        }
        if (cfg.sizePct) {
          const sizeStr = `${cfg.sizePct}%` as (typeof SIZES)[number]
          if (SIZES.includes(sizeStr)) setSize(sizeStr)
        }
        if (cfg.stopLossPct) {
          const slStr = `${cfg.stopLossPct.toFixed(1)}%` as (typeof STOP_LOSSES)[number]
          if (STOP_LOSSES.includes(slStr)) setStopLoss(slStr)
        }
        if (cfg.takeProfitPct) {
          const tpStr = `${cfg.takeProfitPct.toFixed(1)}%` as (typeof TAKE_PROFITS)[number]
          if (TAKE_PROFITS.includes(tpStr)) setTakeProfit(tpStr)
        }
        if (cfg.trailingStopEnabled !== undefined) {
          setTrailingStop(cfg.trailingStopEnabled ? "Arm +2% / Trail 1%" : "Disabled")
        }
        if (cfg.slippageBps !== undefined) {
          if (cfg.slippageBps <= 50) setSlippage("50 bps (0.5%)")
          else if (cfg.slippageBps >= 200) setSlippage("200 bps (2.0%)")
          else setSlippage("100 bps (1.0%)")
        }
        if (cfg.dailyLossLimitUsd) {
          const limitStr = `$${cfg.dailyLossLimitUsd}` as (typeof DAILY_LIMITS)[number]
          if (DAILY_LIMITS.includes(limitStr)) setDailyLimit(limitStr)
        }
        if (cfg.mode && MODES.includes(cfg.mode)) setMode(cfg.mode)
      } catch {
        // network error fallback
      }
    }
    void loadConfig()
    return () => {
      active = false
    }
  }, [])

  const handleApply = async () => {
    setIsSaving(true)
    setErrorStatus(null)
    setSavedStatus(null)

    const payload = {
      pair,
      strategy,
      venue,
      leverage: parseInt(leverage.replace("x", ""), 10) || 1,
      sizePct: parseFloat(size.replace("%", "")) || 5,
      stopLossPct: parseFloat(stopLoss.replace("%", "")) || 2.5,
      takeProfitPct: parseFloat(takeProfit.replace("%", "")) || 6.0,
      trailingStopEnabled: trailingStop !== "Disabled",
      trailingArmPct: 2.0,
      trailingOffsetPct: 1.0,
      slippageBps: slippage.startsWith("50") ? 50 : slippage.startsWith("200") ? 200 : 100,
      dailyLossLimitUsd: parseInt(dailyLimit.replace("$", ""), 10) || 100,
      mode,
    }

    try {
      const res = await fetch("/api/bot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || `Configuration update failed (${res.status})`)
      }
      setSavedStatus(`Configuration saved & active on ${pair} (${new Date().toLocaleTimeString()}).`)
      setTimeout(() => setSavedStatus(null), 5000)
    } catch (err) {
      setErrorStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSaving(false)
    }
  }

  const availablePairs = Array.from(
    new Set([...DEFAULT_BOT_PAIRS, `${activeSymbol ?? "SOL"}/USDC`]),
  )

  return (
    <Panel
      title="Quant Strategy & Risk Configuration"
      action={
        <SegmentedControl
          options={[...MODES]}
          value={mode}
          onChange={(v) => setMode(v as (typeof MODES)[number])}
          label="Trading mode"
        />
      }
      className={className}
    >
      <div className="flex flex-col gap-5 text-[12px]">
        {/* Row 0: Target Trading Pair */}
        <div>
          <div className="mb-1.5 flex items-center justify-between font-medium text-foreground/60">
            <span>Target Trading Pair</span>
            {activeSymbol && pair !== `${activeSymbol}/USDC` ? (
              <button
                type="button"
                onClick={() => setPair(`${activeSymbol}/USDC`)}
                className="font-mono text-[11px] text-chart-up hover:underline"
              >
                Set Bot to {activeSymbol}/USDC
              </button>
            ) : (
              <span className="text-[11px] text-foreground/45">Bot executes trades on this market</span>
            )}
          </div>
          <SegmentedControl
            options={availablePairs}
            value={pair}
            onChange={(v) => setPair(v)}
            label="Trading pair"
          />
        </div>

        {/* Row 1: Strategy & Venue */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block font-medium text-foreground/60">Alpha Strategy</label>
            <SegmentedControl
              options={[...STRATEGIES]}
              value={strategy}
              onChange={(v) => setStrategy(v as (typeof STRATEGIES)[number])}
              label="Strategy"
            />
          </div>

          <div>
            <label className="mb-1.5 block font-medium text-foreground/60">Execution Venue</label>
            <SegmentedControl
              options={[...VENUES]}
              value={venue}
              onChange={(v) => {
                const val = v as (typeof VENUES)[number]
                setVenue(val)
                if (val === "Jupiter Spot") setLeverage("1x")
              }}
              label="Execution venue"
            />
          </div>
        </div>

        {/* Row 2: Leverage (Drift) & Position Sizing */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 flex items-center justify-between font-medium text-foreground/60">
              <span>Drift Leverage Multiplier</span>
              <span className="text-[11px] text-foreground/45">{venue === "Jupiter Spot" ? "1x fixed (Spot)" : "Up to 50x"}</span>
            </label>
            <SegmentedControl
              options={[...LEVERAGES]}
              value={venue === "Jupiter Spot" ? "1x" : leverage}
              onChange={(v) => {
                const val = v as (typeof LEVERAGES)[number]
                setLeverage(val)
                if (val !== "1x") {
                  setVenue("Drift Perp")
                }
              }}
              label="Leverage"
            />
          </div>

          <div>
            <label className="mb-1.5 flex items-center justify-between font-medium text-foreground/60">
              <span>Position Size (% of Capital)</span>
              <span className="text-[11px] text-foreground/45">Guarded min 0.05 SOL</span>
            </label>
            <SegmentedControl
              options={[...SIZES]}
              value={size}
              onChange={(v) => setSize(v as (typeof SIZES)[number])}
              label="Position sizing"
            />
          </div>
        </div>

        {/* Row 3: Stop Loss & Take Profit */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block font-medium text-foreground/60">Hard Stop-Loss</label>
            <SegmentedControl
              options={[...STOP_LOSSES]}
              value={stopLoss}
              onChange={(v) => setStopLoss(v as (typeof STOP_LOSSES)[number])}
              label="Stop loss"
            />
          </div>

          <div>
            <label className="mb-1.5 block font-medium text-foreground/60">Take-Profit Target</label>
            <SegmentedControl
              options={[...TAKE_PROFITS]}
              value={takeProfit}
              onChange={(v) => setTakeProfit(v as (typeof TAKE_PROFITS)[number])}
              label="Take profit"
            />
          </div>
        </div>

        {/* Row 4: Trailing Stop & Max Slippage */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block font-medium text-foreground/60">Trailing Stop Exit</label>
            <SegmentedControl
              options={[...TRAILING_STOPS]}
              value={trailingStop}
              onChange={(v) => setTrailingStop(v as (typeof TRAILING_STOPS)[number])}
              label="Trailing stop"
            />
          </div>

          <div>
            <label className="mb-1.5 block font-medium text-foreground/60">Max Slippage Tolerance</label>
            <SegmentedControl
              options={[...SLIPPAGES]}
              value={slippage}
              onChange={(v) => setSlippage(v as (typeof SLIPPAGES)[number])}
              label="Slippage tolerance"
            />
          </div>
        </div>

        {/* Row 5: Circuit Breaker Daily Limit */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 flex items-center justify-between font-medium text-foreground/60">
              <span>Circuit Breaker 24h Loss Cap</span>
              <span className="text-[11px] text-foreground/45">Automatic buy block</span>
            </label>
            <SegmentedControl
              options={[...DAILY_LIMITS]}
              value={dailyLimit}
              onChange={(v) => setDailyLimit(v as (typeof DAILY_LIMITS)[number])}
              label="Circuit breaker limit"
            />
          </div>

          <div className="flex flex-col justify-end">
            <button
              type="button"
              onClick={handleApply}
              disabled={isSaving}
              className={cn(BUTTON, "h-9 w-full font-medium text-[12.5px] disabled:opacity-50")}
            >
              {isSaving ? "Saving to Engine..." : "Apply & Save Configuration"}
            </button>
          </div>
        </div>

        {savedStatus && (
          <p className="font-mono text-[11px] text-chart-up" role="status">
            {savedStatus}
          </p>
        )}

        {errorStatus && (
          <p className="font-mono text-[11px] text-chart-down" role="alert">
            {errorStatus}
          </p>
        )}
      </div>
    </Panel>
  )
}
