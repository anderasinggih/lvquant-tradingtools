/* Shared Jupiter Swap API types (Fase 4). Dependency-free, so both the server execution engine and
   the client can import them. Field names match the Metis Swap V1 quote response verbatim. */

/** One step of a route: the market it swaps through and the share of the trade it covers. */
export interface JupiterRoutePlanStep {
  swapInfo: {
    ammKey: string
    label?: string | null
    inputMint: string
    outputMint: string
    inAmount: string
    outAmount: string
    feeAmount?: string
    feeMint?: string
  }
  percent: number
}

/** The upstream quote exactly as Jupiter returns it (the fields we consume, plus any extra keys). */
export interface JupiterQuoteResponse {
  inputMint: string
  inAmount: string
  outputMint: string
  outAmount: string
  otherAmountThreshold: string
  swapMode: "ExactIn" | "ExactOut"
  slippageBps: number
  priceImpactPct: string
  routePlan: JupiterRoutePlanStep[]
  contextSlot: number
  timeTaken: number
  swapUsdValue?: string | null
  mostReliableAmmsQuoteReport?: { info?: Record<string, string> } | null
  /** any other fields Jupiter returns are kept so the raw quote can be handed to the swap step */
  [key: string]: unknown
}

/** A normalised route step for the UI / logs. */
export interface JupiterQuoteStep {
  label: string
  ammKey: string
  percent: number
  inAmount: string
  outAmount: string
}

/** The chosen route, summarised. */
export interface JupiterQuoteRoute {
  /** number of markets the trade is split across */
  hops: number
  /** total share covered by the steps (should be ~100) */
  percentCoverage: number
  /** distinct DEX labels in order, e.g. ["Orca Whirlpool", "Meteora DLMM"] */
  labels: string[]
  steps: JupiterQuoteStep[]
}

/**
 * The result of checking that the router picked the best route: Jupiter reports the output each
 * individual market would have quoted (`mostReliableAmmsQuoteReport`); the chosen route's output
 * must be at least the best of those. If it were not, the route would be suspect and flagged.
 */
export interface JupiterQuoteRouteCheck {
  isBest: boolean
  quotedOutAmount: string
  bestAlternativeOutAmount: string | null
  alternativeCount: number
}

/** The quote the dashboard and the execution engine work with. */
export interface JupiterQuote {
  inputMint: string
  outputMint: string
  inAmount: string
  outAmount: string
  otherAmountThreshold: string
  swapMode: "ExactIn" | "ExactOut"
  slippageBps: number
  /** Jupiter's price impact as a fraction (multiply by 100 for %). */
  priceImpactPct: number
  /** The same value as a percentage. */
  priceImpactPercent: number
  route: JupiterQuoteRoute
  bestRoute: JupiterQuoteRouteCheck
  swapUsdValue: number | null
  contextSlot: number
  timeTaken: number
  /** the verbatim upstream quote, to hand to the swap-transaction step (Fase 4.2) */
  response: JupiterQuoteResponse
}

/* ── Swap transaction build (Fase 4.2) ───────────────────────────────────────── */

export type JupiterPriorityLevel = "medium" | "high" | "veryHigh"

/** Jupiter's priority-fee request shape (a plain number is also accepted). */
export interface JupiterPrioritizationFee {
  priorityLevelWithMaxLamports?: {
    maxLamports?: number
    global?: boolean
    priorityLevel?: JupiterPriorityLevel
  }
  jitoTipLamports?: number
  autoMultiplier?: number
}

/** Options accepted by `POST /swap/v1/swap` alongside the quote. */
export interface JupiterSwapRequestOptions {
  wrapAndUnwrapSol?: boolean
  useSharedAccounts?: boolean
  /** simulate the swap for an accurate compute-unit limit (recommended) */
  dynamicComputeUnitLimit?: boolean
  skipUserAccountsRpcCalls?: boolean
  asLegacyTransaction?: boolean
  destinationTokenAccount?: string
  prioritizationFeeLamports?: number | JupiterPrioritizationFee
}

/** The upstream swap-build response (the fields we consume, plus any extra keys). */
export interface JupiterSwapResponse {
  /** base64-serialized unsigned VersionedTransaction */
  swapTransaction: string
  lastValidBlockHeight: number
  prioritizationFeeLamports?: unknown
  simulationError?: unknown
  [key: string]: unknown
}
