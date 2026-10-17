import { connection, NextResponse } from "next/server"

import { getMarketHistory } from "@/lib/market/history"
import { RpcRequestError } from "@/lib/solana/errors"

/* Real per-timeframe SOL/USDC history for the price chart (Fase 3.2), from Binance public Klines —
   keyless and free. No caching and no fallback: an upstream failure returns an explicit error so the
   UI shows its disconnected state instead of a fabricated series (Rules §1 / §2).
   `connection()` marks the handler request-time so Cache Components never prerenders it. */

const NO_STORE = { "Cache-Control": "no-store" } as const

export async function GET() {
  await connection()
  try {
    const history = await getMarketHistory()
    return NextResponse.json(history, { status: 200, headers: NO_STORE })
  } catch (err) {
    if (err instanceof RpcRequestError) {
      console.error(`[api/market/history] ${err.message}`)
      return NextResponse.json(
        {
          error: "Binance Klines request failed",
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
    console.error("[api/market/history] unexpected error:", detail)
    return NextResponse.json({ error: "Unexpected error", detail }, { status: 500, headers: NO_STORE })
  }
}
