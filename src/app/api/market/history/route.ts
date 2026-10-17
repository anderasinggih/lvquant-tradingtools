import { connection, NextResponse } from "next/server"

import { getMarketHistory } from "@/lib/market/history"
import { RpcRequestError } from "@/lib/solana/errors"

/* Real per-timeframe history for tracked pairs from Binance public Klines.
   Takes an optional `?token=BONK` or `?token=WIF` to fetch history for specific tokens. */

const NO_STORE = { "Cache-Control": "no-store" } as const

export async function GET(request: Request) {
  await connection()
  const { searchParams } = new URL(request.url)
  const token = searchParams.get("token") ?? "SOL"

  try {
    const history = await getMarketHistory(token)
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
