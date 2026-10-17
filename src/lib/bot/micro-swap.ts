import { type Keypair } from "@solana/web3.js"

import { writableAccountsForQuote } from "@/lib/jupiter/execute"
import { getQuote } from "@/lib/jupiter/quote"
import { buildSignedSwapTransaction } from "@/lib/jupiter/swap"
import { TOKENS } from "@/lib/market/tokens"
import { amountToRaw } from "@/lib/risk/sizing"
import { detectCluster } from "@/lib/solana/explorer"
import { getRpcProvider } from "@/lib/solana/connection"
import { messageOf } from "@/lib/solana/errors"
import { estimatePriorityFee, type EstimatedPriorityFee } from "@/lib/solana/priority-fee"
import {
  submitSignedTransaction,
  TransactionSubmitError,
} from "@/lib/solana/submit"
import {
  getSolBalance,
  getSplTokenBalance,
  getWalletPublicKey,
  loadKeypair,
} from "@/lib/solana/wallet"

/* Micro test-swap (Fase 6.2, PRD §5): execute exactly ONE tiny real swap (default 0.005 SOL → USDC)
   with defence-in-depth guards so a careless run can never drain the wallet. Sequence:
     validate → read balances → quote (live Jupiter) → guard price impact → estimate priority fee →
     guard balance (amount + base fee + ATA rent + tip + operator reserve) → build & sign locally →
     submit & wait `confirmed` → re-read balances.
   No mock and no fallback anywhere (Rules §1): a missing env, a bad quote, an unaffordable fee or a
   rejected transaction is a thrown error with the exact reason and the on-chain receipt if it exists
   (Rules §2). The private key stays in-process; only the local signature is produced. */

/** The default micro amount: 0.005 SOL (PRD §5). */
export const MICRO_SWAP_LAMPORTS = 5_000_000
/** Hard ceiling on a "micro" swap so this path can never send a large amount (0.01 SOL). */
export const MAX_MICRO_SWAP_LAMPORTS = 10_000_000
/** A signature (base fee) costs 5000 lamports; the tip is added on top of this. */
export const BASE_TX_FEE_LAMPORTS = 5_000
/** Rent-exempt minimum for a token account (~0.00203928 SOL) — charged only when the output ATA is created. */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280
const DEFAULT_SLIPPAGE_BPS = 100
const MAX_SLIPPAGE_BPS = 1_000
const DEFAULT_MAX_PRICE_IMPACT_PERCENT = 1
const DEFAULT_MAX_PRIORITY_LAMPORTS = 100_000

export type MicroSwapStage = "validate" | "quote" | "guard" | "build" | "submit"

/** A micro swap could not proceed/finish. Carries a stable code, the stage, and any on-chain evidence. */
export class MicroSwapError extends Error {
  readonly code: string
  readonly stage: MicroSwapStage
  readonly httpStatus: number
  readonly signature: string | null
  readonly explorerUrl: string | null
  readonly balanceBefore: MicroSwapBalances | null
  readonly balanceAfter: MicroSwapBalances | null
  constructor(params: {
    code: string
    stage: MicroSwapStage
    message: string
    httpStatus?: number
    signature?: string | null
    explorerUrl?: string | null
    balanceBefore?: MicroSwapBalances | null
    balanceAfter?: MicroSwapBalances | null
  }) {
    super(params.message)
    this.name = "MicroSwapError"
    this.code = params.code
    this.stage = params.stage
    this.httpStatus =
      params.httpStatus ??
      (params.stage === "validate" ? 400 : params.stage === "guard" ? 422 : 502)
    this.signature = params.signature ?? null
    this.explorerUrl = params.explorerUrl ?? null
    this.balanceBefore = params.balanceBefore ?? null
    this.balanceAfter = params.balanceAfter ?? null
  }
}

export interface MicroSwapBalances {
  sol: number
  solLamports: number
  usdc: number
  /** raw USDC units as a string (bigint-safe for JSON) */
  usdcRaw: string
}

export interface MicroSwapOptions {
  /** SOL amount to swap in. Default 0.005; capped at {@link MAX_MICRO_SWAP_LAMPORTS}. */
  amountSol?: number
  /** Slippage tolerance in basis points. Default 100 (1%), max 1000 (10%). */
  slippageBps?: number
  /** Hard cap on the priority tip in lamports. Default 100 000. */
  maxPriorityLamports?: number
  /** SOL lamports that must remain AFTER the swap (operator safety reserve). Default 0. */
  reserveLamports?: number
  /** Block the swap when |price impact| exceeds this percentage. Default 1. */
  maxPriceImpactPercent?: number
}

