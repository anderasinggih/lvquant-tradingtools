import {
  type Commitment,
  type Connection,
  SendTransactionError,
  TransactionExpiredBlockheightExceededError,
  TransactionExpiredTimeoutError,
  type VersionedTransaction,
} from "@solana/web3.js"

import { getConnection, getRpcProvider, RPC_COMMITMENT } from "./connection"
import { messageOf, RpcRequestError } from "./errors"
import { getSolscanTxUrl } from "./explorer"
import { withRpcRetry } from "./retry"

/* Execution submitter (Fase 4.3): send a signed transaction over the shared RPC connection with
   `sendRawTransaction`, then wait for `confirmed` using the blockhash+last-valid-block-height
   strategy. Every rejection is classified into a concrete, actionable reason (expired blockhash,
   slippage, insufficient funds, …) and reported together with the signature, logs and a Solscan
   link — never swallowed, never retried blindly (Rules §1 / §2). */

export type SubmitFailureReason =
  | "blockhash_expired"
  | "slippage_exceeded"
  | "insufficient_funds"
  | "simulation_failed"
  | "transaction_failed"
  | "send_failed"
  | "confirmation_failed"
  | "timeout"
  | "unknown"

export type SubmitStage = "send" | "confirm"

/** The transaction was rejected (or never confirmed): carries the classified reason and evidence. */
export class TransactionSubmitError extends Error {
  readonly reason: SubmitFailureReason
  readonly stage: SubmitStage
  readonly signature: string | null
  readonly logs: string[]
  /** the underlying error thrown by the RPC / web3.js */
  readonly lastError: unknown
  constructor(params: {
    reason: SubmitFailureReason
    stage: SubmitStage
    signature?: string | null
    logs?: string[]
    lastError?: unknown
    detail?: string
  }) {
    const where = params.signature ? ` (tx ${params.signature})` : ""
    const extra = params.detail ? `: ${params.detail}` : ""
    super(`transaction ${params.reason} during ${params.stage}${where}${extra}`)
    this.name = "TransactionSubmitError"
    this.reason = params.reason
    this.stage = params.stage
    this.signature = params.signature ?? null
    this.logs = params.logs ?? []
    this.lastError = params.lastError
  }
}

export interface SubmitOptions {
  /** `lastValidBlockHeight` from the blockhash the transaction was built against (Jupiter returns it). */
  lastValidBlockHeight?: number
  /** Commitment to wait for. Defaults to the configured {@link RPC_COMMITMENT} (`confirmed`). */
  commitment?: Commitment
  /** Skip the RPC preflight simulation (default false — we want failures caught early). */
  skipPreflight?: boolean
  /** Leader retries for `sendRawTransaction`. Default 3. */
  maxRetries?: number
}

export interface SubmitResult {
  signature: string
  /** slot the transaction was confirmed in (if the node reported it) */
  slot: number | null
  confirmationStatus: "confirmed" | "finalized"
  /** Solscan receipt URL for audit */
  explorerUrl: string
}

/** Program conditions matched against the error message + logs. */
const BLOCKHASH_MESSAGE = /blockhash/i
const BLOCKHASH_DETAIL = /(not found|invalid|expired|blockheight)/i
const SLIPPAGE_MESSAGE = /slippage|0x1771|\b6001\b/i
const INSUFFICIENT_FUNDS_MESSAGE = /insufficient (?:funds|lamports|balance)|attempt to debit|prior credit/i

/** Collect the program logs attached to a web3.js send/simulate error, if any. */
function collectLogs(err: unknown): string[] {
  if (err instanceof SendTransactionError) {
    if (Array.isArray(err.logs)) return err.logs
    const { logs } = err.transactionError
    if (Array.isArray(logs)) return logs
  }
  if (err && typeof err === "object" && "logs" in err) {
    const logs = (err as { logs?: unknown }).logs
    if (Array.isArray(logs)) return logs.filter((line): line is string => typeof line === "string")
  }
  return []
}

/** Logs already attached to the error, or fetched from the RPC when the error carries none. */
async function resolveLogs(err: unknown, connection: Connection): Promise<string[]> {
  const attached = collectLogs(err)
  if (attached.length > 0 || !(err instanceof SendTransactionError)) return attached
  return err.getLogs(connection).catch(() => [])
}

