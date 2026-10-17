/* Solana block-explorer links (Fase 4.3): turns a confirmed transaction signature (or an address)
   into a Solscan URL so every on-chain action has an auditable receipt. No network calls, no
   fabricated ids — just deterministic URL construction (Rules §1). */

export type SolanaCluster = "mainnet-beta" | "devnet" | "testnet"

const SOLSCAN_HOST = "https://solscan.io"

/** Best-effort cluster detection from an RPC URL (mainnet when nothing else matches). */
export function detectClusterFromRpcUrl(url: string): SolanaCluster {
  const value = url.toLowerCase()
  if (value.includes("devnet")) return "devnet"
  if (value.includes("testnet")) return "testnet"
  return "mainnet-beta"
}

/** Cluster of the configured `SOLANA_RPC_URL`, defaulting to mainnet-beta when none is set. */
export function detectCluster(): SolanaCluster {
  const url = process.env.SOLANA_RPC_URL?.trim()
  return url ? detectClusterFromRpcUrl(url) : "mainnet-beta"
}

function withCluster(path: string, cluster: SolanaCluster): string {
  return cluster === "mainnet-beta" ? `${SOLSCAN_HOST}${path}` : `${SOLSCAN_HOST}${path}?cluster=${cluster}`
}

/** Solscan URL for a transaction signature (validates the base58-looking id first). */
export function solscanTxUrl(signature: string, cluster: SolanaCluster = "mainnet-beta"): string {
  const value = signature?.trim()
  if (!value || !/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(value)) {
    throw new Error(`not a valid transaction signature: ${signature}`)
  }
  return withCluster(`/tx/${value}`, cluster)
}

/** Solscan URL for an account / token mint address. */
export function solscanAddressUrl(address: string, cluster: SolanaCluster = "mainnet-beta"): string {
  const value = address?.trim()
  if (!value || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
    throw new Error(`not a valid Solana address: ${address}`)
  }
  return withCluster(`/account/${value}`, cluster)
}

/** Solscan transaction URL for the cluster the RPC is pointed at. */
export function getSolscanTxUrl(signature: string): string {
  return solscanTxUrl(signature, detectCluster())
}
