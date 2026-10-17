import type { TokenInfo } from "@/lib/market/tokens"

/* Position-sizing calculator (Fase 5.1, PRD §4.3). Turns a real portfolio (base + quote balances and
   their USD prices) into the raw input amount for one trade, capped at a 2–5% slice of equity and,
   when SOL is being spent, leaving a minimum SOL reserve untouched for rent + gas so the wallet can
   never be drained. Pure and deterministic — no network, no hidden state — so the same inputs always
   yield the same size. A size that cannot be taken is reported as `ok:false` with a reason (Rules §1). */

/** Risk per trade is bounded to 2–5% of equity (PRD §4.3). */
export const POSITION_SIZE_MIN_PCT = 2
export const POSITION_SIZE_MAX_PCT = 5

export const LAMPORTS_PER_SOL = 1_000_000_000

/** Default SOL kept back for rent + transaction/priority fees (0.05 SOL). */
export const DEFAULT_SOL_RESERVE_LAMPORTS = 50_000_000

/** Which way a trade goes, relative to the base (e.g. SOL): buy = spend quote for base, sell = the reverse. */
export type TradeSide = "buy" | "sell"

export interface RiskSizingConfig {
  /** % of equity to deploy per trade; must be within {@link POSITION_SIZE_MIN_PCT}–{@link POSITION_SIZE_MAX_PCT}. */
  positionSizePct: number
  /** SOL (lamports) kept untouched for rent/gas; never spent on a trade. */
  reserveLamports: number
}

export const DEFAULT_RISK_SIZING_CONFIG: RiskSizingConfig = {
  positionSizePct: POSITION_SIZE_MIN_PCT,
  reserveLamports: DEFAULT_SOL_RESERVE_LAMPORTS,
}

export interface TradeSizingInput {
  side: TradeSide
  /** the base asset of the pair (e.g. SOL) */
  base: TokenInfo
  /** the quote asset of the pair (e.g. USDC) */
  quote: TokenInfo
  /** the wallet's base balance in raw base units (e.g. SOL lamports) */
  baseBalanceRaw: bigint
  /** the wallet's quote balance in raw quote units (e.g. USDC base units) */
  quoteBalanceRaw: bigint
  /** base asset price in USD (e.g. SOL/USD) */
  baseUsdPrice: number
  /** quote asset price in USD; defaults to 1 (stablecoin peg) */
  quoteUsdPrice?: number
  config: RiskSizingConfig
}

export type SizingBlockedReason =
  /** not enough SOL to even pay for the trade — the reserve is the whole point */
  | "insufficient_sol_for_gas"
  /** the input asset has no spendable balance */
  | "no_balance"
  /** the computed size rounded down to zero raw units */
  | "zero_size"

/** What limited the final size. */
export type SizingLimit = "position_pct" | "balance" | "reserve" | null

export interface TradeSizing {
  ok: boolean
  reason: SizingBlockedReason | null
  side: TradeSide
  inputToken: TokenInfo
  outputToken: TokenInfo
  equityUsd: number
  positionSizePct: number
  /** equity × pct — what the percentage alone asked for */
  targetNotionalUsd: number
  /** the input amount to hand to a swap, in raw input units (0 when `!ok`) */
  inputAmountRaw: bigint
  /** actual USD value of the sized trade */
  notionalUsd: number
  /** what constrained the final size */
  limitedBy: "position_pct" | "balance" | "reserve" | null
  reserveLamports: number
  /** spendable input raw units (base balance minus the reserve, for a sell) */
  availableInputRaw: bigint
  baseUsdValue: number
  quoteUsdValue: number
}

/** Raw integer units → human amount (string math, so big balances don't lose precision). */
export function rawToAmount(raw: bigint, decimals: number): number {
  if (decimals <= 0) return Number(raw)
  const negative = raw < BigInt(0)
  const digits = (negative ? -raw : raw).toString().padStart(decimals + 1, "0")
  const whole = digits.slice(0, digits.length - decimals)
  const fraction = digits.slice(digits.length - decimals)
  return Number(`${negative ? "-" : ""}${whole}.${fraction}`)
}

/** Human amount → raw units (floored to the token's precision). */
export function amountToRaw(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return BigInt(0)
  const [whole, fraction = ""] = amount.toFixed(decimals).split(".")
  const digits = `${whole}${fraction}`.replace(/^0+/, "") || "0"
  return BigInt(digits)
}

/** USD value of a raw token balance. */
export function tokenRawToUsd(raw: bigint, decimals: number, priceUsd: number): number {
  return rawToAmount(raw, decimals) * priceUsd
}