export interface MicroSwapBalancesView {
  sol: number
  solLamports: number
  usdc: number
  usdcRaw: string
}

export interface MicroSwapResult {
  ok: true
  timestamp: string
  durationMs: number
  wallet: string
  cluster: string
  provider: string
  input: { symbol: string; mint: string; decimals: number; amount: number; amountRaw: string }
  output: { symbol: string; mint: string; decimals: number; amount: number; amountRaw: string }
  quote: {
    inAmount: string
    outAmount: string
    otherAmountThreshold: string
    slippageBps: number
    priceImpactPercent: number
    swapUsdValue: number | null
    hops: number
    labels: string[]
    bestRoute: boolean
    contextSlot: number
    timeTaken: number
  }
  priorityFee: {
    unitPriceMicroLamports: number
    computeUnitLimit: number
    lamports: number
    clamped: boolean
    provider: string
    samples: EstimatedPriorityFee["samples"]
  } | null
  guards: {
    balanceBeforeLamports: number
    requiredLamports: number
    reserveLamports: number
    tipIncludedLamports: number
    ataRentIncludedLamports: number
    headroomLamports: number
  }
  balanceBefore: MicroSwapBalances
  balanceAfter: MicroSwapBalances
  delta: { sol: number; solLamports: number; usdc: number; usdcRaw: string }
  transaction: {
    feePayer: string
    signature: string
    explorerUrl: string
    slot: number | null
    confirmationStatus: "confirmed" | "finalized"
    signedBytes: number
    signedBase64: string
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function readBalances(): Promise<MicroSwapBalances> {
  const [sol, usdc] = await Promise.all([
    getSolBalance(),
    getSplTokenBalance(TOKENS.USDC.mint),
  ])
  return {
    sol: sol.sol,
    solLamports: sol.lamports,
    usdc: usdc.amount,
    usdcRaw: usdc.amountRaw.toString(),
  }
}

/** Re-read until the USDC balance moves (so "after" reflects the confirmed swap), or give up. */
async function readBalancesSettled(previousUsdcRaw: string): Promise<MicroSwapBalances> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const balances = await readBalances()
    if (balances.usdcRaw !== previousUsdcRaw) return balances
    await sleep(1_000)
  }
  return readBalances()
}

export interface MicroSwapPreflight {
  ok: boolean
  configured: boolean
  ready: boolean
  wallet: string | null
  cluster: string
  provider: string | null
  balances: MicroSwapBalances | null
  ataExists: boolean | null
  requiredLamports: number
  reserveLamports: number
  reason: string | null
}

/** Read-only readiness check (wallet configured, RPC reachable, balances readable, enough SOL). */
export async function microSwapPreflight(reserveLamports = 0): Promise<MicroSwapPreflight> {
  const cluster = detectCluster()
  const base: MicroSwapPreflight = {
    ok: false,
    ready: false,
    configured: false,
    wallet: null,
    cluster,
    provider: null,
    balances: null,
    ataExists: null,
    requiredLamports: 0,
    reserveLamports,
    reason: null,
  }

  if (!process.env.SOLANA_RPC_URL?.trim() || !process.env.SOLANA_PRIVATE_KEY?.trim()) {
    return { ...base, reason: "Set SOLANA_RPC_URL and SOLANA_PRIVATE_KEY in .env, then restart the server." }
  }

  try {
    const provider = getRpcProvider().name
    const wallet = getWalletPublicKey().toBase58()
    const [balances, usdc] = await Promise.all([
      readBalances(),
      getSplTokenBalance(TOKENS.USDC.mint),
    ])
    const ataExists = usdc.tokenAccount !== ""
    const required =
      MICRO_SWAP_LAMPORTS +
      BASE_TX_FEE_LAMPORTS +
      (ataExists ? 0 : TOKEN_ACCOUNT_RENT_LAMPORTS) +
      reserveLamports
    const ready = balances.solLamports >= required
    return {
      ...base,
      ok: true,
      ready,
      configured: true,
      wallet,
      provider,
      balances,
      ataExists,
      requiredLamports: required,
      reason: ready
        ? null
        : `Wallet needs ≥ ${required} lamports (${(required / 1e9).toFixed(6)} SOL) to fund 0.005 SOL + fees + rent + reserve; has ${balances.solLamports}.`,
    }
  } catch (err) {
    return { ...base, configured: true, reason: messageOf(err) }
  }
}

export interface RunMicroSwapOptions extends MicroSwapOptions {
  /** Optional pre-loaded signer (defaults to the bot wallet from SOLANA_PRIVATE_KEY). */
  signer?: Keypair
}

