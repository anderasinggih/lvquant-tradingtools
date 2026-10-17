import fs from "node:fs"
import path from "node:path"

import { getDryRunEngine } from "@/lib/bot/dry-run"
import { messageOf } from "@/lib/solana/errors"
import { DailyLossCircuitBreaker } from "@/lib/risk/circuit-breaker"
import {
  PositionTracker,
  liquidatePosition,
  type ExitExecutionOptions,
  type LiquidationResult,
} from "@/lib/risk/monitor"
import type { Position } from "@/lib/risk/positions"
import { rawToAmount } from "@/lib/risk/sizing"

/* Emergency control (Fase 5.4, PRD §4.3): the single source of truth for the bot's run state and its
   open positions. Holds the shared {@link PositionTracker} and {@link DailyLossCircuitBreaker} the
   engine (Fase 6) will drive, exposes Pause / Resume, and offers PANIC SELL — cancel the trading loop
   (abort the loop signal) and liquidate every open position back into the quote (SOL/USDC) through
   the real Jupiter execution path. Every liquidation is reported with its on-chain Solscan receipt;
   a failure is surfaced, never hidden (Rules §1 / §2). */

export type BotStatus = "RUNNING" | "PAUSED"

/** Wider-than-normal slippage for a panic exit (2%) so the liquidation actually lands. */
export const DEFAULT_PANIC_SLIPPAGE_BPS = 200

/** Quant bot strategy & risk configuration parameters. */
export interface QuantBotConfig {
  strategy: "EMA Trend" | "Mean Reversion" | "Breakout"
  venue: "Jupiter Spot" | "Drift Perp"
  leverage: number
  sizePct: number
  stopLossPct: number
  takeProfitPct: number
  trailingStopEnabled: boolean
  trailingArmPct: number
  trailingOffsetPct: number
  slippageBps: number
  dailyLossLimitUsd: number
  mode: "Dry-Run" | "Live Mainnet"
  updatedAt: string
}

export const DEFAULT_BOT_CONFIG: QuantBotConfig = {
  strategy: "EMA Trend",
  venue: "Jupiter Spot",
  leverage: 1,
  sizePct: 5,
  stopLossPct: 2.5,
  takeProfitPct: 6.0,
  trailingStopEnabled: true,
  trailingArmPct: 2.0,
  trailingOffsetPct: 1.0,
  slippageBps: 100,
  dailyLossLimitUsd: 100,
  mode: "Dry-Run",
  updatedAt: new Date().toISOString(),
}

const CONFIG_FILE_PATH = path.join(process.cwd(), "data", "bot-config.json")

function loadPersistedConfig(): QuantBotConfig {
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const raw = fs.readFileSync(CONFIG_FILE_PATH, "utf-8")
      const parsed = JSON.parse(raw) as Partial<QuantBotConfig>
      return {
        ...DEFAULT_BOT_CONFIG,
        ...parsed,
      }
    }
  } catch {
    // fallback to default
  }
  return { ...DEFAULT_BOT_CONFIG }
}

function savePersistedConfig(config: QuantBotConfig): void {
  try {
    const dir = path.dirname(CONFIG_FILE_PATH)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), "utf-8")
  } catch (err) {
    console.error("Failed to persist bot config to disk:", err)
  }
}

/** A JSON-safe snapshot of the bot's run state. */
export interface BotState {
  status: BotStatus
  /** true while a trading loop should run (status RUNNING) */
  running: boolean
  openPositions: number
  config: QuantBotConfig
  /** why the bot was last paused ("manual" | "panic_sell" | "not started" | …) */
  lastPauseReason: string | null
  /** ISO timestamp of the last panic sell, or null */
  lastPanicAt: string | null
  updatedAt: string
}

/** A JSON-safe view of one open position. */
export interface PositionView {
  id: string
  pair: string
  baseSymbol: string
  quoteSymbol: string
  /** base amount in raw units (string — bigint is not JSON-serialisable) */
  baseAmountRaw: string
  /** human base amount */
  baseAmount: number
  entryPriceUsd: number
  entryNotionalUsd: number
  peakPriceUsd: number
  openedAt: string
}

