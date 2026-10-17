import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js"

import { messageOf } from "@/lib/solana/errors"
import { withRpcRetry } from "@/lib/solana/retry"
import { loadKeypair } from "@/lib/solana/wallet"

import type { JupiterSwapRequestOptions, JupiterSwapResponse } from "./types"

/* Jupiter Swap Transaction builder (Fase 4.2) — https://api.jup.ag/swap/v1/swap.
   The engine hands over a quote, Jupiter returns a base64-serialized *unsigned* VersionedTransaction,
   and the bot deserializes and signs it locally with its own Keypair (PRD §4.1 non-custodial: the key
   never leaves this process). Nothing is invented: a missing transaction, an unreadable payload, or a
   transaction whose fee payer is not our wallet is a thrown error, never a silently-signed blob
   (Rules §1 / §2). Auth is optional, exactly like the quote endpoint. */

const JUPITER_SWAP_URL = "https://api.jup.ag/swap/v1/swap"
const REQUEST_TIMEOUT_MS = 15_000

/** A swap transaction could not be built, decoded, or safely signed. */
export class SwapBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SwapBuildError"
  }
}

function apiKey(): string | undefined {
  const key = process.env.JUPITER_API_KEY?.trim()
  return key ? key : undefined
}

export interface FetchSwapTransactionParams {
  /** The verbatim quote (or its `response`) returned by {@link getQuote}. */
  quoteResponse: unknown
  /** The wallet that will own and sign the swap. */
  userPublicKey: string
  options?: JupiterSwapRequestOptions
  /** Override the `JUPITER_API_KEY` env value for this call. */
  apiKey?: string
}

function buildRequestBody(params: FetchSwapTransactionParams): Record<string, unknown> {
  if (!params.quoteResponse || typeof params.quoteResponse !== "object") {
    throw new SwapBuildError("quoteResponse is required (pass the Jupiter quote to execute)")
  }
  const user = params.userPublicKey?.trim()
  if (!user) throw new SwapBuildError("userPublicKey is required")
  try {
    new PublicKey(user)
  } catch {
    throw new SwapBuildError(`userPublicKey is not a valid Solana address: ${user}`)
  }

  const body: Record<string, unknown> = { quoteResponse: params.quoteResponse, userPublicKey: user }
  for (const [key, value] of Object.entries(params.options ?? {})) {
    if (value !== undefined) body[key] = value
  }
  return body
}

/**
 * Ask Jupiter to build the (unsigned) swap transaction for a quote. Transient upstream failures are
 * retried; a deterministic rejection (bad quote / bad address) surfaces immediately as
 * {@link SwapBuildError}, and a persistent transport failure as `RpcRequestError`.
 */
export async function fetchSwapTransaction(
  params: FetchSwapTransactionParams,
): Promise<JupiterSwapResponse> {
  const body = buildRequestBody(params)
  const key = params.apiKey ?? apiKey()

  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  }
  if (key) headers["x-api-key"] = key

  const response = await withRpcRetry(
    async () => {
      const res = await fetch(JUPITER_SWAP_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => "")
        throw new Error(
          `Jupiter Swap API responded ${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
        )
      }
      return (await res.json()) as JupiterSwapResponse
    },
    { operation: "swap", provider: "jupiter" },
  )

  if (typeof response?.swapTransaction !== "string" || response.swapTransaction.length === 0) {
    throw new SwapBuildError("Jupiter Swap API returned no swapTransaction")
  }
  return response
}

/** Decode a base64 `swapTransaction` into a {@link VersionedTransaction}; throws on malformed input. */
export function deserializeSwapTransaction(swapTransaction: string): VersionedTransaction {
  if (typeof swapTransaction !== "string" || swapTransaction.trim() === "") {
    throw new SwapBuildError("swapTransaction must be a non-empty base64 string")
  }
  let bytes: Uint8Array
  try {
    bytes = Buffer.from(swapTransaction, "base64")
  } catch (err) {
    throw new SwapBuildError(`swapTransaction is not valid base64: ${messageOf(err)}`)
  }
  if (bytes.length === 0) throw new SwapBuildError("swapTransaction decoded to an empty buffer")
  try {
    return VersionedTransaction.deserialize(bytes)
  } catch (err) {
    throw new SwapBuildError(`could not deserialize swap transaction: ${messageOf(err)}`)
  }
}

/**
 * Sign a built swap transaction locally with `signer`. Refuses to sign unless the transaction's fee
 * payer is exactly the signer — so the bot can never be tricked into paying for a foreign wallet.
 */
export function signSwapTransaction(
  transaction: VersionedTransaction,
  signer: Keypair,
): VersionedTransaction {
  const feePayer = transaction.message.staticAccountKeys[0]
  if (!feePayer) {
    throw new SwapBuildError("transaction has no fee payer to sign")
  }
  if (!feePayer.equals(signer.publicKey)) {
    throw new SwapBuildError(
      `refusing to sign: fee payer ${feePayer.toBase58()} is not wallet ${signer.publicKey.toBase58()}`,
    )
  }

  transaction.sign([signer])

  const signature = transaction.signatures[0]
  if (!signature || signature.length === 0 || signature.every((byte) => byte === 0)) {
    throw new SwapBuildError("transaction was not signed — the wallet may not be a required signer")
  }
  return transaction
}

/** Serialise a (signed) transaction ready for submission. */
export function serializeSwapTransaction(transaction: VersionedTransaction): Uint8Array {
  return transaction.serialize()
}

/** Serialise a (signed) transaction back to the base64 form RPC expects. */
export function serializeSwapTransactionBase64(transaction: VersionedTransaction): string {
  return Buffer.from(transaction.serialize()).toString("base64")
}

export interface BuildSignedSwapResult {
  /** the signed, ready-to-submit transaction */
  transaction: VersionedTransaction
  /** the upstream response (carries `lastValidBlockHeight`, priority-fee info, simulationError) */
  response: JupiterSwapResponse
}

/**
 * One-shot: build the swap for `quoteResponse`, deserialize it and sign it with `signer`
 * (defaults to the bot wallet from `SOLANA_PRIVATE_KEY`). Returns the signed transaction and the raw
 * upstream response. Building only needs the public key; the private key is used solely for the local
 * signature. Callers decide what to do with `response.simulationError` before submitting.
 */
export async function buildSignedSwapTransaction(params: {
  quoteResponse: unknown
  signer?: Keypair
  options?: JupiterSwapRequestOptions
  apiKey?: string
}): Promise<BuildSignedSwapResult> {
  const signer = params.signer ?? loadKeypair()
  const response = await fetchSwapTransaction({
    quoteResponse: params.quoteResponse,
    userPublicKey: signer.publicKey.toBase58(),
    options: params.options,
    apiKey: params.apiKey,
  })
  const transaction = deserializeSwapTransaction(response.swapTransaction)
  signSwapTransaction(transaction, signer)
  return { transaction, response }
}