function validateOptions(options: RunMicroSwapOptions): {
  amountLamports: number
  slippageBps: number
  maxPriorityLamports: number
  reserveLamports: number
  maxPriceImpactPercent: number
} {
  const amountSol = options.amountSol ?? MICRO_SWAP_LAMPORTS / 1e9
  const amountLamports = Number(amountToRaw(amountSol, TOKENS.SOL.decimals))
  if (!Number.isFinite(amountLamports) || amountLamports <= 0) {
    throw new MicroSwapError({ code: "invalid_amount", stage: "validate", message: "amount must be a positive SOL value" })
  }
  if (amountLamports > MAX_MICRO_SWAP_LAMPORTS) {
    throw new MicroSwapError({
      code: "amount_too_large",
      stage: "validate",
      message: `amount ${amountSol} SOL exceeds the micro cap of ${MAX_MICRO_SWAP_LAMPORTS / 1e9} SOL`,
    })
  }

  const slippageBps = options.slippageBps ?? DEFAULT_SLIPPAGE_BPS
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > MAX_SLIPPAGE_BPS) {
    throw new MicroSwapError({
      code: "invalid_slippage",
      stage: "validate",
      message: `slippageBps must be an integer between 1 and ${MAX_SLIPPAGE_BPS} (got ${options.slippageBps})`,
    })
  }

  const maxPriorityLamports = options.maxPriorityLamports ?? DEFAULT_MAX_PRIORITY_LAMPORTS
  if (!Number.isInteger(maxPriorityLamports) || maxPriorityLamports < 0) {
    throw new MicroSwapError({ code: "invalid_priority", stage: "validate", message: "maxPriorityLamports must be a non-negative integer" })
  }

  const reserveLamports = options.reserveLamports ?? 0
  if (!Number.isInteger(reserveLamports) || reserveLamports < 0) {
    throw new MicroSwapError({ code: "invalid_reserve", stage: "validate", message: "reserveLamports must be a non-negative integer" })
  }

  const maxPriceImpactPercent = options.maxPriceImpactPercent ?? DEFAULT_MAX_PRICE_IMPACT_PERCENT
  if (!Number.isFinite(maxPriceImpactPercent) || maxPriceImpactPercent < 0) {
    throw new MicroSwapError({ code: "invalid_impact", stage: "validate", message: "maxPriceImpactPercent must be >= 0" })
  }

  return { amountLamports, slippageBps, maxPriorityLamports, reserveLamports, maxPriceImpactPercent }
}

/**
 * Execute exactly one micro swap with all guards. Resolves with the full audit record (quote, tip,
 * balances before/after, signed-tx size, Solscan receipt). Throws {@link MicroSwapError} for a
 * validation/guard rejection or a failed submission (carrying the signature + Solscan link when known).
 */
