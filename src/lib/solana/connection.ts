import { Connection, type Commitment, type FetchFn } from "@solana/web3.js"

import { EnvConfigError } from "./errors"
import { describeProvider, type RpcProvider, type RpcProviderName } from "./provider"
import { withRpcRetry } from "./retry"

/* RPC connection & provider setup (PRD §2 RPC, §5 Error Handling).
   Works with any Solana JSON-RPC endpoint — Helius, QuickNode, Triton or the public cluster.
   Every outbound call gets a hard timeout and is retried with backoff on transient failures;
   nothing falls back to a different provider or a fabricated value. */

export const RPC_COMMITMENT: Commitment = "confirmed"
/** Hard per-request timeout, so a hung socket can never block the engine forever. */
export const RPC_TIMEOUT_MS = 10_000

/** Read and validate `SOLANA_RPC_URL`. Throws {@link EnvConfigError} when absent or malformed. */
function readRpcUrl(): string {
  const value = process.env.SOLANA_RPC_URL?.trim()
  if (!value) throw new EnvConfigError(["SOLANA_RPC_URL"])
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new EnvConfigError(["SOLANA_RPC_URL"], "not a valid URL")
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new EnvConfigError(["SOLANA_RPC_URL"], `unsupported protocol ${parsed.protocol}`)
  }
  return parsed.toString()
}

/** Describe the configured provider without exposing its credentials. */
export function getRpcProvider(): RpcProvider {
  return describeProvider(readRpcUrl())
}

/** Whether `SOLANA_RPC_URL` is present (does not validate the endpoint). */
export function isRpcConfigured(): boolean {
  return Boolean(process.env.SOLANA_RPC_URL?.trim())
}

/** fetch wrapper that enforces {@link RPC_TIMEOUT_MS} on every request. */
const rpcFetch: FetchFn = (input, init) => {
  const timeout = AbortSignal.timeout(RPC_TIMEOUT_MS)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  return fetch(input, { ...init, signal })
}

let cached: { url: string; connection: Connection } | null = null

/**
 * The shared Solana connection. Built once per endpoint and reused.
 * `disableRetryOnRateLimit` is on because rate-limit handling is ours (see {@link withRpcRetry}),
 * which keeps the backoff strategy and logging in one place instead of hidden inside web3.js.
 */
export function getConnection(): Connection {
  const url = readRpcUrl()
  if (cached?.url === url) return cached.connection
  const connection = new Connection(url, {
    commitment: RPC_COMMITMENT,
    fetch: rpcFetch,
    disableRetryOnRateLimit: true,
  })
  cached = { url, connection }
  return connection
}

export interface RpcStatus {
  provider: RpcProviderName
  host: string
  endpoint: string
  commitment: Commitment
  slot: number
  version: string
  latencyMs: number
}

/** Live health probe against the configured RPC: current slot and node version. */
export async function getRpcStatus(): Promise<RpcStatus> {
  const provider = getRpcProvider()
  const connection = getConnection()
  const startedAt = Date.now()

  const slot = await withRpcRetry(() => connection.getSlot(), {
    operation: "getSlot",
    provider: provider.name,
  })
  const version = await withRpcRetry(
    async () => (await connection.getVersion())["solana-core"],
    { operation: "getVersion", provider: provider.name },
  )

  return {
    provider: provider.name,
    host: provider.host,
    endpoint: provider.endpoint,
    commitment: RPC_COMMITMENT,
    slot,
    version,
    latencyMs: Date.now() - startedAt,
  }
}
