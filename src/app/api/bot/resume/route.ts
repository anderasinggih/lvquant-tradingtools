import { connection, NextResponse } from "next/server"

import { getBotController } from "@/lib/bot/controller"

/* Resume the bot (Fase 5.4): latch the run-state to RUNNING and issue a fresh trading-loop signal.
   `connection()` marks the handler request-time. */

const NO_STORE = { "Cache-Control": "no-store" } as const

export async function POST() {
  await connection()
  const bot = getBotController()
  return NextResponse.json(
    { ...bot.resume(), positions: bot.listPositions() },
    { status: 200, headers: NO_STORE },
  )
}
