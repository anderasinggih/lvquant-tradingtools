import { connection, NextResponse } from "next/server"

import { fetchJupiterPrices } from "@/lib/market/jupiter"
import { TRACKED_TOKENS } from "@/lib/market/tokens"

/* Live price & 24h ticker feed for all tracked Solana tokens and meme coins (Fase 3).
   Queries Jupiter Price API V3 for the canonical token mints.
   Strict zero-mock rule: only tokens with live on-chain quotes are returned. */

const NO_STORE = { "Cache-Control": "no-store" } as const

export async function GET() {
  await connection()
  try {
    const mints = TRACKED_TOKENS.map((t) => t.mint)
    const prices = await fetchJupiterPrices(mints)

    const tickers = TRACKED_TOKENS.map((t) => {
      const q = prices[t.mint]
      const price = q?.usdPrice ?? 0
      const change = q?.priceChange24h ?? 0
      return {
        symbol: t.symbol,
        name: t.name,
        mint: t.mint,
        price,
        change,
        color: t.color,
        decimals: t.decimals,
      }
    }).filter((t) => t.price > 0)

    return NextResponse.json({ tickers, fetchedAt: new Date().toISOString() }, { status: 200, headers: NO_STORE })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error("[api/market/tickers] error:", detail)
    return NextResponse.json({ error: "Failed to fetch market tickers", detail }, { status: 502, headers: NO_STORE })
  }
}