/** Convert a USD notional into raw units of a token priced at `priceUsd`. */
export function usdToTokenRaw(usd: number, priceUsd: number, decimals: number): bigint {
  if (!(priceUsd > 0)) throw new Error("priceUsd must be positive")
  if (!Number.isFinite(usd) || usd <= 0) return BigInt(0)
  return amountToRaw(usd / priceUsd, decimals)
}

/**
 * Size one trade from a real portfolio. Returns the raw input amount to feed a quote/swap, capped at
 * the configured % of equity and never dipping into the SOL reserve. Throws for an invalid config
 * (out-of-range % or negative reserve) or a non-positive price — a misconfiguration is surfaced, not
 * silently corrected.
 */
export function calculateTradeSize(input: TradeSizingInput): TradeSizing {
  const { side, base, quote, config } = input
  const baseUsdPrice = input.baseUsdPrice
  const quoteUsdPrice = input.quoteUsdPrice ?? 1
  const pct = config.positionSizePct

  if (!Number.isFinite(pct) || pct < POSITION_SIZE_MIN_PCT || pct > POSITION_SIZE_MAX_PCT) {
    throw new Error(
      `positionSizePct must be between ${POSITION_SIZE_MIN_PCT} and ${POSITION_SIZE_MAX_PCT} (got ${pct})`,
    )
  }
  if (!Number.isFinite(config.reserveLamports) || config.reserveLamports < 0) {
    throw new Error("reserveLamports must be a non-negative number")
  }
  if (!(baseUsdPrice > 0)) throw new Error("baseUsdPrice must be positive")
  if (!(quoteUsdPrice > 0)) throw new Error("quoteUsdPrice must be positive")

  const reserveLamports = BigInt(Math.floor(config.reserveLamports))
  const baseUsdValue = tokenRawToUsd(input.baseBalanceRaw, base.decimals, baseUsdPrice)
  const quoteUsdValue = tokenRawToUsd(input.quoteBalanceRaw, quote.decimals, quoteUsdPrice)
  const equityUsd = baseUsdValue + quoteUsdValue
  const targetNotionalUsd = equityUsd * (pct / 100)

  const inputToken = side === "sell" ? base : quote
  const outputToken = side === "sell" ? quote : base
  const inputPriceUsd = side === "sell" ? baseUsdPrice : quoteUsdPrice

  const blocked = (reason: SizingBlockedReason): TradeSizing => ({
    ok: false,
    reason,
    side,
    inputToken,
    outputToken,
    equityUsd,
    positionSizePct: pct,
    targetNotionalUsd,
    inputAmountRaw: BigInt(0),
    notionalUsd: 0,
    limitedBy: null,
    reserveLamports: Number(reserveLamports),
    availableInputRaw: BigInt(0),
    baseUsdValue,
    quoteUsdValue,
  })

  // The wallet must always keep the SOL reserve to pay for rent and fees.
  if (input.baseBalanceRaw < reserveLamports) return blocked("insufficient_sol_for_gas")

  let availableInputRaw: bigint
  let reserveLimited = false
  if (side === "sell") {
    availableInputRaw = input.baseBalanceRaw - reserveLamports
    const availableUsd = tokenRawToUsd(availableInputRaw, base.decimals, baseUsdPrice)
    reserveLimited = baseUsdValue >= targetNotionalUsd && availableUsd < targetNotionalUsd
  } else {
    availableInputRaw = input.quoteBalanceRaw
  }

  if (availableInputRaw <= BigInt(0)) return blocked("no_balance")

  const availableInputUsd = tokenRawToUsd(availableInputRaw, inputToken.decimals, inputPriceUsd)
  const cappedUsd = Math.min(targetNotionalUsd, availableInputUsd)

  let inputAmountRaw = usdToTokenRaw(cappedUsd, inputPriceUsd, inputToken.decimals)
  if (inputAmountRaw > availableInputRaw) inputAmountRaw = availableInputRaw
  if (inputAmountRaw <= BigInt(0)) return blocked("zero_size")

  const notionalUsd = tokenRawToUsd(inputAmountRaw, inputToken.decimals, inputPriceUsd)
  const limitedBy =
    targetNotionalUsd <= availableInputUsd ? "position_pct" : reserveLimited ? "reserve" : "balance"

  return {
    ok: true,
    reason: null,
    side,
    inputToken,
    outputToken,
    equityUsd,
    positionSizePct: pct,
    targetNotionalUsd,
    inputAmountRaw,
    notionalUsd,
    limitedBy,
    reserveLamports: Number(reserveLamports),
    availableInputRaw,
    baseUsdValue,
    quoteUsdValue,
  }
}