export async function runMicroSwap(options: RunMicroSwapOptions = {}): Promise<MicroSwapResult> {
  const startedAt = Date.now()
  const { amountLamports, slippageBps, maxPriorityLamports, reserveLamports, maxPriceImpactPercent } =
    validateOptions(options)

  const cluster = detectCluster()
  if (cluster !== "mainnet-beta") {
    throw new MicroSwapError({
      code: "wrong_cluster",
      stage: "validate",
      message: `micro swap targets mainnet-beta SOL/USDC but the RPC is pointed at ${cluster}`,
    })
  }

  const signer = options.signer ?? loadKeypair()
  const provider = getRpcProvider().name

  const usdcPre = await getSplTokenBalance(TOKENS.USDC.mint)
  const ataExists = usdcPre.tokenAccount !== ""
  const balanceBefore = await readBalances()

  const quote = await getQuote(
    TOKENS.SOL.mint,
    TOKENS.USDC.mint,
    amountLamports,
    slippageBps,
    { restrictIntermediateTokens: true },
  ).catch((err) => {
    throw new MicroSwapError({
      code: "quote_failed",
      stage: "quote",
      message: `Jupiter quote failed: ${messageOf(err)}`,
      balanceBefore,
    })
  })

  if (Math.abs(quote.priceImpactPercent) > maxPriceImpactPercent) {
    throw new MicroSwapError({
      code: "price_impact_too_high",
      stage: "guard",
      message: `price impact ${quote.priceImpactPercent.toFixed(4)}% exceeds the ${maxPriceImpactPercent}% limit`,
      balanceBefore,
    })
  }

  const priorityFee = await estimatePriorityFee({
    lockedWritableAccounts: writableAccountsForQuote(quote),
    maxLamports: maxPriorityLamports,
  }).catch((err) => {
    throw new MicroSwapError({
      code: "priority_fee_failed",
      stage: "guard",
      message: `priority-fee estimate failed: ${messageOf(err)}`,
      balanceBefore,
    })
  })

  const ataRent = ataExists ? 0 : TOKEN_ACCOUNT_RENT_LAMPORTS
  const requiredLamports =
    amountLamports + BASE_TX_FEE_LAMPORTS + ataRent + priorityFee.lamports + reserveLamports
  if (balanceBefore.solLamports < requiredLamports) {
    throw new MicroSwapError({
      code: "insufficient_balance",
      stage: "guard",
      message: `insufficient SOL: need ${requiredLamports} lamports (${(requiredLamports / 1e9).toFixed(6)} SOL), have ${balanceBefore.solLamports}`,
      balanceBefore,
    })
  }
  const headroomLamports = balanceBefore.solLamports - requiredLamports

  const { transaction, response } = await buildSignedSwapTransaction({
    quoteResponse: quote.response,
    signer,
    options: {
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: priorityFee.lamports,
    },
  }).catch((err) => {
    throw new MicroSwapError({
      code: "build_failed",
      stage: "build",
      message: `could not build/sign the swap: ${messageOf(err)}`,
      balanceBefore,
    })
  })

  const signedBytes = transaction.serialize()
  const signedBase64 = Buffer.from(signedBytes).toString("base64")
  const feePayer = transaction.message.staticAccountKeys[0]?.toBase58() ?? signer.publicKey.toBase58()

  let receipt
  try {
    receipt = await submitSignedTransaction(transaction, {
      lastValidBlockHeight: response.lastValidBlockHeight,
    })
  } catch (err) {
    const after = await readBalances().catch(() => null)
    const submitErr = err instanceof TransactionSubmitError ? err : null
    throw new MicroSwapError({
      code: submitErr?.reason ?? "submit_failed",
      stage: "submit",
      message: submitErr ? submitErr.message : messageOf(err),
      balanceBefore,
      balanceAfter: after,
    })
  }

  const balanceAfter = await readBalancesSettled(balanceBefore.usdcRaw)

  const usdcOut = {
    symbol: TOKENS.USDC.symbol,
    mint: TOKENS.USDC.mint,
    decimals: TOKENS.USDC.decimals,
    amount: Number(quote.response.outAmount) / 10 ** TOKENS.USDC.decimals,
    amountRaw: quote.response.outAmount,
  }

  const usdcDeltaRaw = BigInt(balanceAfter.usdcRaw) - BigInt(balanceBefore.usdcRaw)

  return {
    ok: true,
    timestamp: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    wallet: signer.publicKey.toBase58(),
    cluster,
    provider,
    input: {
      symbol: TOKENS.SOL.symbol,
      mint: TOKENS.SOL.mint,
      decimals: TOKENS.SOL.decimals,
      amount: amountLamports / 10 ** TOKENS.SOL.decimals,
      amountRaw: String(amountLamports),
    },
    output: usdcOut,
    quote: {
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      otherAmountThreshold: quote.otherAmountThreshold,
      slippageBps: quote.slippageBps,
      priceImpactPercent: quote.priceImpactPercent,
      swapUsdValue: quote.swapUsdValue,
      hops: quote.route.hops,
      labels: quote.route.labels,
      bestRoute: quote.bestRoute.isBest,
      contextSlot: quote.contextSlot,
      timeTaken: quote.timeTaken,
    },
    priorityFee: {
      unitPriceMicroLamports: priorityFee.unitPriceMicroLamports,
      computeUnitLimit: priorityFee.computeUnitLimit,
      lamports: priorityFee.lamports,
      clamped: priorityFee.clamped,
      provider: priorityFee.provider,
      samples: priorityFee.samples,
    },
    guards: {
      balanceBeforeLamports: balanceBefore.solLamports,
      requiredLamports,
      reserveLamports,
      tipIncludedLamports: priorityFee.lamports,
      ataRentIncludedLamports: ataRent,
      headroomLamports,
    },
    balanceBefore,
    balanceAfter,
    delta: {
      sol: balanceAfter.sol - balanceBefore.sol,
      solLamports: balanceAfter.solLamports - balanceBefore.solLamports,
      usdc: balanceAfter.usdc - balanceBefore.usdc,
      usdcRaw: usdcDeltaRaw.toString(),
    },
    transaction: {
      feePayer,
      signature: receipt.signature,
      explorerUrl: receipt.explorerUrl,
      slot: receipt.slot,
      confirmationStatus: receipt.confirmationStatus,
      signedBytes: signedBytes.length,
      signedBase64,
    },
  }
}
