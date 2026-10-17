import type { PublicKey } from "@solana/web3.js"

import { getConnection, getRpcProvider } from "./connection"
import { withRpcRetry } from "./retry"

/* Dynamic priority-fee estimator (Fase 4.3). It samples the micro-tip (micro-lamports per compute
   unit) that recently landed transactions actually paid (`getRecentPrioritizationFees`), picks a
   percentile of that distribution and converts it into a total tip in lamports for a given compute
   budget. Nothing is invented: every bid comes from lands observed on-chain, and the result is
   clamped to an explicit cap so a fee spike can never drain the wallet (Rules §1 / §2). */

export const DEFAULT_PRIORITY_FEE_PERCENTILE = 75
export const DEFAULT_COMPUTE_UNIT_LIMIT = 200_000
export const DEFAULT_MAX_PRIORITY_FEE_LAMPORTS = 100_000

/** Distribution of the unit prices (micro-lamports per CU) recently paid on-chain. */
export interface PriorityFeeSamples {
  /** how many slots returned a landed fee (the node caps this at the last ~150 slots) */
  count: number
  min: number
  p50: number
  p75: number
  p90: number
  max: number
  /** the unit price at the percentile actually picked for the bid */
  unitPriceMicroLamports: number
}

export interface EstimatePriorityFeeOptions {
  /** Writable accounts the transaction will lock — the node then reports the fee needed to land it. */
  lockedWritableAccounts?: PublicKey[]
  /** Percentile of the recent fee distribution to bid (0–100). Defaults to `PRIORITY_FEE_PERCENTILE` / 75. */
  percentile?: number
  /** Compute-unit limit the price is multiplied by. Defaults to 200_000. */
  computeUnitLimit?: number
  /** Hard cap on the total tip in lamports. Defaults to `MAX_PRIORITY_FEE_LAMPORTS` / 100_000. */
  maxLamports?: number
  /** Minimum tip in lamports (a floor so a quiet network still gets a micro-tip). Default 0. */
  minLamports?: number
}

export interface EstimatedPriorityFee {
  /** micro-lamports per compute unit the engine will bid */
  unitPriceMicroLamports: number
  computeUnitLimit: number
  /** total priority fee to embed: ceil(unitPrice × computeUnitLimit / 1e6), clamped to [min,max] */
  lamports: number
  /** true when the computed tip was pushed to `minLamports` or `maxLamports` */
  clamped: boolean
  samples: PriorityFeeSamples
  provider: string
}

/** Read an optional non-negative integer env var, or throw when it is present but malformed. */
function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer (got "${raw}")`)
  }
  return Math.floor(value)
}

/** Nearest-rank percentile of an ascending-sorted array (0 for an empty sample). */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.ceil((p / 100) * sorted.length)
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1))
  return sorted[index]
}

/** Convert a per-compute-unit price (micro-lamports) into a total tip in lamports. */
export function unitPriceToLamports(unitPriceMicroLamports: number, computeUnitLimit: number): number {
  return Math.ceil((unitPriceMicroLamports * computeUnitLimit) / 1_000_000)
}

/**
 * Estimate a dynamic priority fee from the live cluster: sample recent landed fees, pick the chosen
 * percentile as the unit price, and convert it to lamports for `computeUnitLimit`, clamped to the
 * configured bound. Transient RPC failures retry; a persistent failure throws `RpcRequestError`.
 */
export async function estimatePriorityFee(
  options: EstimatePriorityFeeOptions = {},
): Promise<EstimatedPriorityFee> {
  const percentileValue = options.percentile ?? readEnvInt("PRIORITY_FEE_PERCENTILE", 75)
  if (!Number.isFinite(percentileValue) || percentileValue < 0 || percentileValue > 100) {
    throw new Error("percentile must be between 0 and 100")
  }
  const computeUnitLimit = options.computeUnitLimit ?? 200_000
  if (!Number.isInteger(computeUnitLimit) || computeUnitLimit <= 0) {
    throw new Error("computeUnitLimit must be a positive integer")
  }
  const maxLamports = options.maxLamports ?? readEnvInt("MAX_PRIORITY_FEE_LAMPORTS", 100_000)
  const minLamports = options.minLamports ?? 0
  if (minLamports > maxLamports) {
    throw new Error("minLamports cannot exceed maxLamports")
  }

  const connection = getConnection()
  const provider = getRpcProvider().name

  const fees = await withRpcRetry(
    () =>
      connection.getRecentPrioritizationFees(
        options.lockedWritableAccounts?.length
          ? { lockedWritableAccounts: options.lockedWritableAccounts }
          : undefined,
      ),
    { operation: "getRecentPrioritizationFees", provider },
  )

  const raw = fees
    .map((entry) => entry.prioritizationFee)
    .filter((value) => Number.isFinite(value) && value >= 0)
  const sorted = [...raw].sort((a, b) => a - b)

  const unitPriceMicroLamports = percentile(sorted, percentileValue)
  const samples: PriorityFeeSamples = {
    count: sorted.length,
    min: percentile(sorted, 0),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    max: sorted.length ? sorted[sorted.length - 1] : 0,
    unitPriceMicroLamports,
  }

  const computed = unitPriceToLamports(unitPriceMicroLamports, computeUnitLimit)
  const lamports = Math.min(Math.max(computed, minLamports), maxLamports)

  return {
    unitPriceMicroLamports,
    computeUnitLimit,
    lamports,
    clamped: lamports !== computed,
    samples,
    provider,
  }
}
