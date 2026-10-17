import type { Keypair } from "@solana/web3.js"

import { executeSwap, type SwapExecutionResult } from "@/lib/jupiter/execute"
import { getQuote } from "@/lib/jupiter/quote"
import type { JupiterQuote } from "@/lib/jupiter/types"
import type { TokenInfo } from "@/lib/market/tokens"

import {
  evaluateExit,
  validateExitConfig,
  type ExitReason,
  type Position,
  type PositionEvaluation,
  type PositionExitConfig,
} from "./positions"
import { rawToAmount } from "./sizing"

/* Position monitor + exit executor (Fase 5.2, PRD §4.3). The {@link PositionTracker} holds every open
   long position and decides, on each loop tick, whether to close it back into the quote asset: the
   hard stop-loss caps a loss, the take-profit books a gain, and an optional trailing stop locks in a
   run once armed (logic lives in `evaluateExit`). When a rule fires, the monitor swaps the base back
   through the same Jupiter quote → build → sign → submit pipeline as any other trade — a real exit is
   only reported once the rule actually trips and the swap path is invoked (Rules §1). */

/** Default slippage tolerance for the exit swap back into the quote asset (1%). */
export const DEFAULT_EXIT_SLIPPAGE_BPS = 100

/** Quote assets (stablecoins) are valued at $1 unless the caller supplies a live price. */
export const DEFAULT_QUOTE_USD_PRICE = 1

/** Scale used to derive a bigint-safe fraction without losing precision on large token amounts. */
const RATIO_SCALE = BigInt(1_000_000_000)

export interface CreatePositionInput {
  /** unique id for the position (one per trade) */
  id: string
  /** display pair label, e.g. "SOL/USDC" */
  pair: string
  base: TokenInfo
  quote: TokenInfo
  /** fill price in USD per 1 base unit at entry */
  entryPriceUsd: number
  /** USD notional deployed at entry (cost basis) */
  entryNotionalUsd: number
  /** base amount held, in raw base units (lamports for SOL) */
  baseAmountRaw: bigint
  /** ISO timestamp; defaults to now */
  openedAt?: string
  /** initial peak price (defaults to the entry price); mainly useful when restoring a position */
  peakPriceUsd?: number
}

/**
 * Build a validated open position, seeding the trailing-stop high-water mark with the entry price (or
 * an explicit `peakPriceUsd`). Throws on malformed input rather than silently coercing it.
 */
export function createPosition(input: CreatePositionInput): Position {
  if (!input.id?.trim()) throw new Error("position id is required")
  if (!input.pair?.trim()) throw new Error("position pair is required")
  if (!(input.entryPriceUsd > 0)) throw new Error("entryPriceUsd must be positive")
  if (!(input.entryNotionalUsd > 0)) throw new Error("entryNotionalUsd must be positive")
  if (input.baseAmountRaw <= BigInt(0)) throw new Error("baseAmountRaw must be positive")
  const peakPriceUsd = input.peakPriceUsd ?? input.entryPriceUsd
  if (!(peakPriceUsd > 0)) throw new Error("peakPriceUsd must be positive")
  return {
    id: input.id,
    pair: input.pair,
    base: input.base,
    quote: input.quote,
    baseAmountRaw: input.baseAmountRaw,
    entryPriceUsd: input.entryPriceUsd,
    entryNotionalUsd: input.entryNotionalUsd,
    peakPriceUsd,
    openedAt: input.openedAt ?? new Date().toISOString(),
  }
}

/** A bigint-safe ratio `numerator / denominator` as a JS number (never overflows on large amounts). */
function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= BigInt(0)) throw new Error("denominator must be positive")
  return Number((numerator * RATIO_SCALE) / denominator) / Number(RATIO_SCALE)
}

/**
 * In-memory registry of the open positions for one engine instance. Marking to market advances each
 * position's peak (so the trailing stop keeps its high-water mark) and yields the evaluations that
 * drive the exits.
 */
export class PositionTracker {
  private readonly positions = new Map<string, Position>()

  constructor(initial?: Iterable<Position>) {
    for (const position of initial ?? []) this.track(position)
  }

  /** Begin tracking a position; throws if the id is already tracked. */
  track(position: Position): Position {
    if (this.positions.has(position.id)) {
      throw new Error(`position ${position.id} is already tracked`)
    }
    this.positions.set(position.id, position)
    return position
  }

  list(): Position[] {
    return [...this.positions.values()]
  }

  get(id: string): Position | undefined {
    return this.positions.get(id)
  }

  has(id: string): boolean {
    return this.positions.has(id)
  }

  remove(id: string): Position | undefined {
    const position = this.positions.get(id)
    this.positions.delete(id)
    return position
  }

  get size(): number {
    return this.positions.size
  }

  /**
   * Mark every position to `currentPriceUsd`, persisting each advanced peak, and return one
   * evaluation per position (in insertion order).
   */
  evaluate(currentPriceUsd: number, config: PositionExitConfig): PositionEvaluation[] {
    validateExitConfig(config)
    const evaluations: PositionEvaluation[] = []
    for (const position of this.positions.values()) {
      const evaluation = evaluateExit(position, currentPriceUsd, config)
      if (evaluation.peakPriceUsd > position.peakPriceUsd) {
        this.positions.set(position.id, { ...position, peakPriceUsd: evaluation.peakPriceUsd })
      }
      evaluations.push(evaluation)
    }
    return evaluations
  }

