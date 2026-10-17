import type { TokenInfo } from "@/lib/market/tokens"

import { rawToAmount } from "./sizing"

/* Open-position model + exit monitor (Fase 5.2, PRD §4.3). A position is long the base asset (e.g.
   SOL bought with USDC); the monitor marks it to the live price and decides whether to close it back
   into the quote: a hard stop-loss caps the loss, a take-profit books the gain, and an optional
   trailing stop locks in a run once it is armed. All pure and deterministic — the same price and
   config always yield the same decision (Rules §1). The actual swap-back is executed by the monitor
   (see `closePosition`), never here. */

/** Exit parameters for one position (all percentages of the entry price). */
export interface PositionExitConfig {
  /** exit once the loss reaches this % (e.g. 3 → a −3% stop). */
  stopLossPct: number
  /** exit once the gain reaches this % (e.g. 6 → a +6% target). */
  takeProfitPct: number
  /** arm the trailing stop once the peak gain reaches this % (e.g. 10). Optional. */
  trailingStartPct?: number
  /** once armed, exit if price falls this % below the peak (e.g. 3). Required with `trailingStartPct`. */
  trailingStopPct?: number
}

/** A conservative starting point (PRD examples); the operator tunes these per strategy. */
export const DEFAULT_EXIT_CONFIG: PositionExitConfig = {
  stopLossPct: 3,
  takeProfitPct: 6,
}

/** One open long position: base held, priced in USD per base unit. */
export interface Position {
  /** caller-defined unique id (one per trade) */
  id: string
  pair: string
  base: TokenInfo
  quote: TokenInfo
  /** base amount held, in raw base units (lamports for SOL) */
  baseAmountRaw: bigint
  /** fill price in USD per 1 base unit at entry */
  entryPriceUsd: number
  /** USD notional deployed at entry (cost basis) */
  entryNotionalUsd: number
  /** highest base price seen since open — drives the trailing stop */
  peakPriceUsd: number
  /** ISO timestamp */
  openedAt: string
}

export type ExitReason = "stop_loss" | "take_profit" | "trailing_stop" | "hold"

export interface PositionEvaluation {
  id: string
  reason: ExitReason
  /** true when `reason !== "hold"` — the position should be closed */
  shouldExit: boolean
  currentPriceUsd: number
  entryPriceUsd: number
  /** the peak price after folding in `currentPriceUsd` (>= the position's previous peak) */
  peakPriceUsd: number
  /** unrealized PnL, % of entry (e.g. −3.2 or +6.1) */
  pnlPct: number
  /** unrealized PnL in USD */
  pnlUsd: number
  stopLossPriceUsd: number
  takeProfitPriceUsd: number
  /** the armed trailing-stop level, or null while the trailing stop is not yet armed */
  trailingStopPriceUsd: number | null
}

/** Human base amount held. */
export function baseAmountOf(position: Position): number {
  return rawToAmount(position.baseAmountRaw, position.base.decimals)
}

/** Unrealized PnL as a percentage of the entry price. */
export function unrealizedPnlPct(position: Position, currentPriceUsd: number): number {
  if (!(position.entryPriceUsd > 0)) throw new Error("position.entryPriceUsd must be positive")
  if (!(currentPriceUsd > 0)) throw new Error("currentPriceUsd must be positive")
  return (currentPriceUsd / position.entryPriceUsd - 1) * 100
}

/** Unrealized PnL in USD (base amount × price move). */
export function unrealizedPnlUsd(position: Position, currentPriceUsd: number): number {
  return baseAmountOf(position) * (currentPriceUsd - position.entryPriceUsd)
}

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`)
}

/** Validate an exit config; a misconfiguration is surfaced, never silently corrected. */
export function validateExitConfig(config: PositionExitConfig): void {
  assertPositive(config.stopLossPct, "stopLossPct")
  if (config.stopLossPct >= 100) throw new Error("stopLossPct must be below 100%")
  assertPositive(config.takeProfitPct, "takeProfitPct")

  const hasStart = config.trailingStartPct !== undefined
  const hasStop = config.trailingStopPct !== undefined
  if (hasStart !== hasStop) {
    throw new Error("trailingStartPct and trailingStopPct must be set together")
  }
  if (hasStart) {
    if (!Number.isFinite(config.trailingStartPct!) || config.trailingStartPct! < 0) {
      throw new Error("trailingStartPct must be a non-negative number")
    }
    assertPositive(config.trailingStopPct!, "trailingStopPct")
  }
}

/**
 * Evaluate one long position against the current price. Priority is stop-loss → take-profit →
 * trailing stop, so capital protection always wins. The returned `peakPriceUsd` folds in the current
 * price; the caller (e.g. {@link PositionTracker}) persists it so the trailing stop keeps its high.
 */
export function evaluateExit(
  position: Position,
  currentPriceUsd: number,
  config: PositionExitConfig,
): PositionEvaluation {
  validateExitConfig(config)
  if (!(position.entryPriceUsd > 0)) throw new Error("position.entryPriceUsd must be positive")
  if (!(currentPriceUsd > 0)) throw new Error("currentPriceUsd must be positive")

  const peakPriceUsd = Math.max(position.peakPriceUsd, currentPriceUsd)
  const pnlPct = unrealizedPnlPct(position, currentPriceUsd)
  const pnlUsd = unrealizedPnlUsd(position, currentPriceUsd)

  const stopLossPriceUsd = position.entryPriceUsd * (1 - config.stopLossPct / 100)
  const takeProfitPriceUsd = position.entryPriceUsd * (1 + config.takeProfitPct / 100)

  let trailingStopPriceUsd: number | null = null
  if (config.trailingStartPct !== undefined && config.trailingStopPct !== undefined) {
    const armedAt = position.entryPriceUsd * (1 + config.trailingStartPct / 100)
    if (peakPriceUsd >= armedAt) {
      trailingStopPriceUsd = peakPriceUsd * (1 - config.trailingStopPct / 100)
    }
  }

  let reason: ExitReason = "hold"
  if (currentPriceUsd <= stopLossPriceUsd) reason = "stop_loss"
  else if (currentPriceUsd >= takeProfitPriceUsd) reason = "take_profit"
  else if (trailingStopPriceUsd !== null && currentPriceUsd <= trailingStopPriceUsd) {
    reason = "trailing_stop"
  }

  return {
    id: position.id,
    reason,
    shouldExit: reason !== "hold",
    currentPriceUsd,
    entryPriceUsd: position.entryPriceUsd,
    peakPriceUsd,
    pnlPct,
    pnlUsd,
    stopLossPriceUsd,
    takeProfitPriceUsd,
    trailingStopPriceUsd,
  }
}
