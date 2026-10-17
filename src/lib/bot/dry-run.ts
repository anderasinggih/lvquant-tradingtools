import { getLiveMarketPrice } from "@/lib/market/price-feed"
import { TARGET_PAIR } from "@/lib/market/tokens"
import {
  DailyLossCircuitBreaker,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  type CircuitBreakerConfig,
  type CircuitBreakerState,
} from "@/lib/risk/circuit-breaker"
import { PositionTracker, createPosition } from "@/lib/risk/monitor"
import {
  DEFAULT_EXIT_CONFIG,
  unrealizedPnlUsd,
  validateExitConfig,
  type ExitReason,
  type PositionExitConfig,
} from "@/lib/risk/positions"
import { rawToAmount, usdToTokenRaw } from "@/lib/risk/sizing"

/* Dry-run trading loop (Fase 6.1, PRD §5). Drives a paper-trading loop on the REAL live Jupiter
   SOL/USDC price — no transaction is ever built, signed or sent. Each tick it: reads the live price,
   marks the open paper position to market (advancing its trailing-stop peak), evaluates the exit
   rules through the same `PositionTracker`/`evaluateExit` the live bot uses, opening/closing paper
   positions and feeding the realized PnL into the real `DailyLossCircuitBreaker`. It exists to prove
   signal detection, stop-loss / take-profit evaluation and the circuit breaker run smoothly and
   without error against live data. Isolation is deliberate: its own tracker + breaker, so it never
   touches the live bot's real positions (Rules §1 / §2). */

export type DryRunStatus = "IDLE" | "RUNNING" | "STOPPED" | "COMPLETED"

/** Stop the loop after this many consecutive price-feed failures (an offline feed must not spin). */
export const MAX_CONSECUTIVE_PRICE_ERRORS = 5

export interface DryRunOptions {
  /** ms between ticks; default 5000. */
  intervalMs?: number
  /** stop after this many ticks; null/omitted = run until stopped. */
  maxTicks?: number | null
  /** paper position notional in USD; default 20. */
  notionalUsd?: number
  /** exit rules (defaults to the conservative 3% / 6% `DEFAULT_EXIT_CONFIG`). */
  exitConfig?: PositionExitConfig
  /** circuit-breaker config (defaults to `DEFAULT_CIRCUIT_BREAKER_CONFIG`). */
  circuitBreakerConfig?: CircuitBreakerConfig
  /** how many recent log lines to retain; default 200. */
  maxLogEntries?: number
  /** external abort (e.g. the bot controller's loop signal). */
  signal?: AbortSignal
}

interface ResolvedOptions {
  intervalMs: number
  maxTicks: number | null
  notionalUsd: number
  exitConfig: PositionExitConfig
  circuitBreakerConfig: CircuitBreakerConfig
  maxLogEntries: number
}

export interface DryRunCounters {
  ticks: number
  entries: number
  exits: number
  stopLoss: number
  takeProfit: number
  trailingStop: number
  blockedBuys: number
  priceErrors: number
}

export interface DryRunTrade {
  id: string
  pair: string
  entryPriceUsd: number
  exitPriceUsd: number
  exitReason: ExitReason
  pnlUsd: number
  pnlPct: number
  openedAt: string
  closedAt: string
}

export interface DryRunLogEntry {
  at: string
  level: "info" | "trade" | "warn" | "error"
  message: string
}

export interface DryRunPositionView {
  id: string
  pair: string
  entryPriceUsd: number
  peakPriceUsd: number
  baseAmount: number
  openedAt: string
}

export interface DryRunState {
  status: DryRunStatus
  running: boolean
  startedAt: string | null
  stoppedAt: string | null
  options: ResolvedOptions
  lastPrice: number | null
  lastTickAt: string | null
  openPosition: DryRunPositionView | null
  circuitBreaker: CircuitBreakerState
  counters: DryRunCounters
  trades: DryRunTrade[]
  log: DryRunLogEntry[]
  lastError: string | null
}

const DEFAULT_OPTIONS: ResolvedOptions = {
  intervalMs: 5000,
  maxTicks: null,
  notionalUsd: 20,
  exitConfig: DEFAULT_EXIT_CONFIG,
  circuitBreakerConfig: DEFAULT_CIRCUIT_BREAKER_CONFIG,
  maxLogEntries: 200,
}

