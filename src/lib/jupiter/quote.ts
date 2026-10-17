import { withRpcRetry } from "@/lib/solana/retry"

import type {
  JupiterQuote,
  JupiterQuoteResponse,
  JupiterQuoteRoute,
  JupiterQuoteRouteCheck,
  JupiterQuoteStep,
} from "./types"

/* Jupiter Quote API V1 client — https://api.jup.ag/swap/v1/quote (Metis routing engine).
   `getQuote` validates its inputs, asks Jupiter for the best route over the given pair, then
   normalises the result (route summary + a check that the chosen route beats every single-market
   alternative) and computes the price impact. Nothing is invented: a missing route, a non-positive
   output or a malformed price impact is a thrown error, never a made-up quote (Rules §1 / §2).
   Auth is optional — the API also answers unauthenticated at a lower rate limit; when
   `JUPITER_API_KEY` is set it is sent as `x-api-key` to raise the limit. */

const JUPITER_SWAP_QUOTE_URL = "https://api.jup.ag/swap/v1/quote"
const REQUEST_TIMEOUT_MS = 8_000

/** A quote could not be produced: bad inputs, no route, or a malformed upstream response. */
export class QuoteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "QuoteError"
  }
}

function apiKey(): string | undefined {
  const key = process.env.JUPITER_API_KEY?.trim()
  return key ? key : undefined
}

export interface GetQuoteOptions {
  /** Override the `JUPITER_API_KEY` env value for this call. */
  apiKey?: string
  /** "ExactIn" (default) or "ExactOut". */
  swapMode?: "ExactIn" | "ExactOut"
  /** Route only through highly liquid intermediate tokens (default true → more stable route). */
  restrictIntermediateTokens?: boolean
  /** Restrict routing to a single market (default false). */
  onlyDirectRoutes?: boolean
}

/** Normalise `amount` (raw integer token units) to a positive integer string, or throw. */
function normaliseAmount(amount: string | number | bigint): string {
  let value: string
  if (typeof amount === "bigint") {
    value = amount.toString()
  } else if (typeof amount === "number") {
    if (!Number.isInteger(amount)) {
      throw new QuoteError("amount must be an integer in the token's smallest unit (no decimals)")
    }
    if (!Number.isSafeInteger(amount)) {
      throw new QuoteError("amount is too large for a JS number — pass it as a string or bigint")
    }
    value = String(amount)
  } else {
    value = amount.trim()
  }
  if (!/^\d+$/.test(value)) {
    throw new QuoteError("amount must be a positive integer string of raw token units")
  }
  if (BigInt(value) <= BigInt(0)) {
    throw new QuoteError("amount must be greater than 0")
  }
  return value
}

function validateSlippage(slippageBps: number): void {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new QuoteError("slippageBps must be an integer between 0 and 10000 (0%–100%)")
  }
}

function parseRawAmount(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new QuoteError(`Jupiter quote returned a malformed ${field}`)
  }
  return BigInt(value)
}

/** Call the endpoint and return the raw quote; transient failures retry, deterministic ones do not. */
async function fetchQuoteResponse(
  params: {
    inputMint: string
    outputMint: string
    amount: string
    slippageBps: number
    swapMode?: "ExactIn" | "ExactOut"
    restrictIntermediateTokens: boolean
    onlyDirectRoutes?: boolean
  },
  key?: string,
): Promise<JupiterQuoteResponse> {
  const url = new URL(JUPITER_SWAP_QUOTE_URL)
  url.searchParams.set("inputMint", params.inputMint)
  url.searchParams.set("outputMint", params.outputMint)
  url.searchParams.set("amount", params.amount)
  url.searchParams.set("slippageBps", String(params.slippageBps))
  url.searchParams.set("restrictIntermediateTokens", String(params.restrictIntermediateTokens))
  if (params.swapMode) url.searchParams.set("swapMode", params.swapMode)
  if (params.onlyDirectRoutes) url.searchParams.set("onlyDirectRoutes", "true")

  const headers: Record<string, string> = { accept: "application/json" }
  if (key) headers["x-api-key"] = key

  return withRpcRetry(
    async () => {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      })
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(
          `Jupiter Quote API responded ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`,
        )
      }
      return (await res.json()) as JupiterQuoteResponse
    },
    { operation: "quote", provider: "jupiter" },
  )
}