/** A JSON-safe view of one liquidation (panic-sell result) with its Solscan receipt. */
export interface LiquidationView {
  positionId: string
  pair: string
  baseSymbol: string
  quoteSymbol: string
  closedBaseAmountRaw: string
  closedBaseAmount: number
  proceedsRaw: string
  proceedsUsd: number
  costBasisUsd: number
  realizedPnlUsd: number
  realizedPnlPct: number
  signature: string
  slot: number | null
  explorerUrl: string
  priceImpactPct: number
}

export interface PanicSellFailure {
  positionId: string
  pair: string
  error: string
}

export interface PanicSellReport {
  attempted: number
  closed: LiquidationView[]
  failures: PanicSellFailure[]
  startedAt: string
  finishedAt: string
}

function toPositionView(position: Position): PositionView {
  return {
    id: position.id,
    pair: position.pair,
    baseSymbol: position.base.symbol,
    quoteSymbol: position.quote.symbol,
    baseAmountRaw: position.baseAmountRaw.toString(),
    baseAmount: rawToAmount(position.baseAmountRaw, position.base.decimals),
    entryPriceUsd: position.entryPriceUsd,
    entryNotionalUsd: position.entryNotionalUsd,
    peakPriceUsd: position.peakPriceUsd,
    openedAt: position.openedAt,
  }
}

function toLiquidationView(result: LiquidationResult): LiquidationView {
  return {
    positionId: result.position.id,
    pair: result.position.pair,
    baseSymbol: result.position.base.symbol,
    quoteSymbol: result.position.quote.symbol,
    closedBaseAmountRaw: result.closedBaseAmountRaw.toString(),
    closedBaseAmount: rawToAmount(result.closedBaseAmountRaw, result.position.base.decimals),
    proceedsRaw: result.proceedsRaw.toString(),
    proceedsUsd: result.proceedsUsd,
    costBasisUsd: result.costBasisUsd,
    realizedPnlUsd: result.realizedPnlUsd,
    realizedPnlPct: result.realizedPnlPct,
    signature: result.execution.signature,
    slot: result.execution.slot,
    explorerUrl: result.execution.explorerUrl,
    priceImpactPct: result.quote.priceImpactPct,
  }
}

/**
 * The bot's run-state holder. A trading loop should run only while `!paused` and must stop as soon as
 * `signal` aborts (pause or panic). The tracker and breaker are shared with the engine so a panic
 * sell liquidates exactly the positions the engine opened.
 */
export class BotController {
  readonly tracker = new PositionTracker()
  readonly breaker = new DailyLossCircuitBreaker()

  private botStatus: BotStatus = "PAUSED"
  private lastPauseReason: string | null = "not started"
  private lastPanicAt: string | null = null
  private loopAbort = new AbortController()
  private botConfig: QuantBotConfig = loadPersistedConfig()

  constructor() {
    this.loopAbort.abort()
  }

  getConfig(): QuantBotConfig {
    return { ...this.botConfig }
  }

  updateConfig(patch: Partial<QuantBotConfig>): QuantBotConfig {
    this.botConfig = {
      ...this.botConfig,
      ...patch,
      updatedAt: new Date().toISOString(),
    }
    savePersistedConfig(this.botConfig)

    // If currently running in dry-run mode, hot-reload the running engine with the new parameters
    if (this.botStatus === "RUNNING" && this.botConfig.mode === "Dry-Run") {
      try {
        const engine = getDryRunEngine()
        if (engine.state().status === "RUNNING") {
          engine.stop("config_reload")
          engine.start({
            intervalMs: 5000,
            notionalUsd: Math.max(10, Math.round(this.botConfig.sizePct * 5)),
            exitConfig: {
              stopLossPct: this.botConfig.stopLossPct,
              takeProfitPct: this.botConfig.takeProfitPct,
              trailingStartPct: this.botConfig.trailingStopEnabled ? this.botConfig.trailingArmPct : undefined,
              trailingStopPct: this.botConfig.trailingStopEnabled ? this.botConfig.trailingOffsetPct : undefined,
            },
            circuitBreakerConfig: {
              maxLossUsd: this.botConfig.dailyLossLimitUsd,
            },
            signal: this.loopAbort.signal,
          })
        }
      } catch (err) {
        console.error("Failed to hot-reload dry-run engine config:", err)
      }
    }

    return this.getConfig()
  }