function resolveOptions(options: DryRunOptions): ResolvedOptions {
  const intervalMs = options.intervalMs ?? DEFAULT_OPTIONS.intervalMs
  if (!Number.isFinite(intervalMs) || intervalMs < 250) {
    throw new Error("intervalMs must be a number >= 250")
  }
  const notionalUsd = options.notionalUsd ?? DEFAULT_OPTIONS.notionalUsd
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
    throw new Error("notionalUsd must be a positive number")
  }
  const maxTicks = options.maxTicks ?? DEFAULT_OPTIONS.maxTicks
  if (maxTicks !== null && (!Number.isInteger(maxTicks) || maxTicks <= 0)) {
    throw new Error("maxTicks must be a positive integer or null")
  }
  const maxLogEntries = options.maxLogEntries ?? DEFAULT_OPTIONS.maxLogEntries
  if (!Number.isInteger(maxLogEntries) || maxLogEntries <= 0) {
    throw new Error("maxLogEntries must be a positive integer")
  }
  const exitConfig = options.exitConfig ?? DEFAULT_OPTIONS.exitConfig
  validateExitConfig(exitConfig)
  const circuitBreakerConfig = options.circuitBreakerConfig ?? DEFAULT_OPTIONS.circuitBreakerConfig
  return { intervalMs, maxTicks, notionalUsd, exitConfig, circuitBreakerConfig, maxLogEntries }
}

const price4 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const pnl2 = (n: number) => `${n < 0 ? "−" : "+"}$${Math.abs(n).toFixed(2)}`

/**
 * The background paper-trading loop. One instance per process; start it, read {@link state} for the
 * live log, and stop it. Uses only the live price feed and the shared risk logic — never a swap.
 */
export class DryRunEngine {
  private options: ResolvedOptions = DEFAULT_OPTIONS
  private tracker = new PositionTracker()
  private breaker = new DailyLossCircuitBreaker()
  private status: DryRunStatus = "IDLE"
  private startedAt: string | null = null
  private stoppedAt: string | null = null
  private lastPrice: number | null = null
  private lastTickAt: string | null = null
  private lastError: string | null = null
  private consecutiveErrors = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private abortSignal: AbortSignal | null = null
  private abortListener: (() => void) | null = null
  private readonly counters: DryRunCounters = {
    ticks: 0,
    entries: 0,
    exits: 0,
    stopLoss: 0,
    takeProfit: 0,
    trailingStop: 0,
    blockedBuys: 0,
    priceErrors: 0,
  }
  private trades: DryRunTrade[] = []
  private log: DryRunLogEntry[] = []

  /** Start the loop. Throws if it is already running or the options are invalid. */
  start(options: DryRunOptions = {}): DryRunState {
    if (this.status === "RUNNING") throw new Error("dry-run is already running")
    this.options = resolveOptions(options)
    // Validate the breaker config up front (throws on a misconfiguration).
    this.breaker.evaluate(Date.now(), this.options.circuitBreakerConfig)

    this.tracker = new PositionTracker()
    this.breaker = new DailyLossCircuitBreaker()
    this.trades = []
    this.log = []
    for (const key of Object.keys(this.counters) as (keyof DryRunCounters)[]) this.counters[key] = 0
    this.lastPrice = null
    this.lastTickAt = null
    this.lastError = null
    this.consecutiveErrors = 0
    this.stoppedAt = null
    this.startedAt = new Date().toISOString()
    this.status = "RUNNING"

    this.attachSignal(options.signal)
    this.logLine("info", `dry-run started — ${TARGET_PAIR.label}, every ${this.options.intervalMs}ms, notional $${this.options.notionalUsd}`)
    this.schedule(0)
    return this.state()
  }

  /** Stop the loop. Safe to call when already idle. */
  stop(reason = "manual"): DryRunState {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.detachSignal()
    if (this.status === "RUNNING") {
      this.status = "STOPPED"
      this.stoppedAt = new Date().toISOString()
      this.logLine("info", `dry-run stopped (${reason}) after ${this.counters.ticks} tick(s)`)
    }
    return this.state()
  }