  /** Only the evaluations whose exit rule fired (`shouldExit === true`). */
  signals(currentPriceUsd: number, config: PositionExitConfig): PositionEvaluation[] {
    return this.evaluate(currentPriceUsd, config).filter((evaluation) => evaluation.shouldExit)
  }
}

export interface ExitExecutionOptions {
  /** signer for the swap-back; defaults to the bot wallet from `SOLANA_PRIVATE_KEY`. */
  signer?: Keypair
  /** slippage tolerance for the exit swap, in bps. Default {@link DEFAULT_EXIT_SLIPPAGE_BPS}. */
  slippageBps?: number
  /** live USD price of the quote asset; defaults to {@link DEFAULT_QUOTE_USD_PRICE}. */
  quoteUsdPrice?: number
  /** submit without a dynamic priority fee (quote's default compute budget only). */
  skipPriorityFee?: boolean
}

export interface ClosePositionOptions extends ExitExecutionOptions {
  config: PositionExitConfig
  /** swap back only this many base units (defaults to the whole position). */
  baseAmountRaw?: bigint
}

export interface ClosePositionResult {
  position: Position
  /** the evaluation that justified the exit (reason, PnL at the moment of closing) */
  evaluation: PositionEvaluation
  /** which rule fired */
  exitReason: ExitReason
  /** the quote used for the swap-back (base → quote) */
  quote: JupiterQuote
  /** the on-chain execution result (signature, slot, Solscan receipt) */
  execution: SwapExecutionResult
  /** base units actually swapped back */
  closedBaseAmountRaw: bigint
  /** raw quote units received, as quoted by the exit swap */
  proceedsRaw: bigint
  /** proceeds valued in USD (quote price × amount) */
  proceedsUsd: number
  /** the proportional cost basis of the closed slice */
  costBasisUsd: number
  /** realized PnL vs cost basis, in USD */
  realizedPnlUsd: number
  /** realized PnL as a percentage of the cost basis */
  realizedPnlPct: number
}

/**
 * Close a position: re-evaluate it against `currentPriceUsd`, quote the base → quote swap, and execute
 * it via {@link executeSwap}. Returns the evaluation and the realized PnL. A thrown error (bad quote,
 * rejected swap) propagates so the caller can keep the position tracked and retry on the next tick.
 */
export async function closePosition(
  position: Position,
  currentPriceUsd: number,
  options: ClosePositionOptions,
): Promise<ClosePositionResult> {
  const evaluation = evaluateExit(position, currentPriceUsd, options.config)

  const closedBaseAmountRaw = options.baseAmountRaw ?? position.baseAmountRaw
  if (closedBaseAmountRaw <= BigInt(0)) {
    throw new Error("baseAmountRaw to close must be positive")
  }
  if (closedBaseAmountRaw > position.baseAmountRaw) {
    throw new Error("baseAmountRaw to close exceeds the position size")
  }

  const slippageBps = options.slippageBps ?? DEFAULT_EXIT_SLIPPAGE_BPS
  const quote = await getQuote(
    position.base.mint,
    position.quote.mint,
    closedBaseAmountRaw,
    slippageBps,
  )

  const execution = await executeSwap({
    quote,
    signer: options.signer,
    skipPriorityFee: options.skipPriorityFee,
    swapOptions: { wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true },
  })

  const proceedsRaw = BigInt(quote.outAmount)
  const quoteUsdPrice = options.quoteUsdPrice ?? DEFAULT_QUOTE_USD_PRICE
  const proceedsUsd = rawToAmount(proceedsRaw, position.quote.decimals) * quoteUsdPrice
  const costBasisUsd = position.entryNotionalUsd * ratio(closedBaseAmountRaw, position.baseAmountRaw)
  const realizedPnlUsd = proceedsUsd - costBasisUsd
  const realizedPnlPct = costBasisUsd > 0 ? (realizedPnlUsd / costBasisUsd) * 100 : 0

  return {
    position,
    evaluation,
    exitReason: evaluation.reason,
    quote,
    execution,
    closedBaseAmountRaw,
    proceedsRaw,
    proceedsUsd,
    costBasisUsd,
    realizedPnlUsd,
    realizedPnlPct,
  }
}

/**
 * Mark every tracked position to `currentPriceUsd` and close the ones whose exit rule fired, removing
 * each from the tracker as it resolves. Returns one result per executed exit (empty when nothing
 * tripped). If a swap-back throws, the position is left tracked and the error propagates — nothing is
 * removed or reported as closed without a real, confirmed execution (Rules §1 / §2).
 */
export async function executeExits(
  tracker: PositionTracker,
  currentPriceUsd: number,
  config: PositionExitConfig,
  options: ExitExecutionOptions = {},
): Promise<ClosePositionResult[]> {
  const signals = tracker.signals(currentPriceUsd, config)
  const results: ClosePositionResult[] = []
  for (const signal of signals) {
    const position = tracker.get(signal.id)
    if (!position) continue
    const result = await closePosition(position, currentPriceUsd, { config, ...options })
    tracker.remove(position.id)
    results.push(result)
  }
  return results
}
