import { connection, NextResponse } from "next/server"

import { getBotController } from "@/lib/bot/controller"

/* Pause the bot (Fase 5.4): latch the run-state to PAUSED and abort the trading-loop signal so no new
   entries are opened. Idempotent. `connection()` marks the handler request-time. */

const NO_STORE = { "Cache-Control": "no-store" } as const

export async function POST() {
  await connection()
  const bot = getBotController()
  return NextResponse.json(
    { ...bot.pause("manual"), positions: bot.listPositions() },
    { status: 200, headers: NO_STORE },
  )
}
