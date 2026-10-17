import { connection, NextResponse } from "next/server"

import { QuoteError, getQuote, type GetQuoteOptions } from "@/lib/jupiter/quote"
import { RpcRequestError } from "@/lib/solana/errors"

/* Jupiter Quote API V1 — the best swap route for a pair/amount (Fase 4.1). Read-only and keyless
   (the optional `JUPITER_API_KEY` only raises the rate limit). An invalid request or an unusable
   quote returns an explicit error; the route never fabricates a quote (Rules §1 / §2).
   `connection()` marks the handler request-time so Cache Components never prerenders it. */

const NO_STORE = { "Cache-Control": "no-store" } as const

export async function GET(request: Request) {
  await connection()

  const params = new URL(request.url).searchParams
  const inputMint = params.get("inputMint")
  const outputMint = params.get("outputMint")
  const amount = params.get("amount")
  const slippageParam = params.get("slippageBps")

  if (!inputMint || !outputMint || !amount || slippageParam === null) {
    return NextResponse.json(
      { error: "inputMint, outputMint, amount and slippageBps are required" },
      { status: 400, headers: NO_STORE },
    )
  }

  const slippageBps = Number(slippageParam)
  const swapMode = params.get("swapMode")
  const options: GetQuoteOptions = {}
  if (swapMode === "ExactIn" || swapMode === "ExactOut") options.swapMode = swapMode

  try {
    const quote = await getQuote(inputMint, outputMint, amount, slippageBps, options)
    return NextResponse.json(quote, { status: 200, headers: NO_STORE })
  } catch (err) {
    if (err instanceof QuoteError) {
      return NextResponse.json({ error: err.message }, { status: 400, headers: NO_STORE })
    }
    if (err instanceof RpcRequestError) {
      console.error(`[api/jupiter/quote] ${err.message}`)
      return NextResponse.json(
        {
          error: "Jupiter Quote API request failed",
          operation: err.operation,
          provider: err.provider,
          attempts: err.attempts,
          transient: err.transient,
          detail: err.message,
        },
        { status: 502, headers: NO_STORE },
      )
    }
    const detail = err instanceof Error ? err.message : String(err)
    console.error("[api/jupiter/quote] unexpected error:", detail)
    return NextResponse.json({ error: "Unexpected error", detail }, { status: 500, headers: NO_STORE })
  }
}
