import { connection, NextResponse } from "next/server"

import { getBotController } from "@/lib/bot/controller"
import { DEFAULT_CIRCUIT_BREAKER_CONFIG } from "@/lib/risk/circuit-breaker"

/* Bot run-state snapshot (Fase 5.4): status, open positions and the live circuit-breaker state, so
   the dashboard can render Pause / Resume and a panic control from real data. No caching — every
   read is current. `connection()` marks the handler request-time so Cache Components never prerenders
   it. */

const NO_STORE = { "Cache-Control": "no-store" } as const

export async function GET() {
  await connection()
  const bot = getBotController()
  return NextResponse.json(
    {
      ...bot.state(),
      positions: bot.listPositions(),
      circuitBreaker: bot.breaker.evaluate(Date.now(), DEFAULT_CIRCUIT_BREAKER_CONFIG),
    },
    { status: 200, headers: NO_STORE },
  )
}
