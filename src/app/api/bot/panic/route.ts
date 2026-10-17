import { connection, NextResponse } from "next/server"

import { getBotController } from "@/lib/bot/controller"
import { QuoteError } from "@/lib/jupiter/quote"
import { EnvConfigError, RpcRequestError } from "@/lib/solana/errors"
import { TransactionSubmitError } from "@/lib/solana/submit"

/* PANIC SELL (Fase 5.4): cancel the trading loop and liquidate every open position back into the
   quote asset via Jupiter. Read-only-safe — liquidations are executed one at a time and each returns
   its Solscan receipt. An empty/absent body is fine; an optional `{ "slippageBps": n }` overrides the
   panic slippage. `connection()` marks the handler request-time so Cache Components never prerenders
   it. Nothing here fabricates a fill: failures are reported with their reason (Rules §1 / §2). */

const NO_STORE = { "Cache-Control": "no-store" } as const

function errorResponse(err: unknown) {
  if (err instanceof EnvConfigError) {
    return NextResponse.json({ error: err.message }, { status: 503, headers: NO_STORE })
  }
  if (err instanceof TransactionSubmitError) {
    console.error(`[api/bot/panic] ${err.message}`)
    return NextResponse.json(
      { error: "Panic sell transaction failed", reason: err.reason, stage: err.stage, signature: err.signature },
      { status: 502, headers: NO_STORE },
    )
  }
  if (err instanceof QuoteError) {
    return NextResponse.json({ error: err.message }, { status: 400, headers: NO_STORE })
  }
  if (err instanceof RpcRequestError) {
    console.error(`[api/bot/panic] ${err.message}`)
    return NextResponse.json(
      {
        error: "Solana RPC request failed",
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
  console.error("[api/bot/panic] unexpected error:", detail)
  return NextResponse.json({ error: "Unexpected error", detail }, { status: 500, headers: NO_STORE })
}

export async function POST(request: Request) {
  await connection()

  let slippageBps: number | undefined
  const body = (await request.json().catch(() => null)) as { slippageBps?: unknown } | null
  if (body?.slippageBps !== undefined && body.slippageBps !== null) {
    const value = Number(body.slippageBps)
    if (!Number.isInteger(value) || value < 0 || value > 10_000) {
      return NextResponse.json(
        { error: "slippageBps must be an integer between 0 and 10000" },
        { status: 400, headers: NO_STORE },
      )
    }
    slippageBps = value
  }
  return runPanic(slippageBps)
}

async function runPanic(slippageBps: number | undefined) {
  try {
    const report = await getBotController().panicSell(slippageBps === undefined ? {} : { slippageBps })
    return NextResponse.json(report, { status: 200, headers: NO_STORE })
  } catch (err) {
    return errorResponse(err)
  }
}