/** Summarise the chosen route (hops, coverage, DEX labels, per-step detail). */
function summariseRoute(response: JupiterQuoteResponse): JupiterQuoteRoute {
  const steps: JupiterQuoteStep[] = response.routePlan.map((step) => ({
    label: step.swapInfo.label?.trim() || "Unknown",
    ammKey: step.swapInfo.ammKey,
    percent: Number(step.percent) || 0,
    inAmount: step.swapInfo.inAmount,
    outAmount: step.swapInfo.outAmount,
  }))
  const labels = [...new Set(steps.map((s) => s.label))]
  const percentCoverage = steps.reduce((sum, s) => sum + s.percent, 0)
  return { hops: steps.length, percentCoverage, labels, steps }
}

/** Verify the router beat every single-market alternative it reported. */
function checkBestRoute(response: JupiterQuoteResponse, outAmount: bigint): JupiterQuoteRouteCheck {
  const info = response.mostReliableAmmsQuoteReport?.info ?? {}
  let best: bigint | null = null
  for (const value of Object.values(info)) {
    if (typeof value !== "string" || !/^\d+$/.test(value)) continue
    const amount = BigInt(value)
    if (best === null || amount > best) best = amount
  }
  return {
    isBest: best === null ? true : outAmount >= best,
    quotedOutAmount: outAmount.toString(),
    bestAlternativeOutAmount: best === null ? null : best.toString(),
    alternativeCount: Object.keys(info).length,
  }
}

/**
 * Get the best swap route for `inputMint → outputMint` for `amount` raw input units, tolerant of
 * `slippageBps` basis points. Returns the normalised quote (with price impact and a best-route
 * check). Throws {@link QuoteError} for bad inputs or an unusable quote, and `RpcRequestError` when
 * the upstream keeps failing.
 */
export async function getQuote(
  inputMint: string,
  outputMint: string,
  amount: string | number | bigint,
  slippageBps: number,
  options: GetQuoteOptions = {},
): Promise<JupiterQuote> {
  const inMint = inputMint?.trim()
  const outMint = outputMint?.trim()
  if (!inMint || !outMint) throw new QuoteError("inputMint and outputMint are required")
  if (inMint === outMint) throw new QuoteError("inputMint and outputMint must be different mints")

  const rawAmount = normaliseAmount(amount)
  validateSlippage(slippageBps)

  const response = await fetchQuoteResponse(
    {
      inputMint: inMint,
      outputMint: outMint,
      amount: rawAmount,
      slippageBps,
      swapMode: options.swapMode,
      restrictIntermediateTokens: options.restrictIntermediateTokens ?? true,
      onlyDirectRoutes: options.onlyDirectRoutes,
    },
    options.apiKey ?? apiKey(),
  )

  if (!Array.isArray(response.routePlan) || response.routePlan.length === 0) {
    throw new QuoteError(`Jupiter returned no swap route for ${inMint} → ${outMint}`)
  }
  const outAmount = parseRawAmount(response.outAmount, "outAmount")
  if (outAmount <= BigInt(0)) {
    throw new QuoteError("Jupiter quote returned a non-positive outAmount")
  }

  const impactFraction = Number(response.priceImpactPct)
  if (!Number.isFinite(impactFraction)) {
    throw new QuoteError("Jupiter quote is missing a usable priceImpactPct")
  }

  const usd = Number(response.swapUsdValue)

  return {
    inputMint: response.inputMint,
    outputMint: response.outputMint,
    inAmount: response.inAmount,
    outAmount: response.outAmount,
    otherAmountThreshold: response.otherAmountThreshold,
    swapMode: response.swapMode,
    slippageBps: response.slippageBps,
    priceImpactPct: impactFraction,
    priceImpactPercent: impactFraction * 100,
    route: summariseRoute(response),
    bestRoute: checkBestRoute(response, outAmount),
    swapUsdValue: Number.isFinite(usd) ? usd : null,
    contextSlot: response.contextSlot,
    timeTaken: response.timeTaken,
    response,
  }
}
