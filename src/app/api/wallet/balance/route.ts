import { connection, NextResponse } from "next/server"

import { EnvConfigError, RpcRequestError } from "@/lib/solana/errors"
import { getSolBalance } from "@/lib/solana/wallet"

/* Reads the real SOL balance of the bot wallet. No caching, no fallback: a missing key or a
   dead RPC returns an explicit error, never a number. (Rules §1 / §2.)
   `connection()` marks the handler request-time so Cache Components never prerenders it. */

function errorResponse(err: unknown) {
  if (err instanceof EnvConfigError) {
    return NextResponse.json({ error: err.message }, { status: 503 })
  }
  if (err instanceof RpcRequestError) {
    console.error(`[api/wallet/balance] ${err.message}`)
    return NextResponse.json(
      {
        error: "Solana RPC request failed",
        operation: err.operation,
        provider: err.provider,
        attempts: err.attempts,
        transient: err.transient,
        detail: err.message,
      },
      { status: 502 },
    )
  }
  const detail = err instanceof Error ? err.message : String(err)
  console.error("[api/wallet/balance] unexpected error:", detail)
  return NextResponse.json({ error: "Unexpected error", detail }, { status: 500 })
}

export async function GET() {
  await connection()
  try {
    const balance = await getSolBalance()
    return NextResponse.json(balance, { status: 200 })
  } catch (err) {
    return errorResponse(err)
  }
}