  /** Aborts as soon as the bot is paused or a panic sell begins — the loop must observe it. */
  get signal(): AbortSignal {
    return this.loopAbort.signal
  }

  get status(): BotStatus {
    return this.botStatus
  }

  get paused(): boolean {
    return this.botStatus === "PAUSED"
  }

  state(): BotState {
    return {
      status: this.botStatus,
      running: this.botStatus === "RUNNING",
      openPositions: this.tracker.size,
      config: this.getConfig(),
      lastPauseReason: this.lastPauseReason,
      lastPanicAt: this.lastPanicAt,
      updatedAt: new Date().toISOString(),
    }
  }

  /** Track a new open position (delegates to the shared tracker). */
  addPosition(position: Position): Position {
    return this.tracker.track(position)
  }

  /** Snapshot of the open positions, JSON-safe. */
  listPositions(): PositionView[] {
    return this.tracker.list().map(toPositionView)
  }

  /** Pause the bot (aborting any running loop). Idempotent. */
  pause(reason = "manual"): BotState {
    if (this.botStatus === "RUNNING") this.loopAbort.abort()
    this.botStatus = "PAUSED"
    this.lastPauseReason = reason
    try {
      const engine = getDryRunEngine()
      if (engine.state().status === "RUNNING") {
        engine.stop(reason)
      }
    } catch {
      // ignore
    }
    return this.state()
  }

  /** Resume the bot with a fresh loop signal. */
  resume(): BotState {
    if (this.botStatus === "PAUSED") this.loopAbort = new AbortController()
    this.botStatus = "RUNNING"
    this.lastPauseReason = null

    if (this.botConfig.mode === "Dry-Run") {
      try {
        const engine = getDryRunEngine()
        if (engine.state().status !== "RUNNING") {
          engine.start({
            intervalMs: 5000,
            notionalUsd: Math.max(10, Math.round(this.botConfig.sizePct * 5)),
            exitConfig: {
              stopLossPct: this.botConfig.stopLossPct,
              takeProfitPct: this.botConfig.takeProfitPct,
              trailingStartPct: this.botConfig.trailingStopEnabled ? this.botConfig.trailingArmPct : undefined,
              trailingStopPct: this.botConfig.trailingStopEnabled ? this.botConfig.trailingOffsetPct : undefined,
            },
            circuitBreakerConfig: {
              maxLossUsd: this.botConfig.dailyLossLimitUsd,
            },
            signal: this.loopAbort.signal,
          })
        }
      } catch (err) {
        console.error("Failed to start dry-run loop:", err)
      }
    }

    return this.state()
  }

  /**
   * PANIC SELL: cancel the trading loop and liquidate every open position into the quote asset via
   * Jupiter. Liquidations run one at a time (so they don't fight over the blockhash), each confirmed
   * on-chain before the next. A failed liquidation is reported in `failures` and its position is kept
   * tracked; the others still proceed. Returns the report with Solscan receipts.
   */
  async panicSell(options: ExitExecutionOptions = {}): Promise<PanicSellReport> {
    const startedAt = new Date().toISOString()
    this.pause("panic_sell")
    this.lastPanicAt = startedAt

    const positions = this.tracker.list()
    const closed: LiquidationView[] = []
    const failures: PanicSellFailure[] = []

    for (const position of positions) {
      if (this.tracker.get(position.id) === undefined) continue
      try {
        const result = await liquidatePosition(position, {
          signer: options.signer,
          slippageBps: options.slippageBps ?? DEFAULT_PANIC_SLIPPAGE_BPS,
          quoteUsdPrice: options.quoteUsdPrice,
          skipPriorityFee: options.skipPriorityFee,
        })
        this.tracker.remove(position.id)
        closed.push(toLiquidationView(result))
      } catch (error) {
        failures.push({ positionId: position.id, pair: position.pair, error: messageOf(error) })
      }
    }

    return { attempted: positions.length, closed, failures, startedAt, finishedAt: new Date().toISOString() }
  }
}

let controller: BotController | null = null

/** The process-wide bot controller singleton (shared across API routes). */
export function getBotController(): BotController {
  if (!controller) controller = new BotController()
  return controller
}
