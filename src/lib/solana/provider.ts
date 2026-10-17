/* RPC provider identification and credential redaction.
   Dependency-free so the pure helpers can be unit-tested in isolation. */

export type RpcProviderName = "helius" | "quicknode" | "public" | "custom"

export interface RpcProvider {
  name: RpcProviderName
  host: string
  /** Endpoint URL with credentials masked — safe to log or return to the client. */
  endpoint: string
}

/** Identify the provider from an endpoint hostname. */
export function detectProvider(host: string): RpcProviderName {
  const h = host.toLowerCase()
  if (h.includes("helius")) return "helius"
  if (h.includes("quiknode") || h.includes("quicknode")) return "quicknode"
  if (h.endsWith("solana.com") || h.includes("mainnet-beta")) return "public"
  return "custom"
}

/** Mask credentials in an RPC URL so it is safe for logs and API responses. */
export function redactEndpoint(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return "<invalid>"
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (/key|token|secret|password|auth/i.test(key)) parsed.searchParams.set(key, "***")
  }
  if (parsed.hostname.includes("quiknode")) {
    const labels = parsed.hostname.split(".")
    if (labels.length > 2) {
      labels[0] = "***"
      parsed.hostname = labels.join(".")
    }
  }
  if (parsed.pathname && parsed.pathname !== "/") parsed.pathname = "/***"
  return parsed.toString()
}

/** Describe an endpoint without exposing its credentials. */
export function describeProvider(url: string): RpcProvider {
  const parsed = new URL(url)
  return {
    name: detectProvider(parsed.hostname),
    host: parsed.hostname,
    endpoint: redactEndpoint(url),
  }
}