  /** A snapshot of the loop — counters, open position, recent log and the circuit-breaker state. */
  state(): DryRunState {
    const open = this.tracker.list()[0]
    return {
      status: this.status,
      running: this.status === "RUNNING",
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      options: this.options,
      lastPrice: this.lastPrice,
      lastTickAt: this.lastTickAt,
      openPosition: open
        ? {
            id: open.id,
            pair: open.pair,
            entryPriceUsd: open.entryPriceUsd,
            peakPriceUsd: open.peakPriceUsd,
            baseAmount: rawToAmount(open.baseAmountRaw, open.base.decimals),
            openedAt: open.openedAt,
          }
        : null,
      circuitBreaker: this.breaker.evaluate(Date.now(), this.options.circuitBreakerConfig),
      counters: { ...this.counters },
      trades: [...this.trades],
      log: [...this.log],
      lastError: this.lastError,
    }
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => void this.tick(), delay)
  }

  private async tick(): Promise<void> {
    if (this.status !== "RUNNING") return
    this.counters.ticks++

    let price: number
    try {
      const live = await getLiveMarketPrice()
      if (!(live.price > 0)) throw new Error("live price feed returned a non-positive price")
      price = live.price
      this.consecutiveErrors = 0
      this.lastError = null
    } catch (err) {
      this.counters.priceErrors++
      this.consecutiveErrors++
      this.lastError = err instanceof Error ? err.message : String(err)
      this.logLine("warn", `price feed error #${this.consecutiveErrors}: ${this.lastError}`)
      if (this.consecutiveErrors >= MAX_CONSECUTIVE_PRICE_ERRORS) {
        this.stop(`price feed unavailable (${this.consecutiveErrors} consecutive errors)`)
        return
      }
      this.schedule(this.options.intervalMs)
      return
    }

    this.lastPrice = price
    this.lastTickAt = new Date().toISOString()
    const now = Date.now()
    const cbConfig = this.options.circuitBreakerConfig

    this.breaker.evaluate(now, cbConfig)

    const evaluations = this.tracker.evaluate(price, this.options.exitConfig)
    for (const evaluation of evaluations) {
      if (!evaluation.shouldExit) continue
      const position = this.tracker.get(evaluation.id)
      if (!position) continue
      const pnlUsd = unrealizedPnlUsd(position, price)
      this.breaker.recordRealizedPnl(pnlUsd, `${position.id}:exit`, now)
      this.tracker.remove(position.id)
      this.counters.exits++
      if (evaluation.reason === "stop_loss") this.counters.stopLoss++
      else if (evaluation.reason === "take_profit") this.counters.takeProfit++
      else if (evaluation.reason === "trailing_stop") this.counters.trailingStop++
      this.trades.push({
        id: position.id,
        pair: position.pair,
        entryPriceUsd: position.entryPriceUsd,
        exitPriceUsd: price,
        exitReason: evaluation.reason,
        pnlUsd,
        pnlPct: evaluation.pnlPct,
        openedAt: position.openedAt,
        closedAt: new Date(now).toISOString(),
      })
      this.logLine("trade", `EXIT ${evaluation.reason} @ ${price4(price)} — PnL ${pnl2(pnlUsd)} (${evaluation.pnlPct.toFixed(2)}%)`)
    }

    const breaker = this.breaker.evaluate(now, cbConfig)
    if (breaker.status === "CIRCUIT_BREAKER_TRIPPED") {
      this.logLine(
        "warn",
        `CIRCUIT_BREAKER_TRIPPED — realized loss $${breaker.rollingLossUsd.toFixed(2)} ≥ limit $${breaker.thresholdUsd.toFixed(2)}; new buys blocked`,
      )
    }

    if (this.tracker.size === 0) {
      const gate = this.breaker.canOpenBuy(now, cbConfig)
      if (!gate.allowed) {
        this.counters.blockedBuys++
        this.logLine("info", `buy blocked by circuit breaker — no new entry (tick ${this.counters.ticks})`)
      } else {
        this.openPaperPosition(price, now)
      }
    }

    this.logLine("info", `tick ${this.counters.ticks} @ ${price4(price)} — open ${this.tracker.size}, exits ${this.counters.exits}`)

    if (this.options.maxTicks !== null && this.counters.ticks >= this.options.maxTicks) {
      this.status = "COMPLETED"
      this.stoppedAt = new Date().toISOString()
      this.detachSignal()
      this.logLine("info", `dry-run completed after ${this.counters.ticks} tick(s)`)
      return
    }

    this.schedule(this.options.intervalMs)
  }

  private openPaperPosition(price: number, now: number): void {
    const { base, quote } = TARGET_PAIR
    const baseAmountRaw = usdToTokenRaw(this.options.notionalUsd, price, base.decimals)
    if (baseAmountRaw <= BigInt(0)) {
      this.logLine("warn", "sized paper position rounded to zero — skipping entry")
      return
    }
    const position = createPosition({
      id: `dry-${now}-${this.counters.ticks}`,
      pair: TARGET_PAIR.label,
      base,
      quote,
      entryPriceUsd: price,
      entryNotionalUsd: this.options.notionalUsd,
      baseAmountRaw,
      openedAt: new Date(now).toISOString(),
    })
    this.tracker.track(position)
    this.counters.entries++
    this.logLine("trade", `ENTRY ${position.pair} @ ${price4(price)} — $${this.options.notionalUsd} notional`)
  }

  private logLine(level: DryRunLogEntry["level"], message: string): void {
    this.log.push({ at: new Date().toISOString(), level, message })
    if (this.log.length > this.options.maxLogEntries) {
      this.log.splice(0, this.log.length - this.options.maxLogEntries)
    }
  }

  private attachSignal(signal?: AbortSignal): void {
    if (!signal) return
    if (signal.aborted) {
      this.stop("signal already aborted")
      return
    }
    this.abortSignal = signal
    this.abortListener = () => this.stop("loop signal aborted")
    signal.addEventListener("abort", this.abortListener, { once: true })
  }

  private detachSignal(): void {
    if (this.abortSignal && this.abortListener) {
      this.abortSignal.removeEventListener("abort", this.abortListener)
    }
    this.abortSignal = null
    this.abortListener = null
  }
}

let engine: DryRunEngine | null = null

/** The process-wide dry-run engine singleton. */
export function getDryRunEngine(): DryRunEngine {
  if (!engine) engine = new DryRunEngine()
  return engine
}
