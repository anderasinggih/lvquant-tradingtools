import { PublicKey, type Keypair } from "@solana/web3.js"

import { estimatePriorityFee, type EstimatedPriorityFee } from "@/lib/solana/priority-fee"
import { submitSignedTransaction, type SubmitResult } from "@/lib/solana/submit"
import { loadKeypair } from "@/lib/solana/wallet"

import { buildSignedSwapTransaction } from "./swap"
import type { JupiterQuote, JupiterSwapRequestOptions } from "./types"

/* Swap execution engine (Fase 4.3): ties the pieces together — derive the writable accounts from the
   quote, estimate a dynamic priority fee for exactly those accounts, build + sign the swap, then
   submit it and wait for `confirmed`. Returns the confirmed signature, slot and Solscan receipt so
   every trade is auditable on-chain. No mocks anywhere in this path (Rules §1). */

/**
 * The writable accounts a swap locks: the input/output mints and every pool (`ammKey`) on the route.
 * Feeding these to {@link estimatePriorityFee} makes the node report the fee actually needed to land
 * a transaction touching them (without accounts the public RPC answers all-zero).
 */
export function writableAccountsForQuote(quote: JupiterQuote): PublicKey[] {
  const seen = new Set<string>()
  const accounts: PublicKey[] = []
  const push = (key: string | undefined) => {
    const value = key?.trim()
    if (!value || seen.has(value)) return
    seen.add(value)
    accounts.push(new PublicKey(value))
  }
  push(quote.inputMint)
  push(quote.outputMint)
  for (const step of quote.route.steps) push(step.ammKey)
  return accounts
}

export interface ExecuteSwapParams {
  quote: JupiterQuote
  /** The signing wallet. Defaults to the bot wallet from `SOLANA_PRIVATE_KEY`. */
  signer?: Keypair
  /** Skip the dynamic priority fee (submit with the quote's default compute budget only). */
  skipPriorityFee?: boolean
  /** Priority-fee estimator overrides (percentile, computeUnitLimit, maxLamports, minLamports). */
  priorityFee?: {
    percentile?: number
    computeUnitLimit?: number
    maxLamports?: number
    minLamports?: number
  }
  /** Extra Jupiter swap-build options (e.g. `wrapAndUnwrapSol`, `destinationTokenAccount`). */
  swapOptions?: JupiterSwapRequestOptions
}

export interface SwapExecutionResult extends SubmitResult {
  /** the dynamic tip embedded in the transaction (null when `skipPriorityFee` was set) */
  priorityFee: EstimatedPriorityFee | null
}

/**
 * Execute a quoted swap end-to-end: estimate the tip, build + sign locally, submit over the shared
 * RPC connection and wait for `confirmed`. Throws on any failure (bad quote, rejection, timeout) —
 * the caller gets a classified reason, never a silent no-op.
 */
export async function executeSwap(params: ExecuteSwapParams): Promise<SwapExecutionResult> {
  const signer = params.signer ?? loadKeypair()

  const priorityFee = params.skipPriorityFee
    ? null
    : await estimatePriorityFee({
        lockedWritableAccounts: writableAccountsForQuote(params.quote),
        ...params.priorityFee,
      })

  const { transaction, response } = await buildSignedSwapTransaction({
    quoteResponse: params.quote.response,
    signer,
    options: {
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      ...(priorityFee ? { prioritizationFeeLamports: priorityFee.lamports } : {}),
      ...params.swapOptions,
    },
  })

  const receipt = await submitSignedTransaction(transaction, {
    lastValidBlockHeight: response.lastValidBlockHeight,
  })

  return { ...receipt, priorityFee }
}
