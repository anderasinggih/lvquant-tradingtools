import { connection, NextResponse } from "next/server"

import { MissingPriceError, getLiveMarketPrice } from "@/lib/market/price-feed"
import { RpcRequestError } from "@/lib/solana/errors"

/* Live SOL/USDC price from the Jupiter Price API V3, for the dashboard feed.
   No caching and no fallback: an upstream failure returns an explicit error so the UI can show
   its disconnected state instead of a stale or invented number.
   `connection()` marks the handler request-time so Cache Components never prerenders it. */

const NO_STORE = { "Cache-Control": "no-store" } as const

export async function GET() {
  await connection()
  try {
    const price = await getLiveMarketPrice()
    return NextResponse.json(price, { status: 200, headers: NO_STORE })
  } catch (err) {
    if (err instanceof MissingPriceError) {
      return NextResponse.json({ error: err.message, missing: err.mints }, { status: 502, headers: NO_STORE })
    }
    if (err instanceof RpcRequestError) {
      console.error(`[api/market/price] ${err.message}`)
      return NextResponse.json(
        {
          error: "Jupiter Price API request failed",
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
    console.error("[api/market/price] unexpected error:", detail)
    return NextResponse.json({ error: "Unexpected error", detail }, { status: 500, headers: NO_STORE })
  }
}
