import { connection, NextResponse } from "next/server"

import { getBotController } from "@/lib/bot/controller"
import { getDryRunEngine } from "@/lib/bot/dry-run"
import { DEFAULT_CIRCUIT_BREAKER_CONFIG } from "@/lib/risk/circuit-breaker"

/* Bot run-state snapshot (Fase 5.4): status, open positions and the live circuit-breaker state, so
   the dashboard can render Pause / Resume and emergency controls from real data. Evaluates the
   configured daily loss limit dynamically. */

const NO_STORE = { "Cache-Control": "no-store" } as const

export async function GET() {
  await connection()
  const bot = getBotController()
  const config = bot.getConfig()
  const dryRun = getDryRunEngine().state()

  const livePositions = bot.listPositions()
  const paperPositions =
    config.mode === "Dry-Run" && dryRun.openPosition
      ? [
          {
            id: dryRun.openPosition.id,
            pair: dryRun.openPosition.pair,
            baseSymbol: "SOL",
            quoteSymbol: "USDC",
            baseAmountRaw: "0",
            baseAmount: dryRun.openPosition.baseAmount,
            entryPriceUsd: dryRun.openPosition.entryPriceUsd,
            entryNotionalUsd:
              Math.round(dryRun.openPosition.baseAmount * dryRun.openPosition.entryPriceUsd * 100) / 100,
            peakPriceUsd: dryRun.openPosition.peakPriceUsd,
            openedAt: dryRun.openPosition.openedAt,
          },
        ]
      : []

  const allPositions = [...livePositions, ...paperPositions]

  const effectiveBreaker =
    config.mode === "Dry-Run" && dryRun.running
      ? dryRun.circuitBreaker
      : bot.breaker.evaluate(Date.now(), {
          ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
          maxLossUsd: config.dailyLossLimitUsd,
        })

  return NextResponse.json(
    {
      ...bot.state(),
      openPositions: allPositions.length,
      positions: allPositions,
      circuitBreaker: effectiveBreaker,
      trades: config.mode === "Dry-Run" ? dryRun.trades : [],
    },
    { status: 200, headers: NO_STORE },
  )
}

