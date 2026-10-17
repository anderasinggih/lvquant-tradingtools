/* Error taxonomy for the Solana RPC layer (PRD §5 Error Handling; Rules §2).
   Pure and dependency-free so the classification logic can be reasoned about in isolation.
   Nothing here hides a failure: every problem is surfaced with enough detail to act on. */

/** A required environment variable is missing or invalid. Never retried — the operator must fix it. */
export class EnvConfigError extends Error {
  readonly missing: string[]
  constructor(missing: string[], detail?: string) {
    super(`Missing ${missing.join(" or ")}${detail ? ` (${detail})` : ""}`)
    this.name = "EnvConfigError"
    this.missing = missing
  }
}

/** The final failure of an RPC operation after every retry attempt was exhausted. */
export class RpcRequestError extends Error {
  readonly operation: string
  readonly provider: string
  readonly attempts: number
  readonly transient: boolean
  /** The underlying error from the last attempt (name kept distinct from `Error.cause`). */
  readonly lastError: unknown
  constructor(
    operation: string,
    provider: string,
    attempts: number,
    lastError: unknown,
    transient: boolean,
  ) {
    super(`RPC ${operation} failed after ${attempts} attempt(s) via ${provider}: ${messageOf(lastError)}`)
    this.name = "RpcRequestError"
    this.operation = operation
    this.provider = provider
    this.attempts = attempts
    this.transient = transient
    this.lastError = lastError
  }
}

/** Best-effort human-readable message for an unknown thrown value. */
export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

/** Extract a numeric JSON-RPC error code (e.g. -32429) if the error carries one. */
export function getErrorCode(err: unknown): number | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code
    if (typeof code === "number") return code
  }
  const match = messageOf(err).match(/(-3\d{4})\b/)
  return match ? Number(match[1]) : undefined
}

/** JSON-RPC codes that mean "slow down" rather than "your request is wrong". */
const RATE_LIMIT_CODES = new Set([-32005, -32429])

/** JSON-RPC codes that are deterministic: retrying the same request cannot help. */
const DETERMINISTIC_CODES = new Set([-32700, -32600, -32601, -32602])

/** Transport / server conditions worth retrying, matched against the error message. */
const TRANSIENT_MESSAGE =
  /429|too many requests|rate.?limit|throttl|\b50[234]\b|service unavailable|bad gateway|gateway timeout|server (?:busy|overloaded)|overloaded|temporar|try again|timed?\s?out|timeout|econnreset|econnrefused|etimedout|eai_again|enotfound|epipe|ehostunreach|enetunreach|fetch failed|network|socket hang up|aborted/i

/** Whether a given RPC error is worth retrying with backoff. */
export function isTransientRpcError(err: unknown): boolean {
  if (err instanceof EnvConfigError) return false
  const code = getErrorCode(err)
  if (code !== undefined) {
    if (RATE_LIMIT_CODES.has(code)) return true
    if (code === -32603) return true // internal node error
    if (DETERMINISTIC_CODES.has(code)) return false
  }
  return TRANSIENT_MESSAGE.test(messageOf(err))
}

/** Whether the error is a rate-limit / throttling response (gets a longer backoff). */
export function isRateLimitError(err: unknown): boolean {
  const code = getErrorCode(err)
  if (code !== undefined && RATE_LIMIT_CODES.has(code)) return true
  return /429|too many requests|rate.?limit|throttl/i.test(messageOf(err))
}

/** Parse a server-provided `Retry-After` hint (seconds) out of the error message, if present. */
export function getRetryAfterMs(err: unknown): number | undefined {
  const match = messageOf(err).match(/retry[- ]after[:\s]+(\d+)/i)
  return match ? Number(match[1]) * 1000 : undefined
}
