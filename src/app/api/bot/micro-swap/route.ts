import { connection, NextResponse } from "next/server"

import { MicroSwapError, microSwapPreflight, runMicroSwap } from "@/lib/bot/micro-swap"
import type { MicroSwapStage } from "@/lib/bot/micro-swap"
import { messageOf } from "@/lib/solana/errors"

/* Micro test-swap (Fase 6.2). GET = read-only preflight (wallet, balances, readiness) so an operator
   can inspect everything before committing. POST = execute exactly ONE real swap — it is deliberately
   gated behind an explicit `{"confirm": true}` body so a stray request can never fire a trade.
   `connection()` keeps both handlers request-time (never prerendered). */

const NO_STORE = { "Cache-Control": "no-store" } as const

function toStatus(stage: MicroSwapStage): number {
  if (stage === "validate" || stage === "quote") return 400
  if (stage === "guard") return 422
  return 502
}

function num(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : NaN
}

export async function GET() {
  await connection()
  const status = await microSwapPreflight()
  return NextResponse.json(status, { status: 200, headers: NO_STORE })
}

export async function POST(request: Request) {
  await connection()

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json(
      { ok: false, code: "invalid_json", error: "request body must be JSON" },
      { status: 400, headers: NO_STORE },
    )
  }

  if (body.confirm !== true) {
    return NextResponse.json(
      {
        ok: false,
        code: "confirm_required",
        error:
          'refusing to swap: this endpoint executes a REAL on-chain trade — POST with {"confirm":true} (the CLI does this after you confirm).',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  try {
    const result = await runMicroSwap({
      amountSol: num(body.amountSol),
      slippageBps: num(body.slippageBps),
      maxPriorityLamports: num(body.maxPriorityLamports),
      reserveLamports: num(body.reserveLamports),
      maxPriceImpactPercent: num(body.maxPriceImpactPercent),
    })
    return NextResponse.json(result, { status: 200, headers: NO_STORE })
  } catch (err) {
    if (err instanceof MicroSwapError) {
      return NextResponse.json(
        {
          ok: false,
          code: err.code,
          stage: err.stage,
          error: err.message,
          balanceBefore: err.balanceBefore,
          balanceAfter: err.balanceAfter,
          signature: err.signature,
          explorerUrl: err.explorerUrl,
        },
        { status: toStatus(err.stage), headers: NO_STORE },
      )
    }
    return NextResponse.json(
      { ok: false, code: "unexpected", error: messageOf(err) },
      { status: 500, headers: NO_STORE },
    )
  }
}
