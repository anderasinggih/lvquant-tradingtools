import {
  getRetryAfterMs,
  isRateLimitError,
  isTransientRpcError,
  messageOf,
  RpcRequestError,
} from "./errors"

/* Retry engine for RPC calls (PRD §5): exponential backoff with full jitter, a longer delay for
   rate limits, and a transparent final error. Deterministic errors are never retried. */

export interface RpcRetryOptions {
  /** Operation name used in logs and the final error, e.g. "getBalance". */
  operation: string
  /** Provider label for logs/errors, e.g. "helius". */
  provider: string
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

export const RPC_MAX_ATTEMPTS = 4
export const RPC_BASE_DELAY_MS = 300
export const RPC_MAX_DELAY_MS = 8_000

/** Exponential backoff with full jitter; rate limits get a 4× floor. */
export function computeBackoffMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  rateLimited: boolean,
): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
  const floor = rateLimited ? Math.min(maxDelayMs, baseDelayMs * 4) : 0
  const jittered = floor + Math.random() * Math.max(0, ceiling - floor)
  return Math.round(jittered)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Run `fn` with retries on transient failures. Resolves with the first success; on exhaustion
 * throws {@link RpcRequestError} carrying the attempt count and the underlying cause.
 */
export async function withRpcRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RpcRetryOptions,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? RPC_MAX_ATTEMPTS
  const baseDelayMs = options.baseDelayMs ?? RPC_BASE_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? RPC_MAX_DELAY_MS
  const { operation, provider } = options

  let attempt = 0
  let lastError: unknown

  while (attempt < maxAttempts) {
    attempt += 1
    try {
      return await fn(attempt)
    } catch (err) {
      lastError = err
      const transient = isTransientRpcError(err)
      if (!transient || attempt >= maxAttempts) break

      const rateLimited = isRateLimitError(err)
      const hinted = getRetryAfterMs(err)
      const delay = hinted ?? computeBackoffMs(attempt, baseDelayMs, maxDelayMs, rateLimited)

      console.warn(
        `[rpc] ${provider} ${operation} failed (attempt ${attempt}/${maxAttempts}): ` +
          `${messageOf(err)}${rateLimited ? " [rate-limited]" : ""} — retrying in ${delay}ms`,
      )
      await sleep(delay)
    }
  }

  throw new RpcRequestError(
    operation,
    provider,
    Math.max(attempt, 1),
    lastError,
    isTransientRpcError(lastError),
  )
}