/** Does a Solana `InstructionError` custom code (e.g. `{"Custom":6001}`) mean slippage? */
function classifyCustomCode(err: unknown): SubmitFailureReason | null {
  if (!err || typeof err !== "object") return null
  const record = err as Record<string, unknown>
  if ("InstructionError" in record) {
    const detail = record.InstructionError
    if (Array.isArray(detail) && detail[1] && typeof detail[1] === "object") {
      const inner = detail[1] as Record<string, unknown>
      if (inner.Custom === 6001) return "slippage_exceeded"
    }
  }
  if (record.Custom === 6001) return "slippage_exceeded"
  return null
}

/** Map a rejected send/simulation into a concrete reason (blockhash, slippage, funds, …). */
export function classifySubmitError(
  err: unknown,
  logs: string[] = collectLogs(err),
): SubmitFailureReason {
  if (err instanceof TransactionExpiredBlockheightExceededError) return "blockhash_expired"
  if (err instanceof TransactionExpiredTimeoutError) return "timeout"

  const custom = classifyCustomCode(err)
  if (custom) return custom

  const haystack = `${messageOf(err)}\n${logs.join("\n")}`
  if (BLOCKHASH_MESSAGE.test(haystack) && BLOCKHASH_DETAIL.test(haystack)) return "blockhash_expired"
  if (SLIPPAGE_MESSAGE.test(haystack)) return "slippage_exceeded"
  if (INSUFFICIENT_FUNDS_MESSAGE.test(haystack)) return "insufficient_funds"
  if (err instanceof SendTransactionError) return "simulation_failed"
  return "unknown"
}

/**
 * Submit a signed transaction and wait for `confirmed`. Resolves with the signature, the slot and a
 * Solscan receipt; throws {@link TransactionSubmitError} (classified reason + logs) when the cluster
 * rejects it (insufficient funds, slippage, expired blockhash, …) or it never confirms in time.
 */
export async function submitSignedTransaction(
  transaction: VersionedTransaction,
  options: SubmitOptions = {},
): Promise<SubmitResult> {
  if (!transaction.signatures?.length) {
    throw new TransactionSubmitError({
      reason: "send_failed",
      stage: "send",
      detail: "transaction is not signed",
    })
  }

  const connection = getConnection()
  const provider = getRpcProvider().name
  const commitment = options.commitment ?? RPC_COMMITMENT
  const raw = transaction.serialize()

  let signature: string
  try {
    signature = await withRpcRetry(
      () =>
        connection.sendRawTransaction(raw, {
          skipPreflight: options.skipPreflight ?? false,
          preflightCommitment: commitment,
          maxRetries: options.maxRetries ?? 3,
        }),
      { operation: "sendRawTransaction", provider },
    )
  } catch (err) {
    const cause = err instanceof RpcRequestError ? err.lastError : err
    const logs = await resolveLogs(cause, connection)
    throw new TransactionSubmitError({
      reason: classifySubmitError(cause, logs),
      stage: "send",
      logs,
      lastError: cause,
      detail: messageOf(cause),
    })
  }

  const confirmationPromise = options.lastValidBlockHeight
    ? connection.confirmTransaction(
        {
          signature,
          blockhash: transaction.message.recentBlockhash,
          lastValidBlockHeight: options.lastValidBlockHeight,
        },
        commitment,
      )
    : connection.confirmTransaction(signature, commitment)

  let confirmed: Awaited<typeof confirmationPromise>
  try {
    confirmed = await confirmationPromise
  } catch (err) {
    const logs = await resolveLogs(err, connection)
    throw new TransactionSubmitError({
      reason: classifySubmitError(err, logs),
      stage: "confirm",
      signature,
      logs,
      lastError: err,
      detail: messageOf(err),
    })
  }

  if (confirmed.value.err) {
    const onChainReason = classifyCustomCode(confirmed.value.err) ?? "transaction_failed"
    throw new TransactionSubmitError({
      reason: onChainReason,
      stage: "confirm",
      signature,
      lastError: confirmed.value.err,
      detail: messageOf(confirmed.value.err),
    })
  }

  return {
    signature,
    slot: confirmed.context.slot ?? null,
    confirmationStatus: "confirmed",
    explorerUrl: getSolscanTxUrl(signature),
  }
}
