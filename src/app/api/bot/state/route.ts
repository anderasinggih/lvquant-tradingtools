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
  const markPrice = dryRun.lastPrice && dryRun.lastPrice > 0 ? dryRun.lastPrice : 0

  const paperPositions =
    config.mode === "Dry-Run" && dryRun.openPosition
      ? [
          (() => {
            const entry = dryRun.openPosition.entryPriceUsd
            const current = markPrice > 0 ? markPrice : entry
            const pnlUsd = (current - entry) * dryRun.openPosition.baseAmount
            const pnlPct = entry > 0 ? ((current - entry) / entry) * 100 : 0
            const slPrice = entry * (1 - config.stopLossPct / 100)
            const tpPrice = entry * (1 + config.takeProfitPct / 100)
            const isArmed =
              config.trailingStopEnabled &&
              dryRun.openPosition.peakPriceUsd >= entry * (1 + config.trailingArmPct / 100)
            const trailingExit = isArmed
              ? dryRun.openPosition.peakPriceUsd * (1 - config.trailingOffsetPct / 100)
              : null

            return {
              id: dryRun.openPosition.id,
              pair: dryRun.openPosition.pair,
              baseSymbol: "SOL",
              quoteSymbol: "USDC",
              baseAmountRaw: "0",
              baseAmount: dryRun.openPosition.baseAmount,
              entryPriceUsd: entry,
              currentPriceUsd: current,
              entryNotionalUsd:
                Math.round(dryRun.openPosition.baseAmount * entry * 100) / 100,
              currentNotionalUsd:
                Math.round(dryRun.openPosition.baseAmount * current * 100) / 100,
              unrealizedPnlUsd: Math.round(pnlUsd * 100) / 100,
              unrealizedPnlPct: Math.round(pnlPct * 100) / 100,
              stopLossPriceUsd: Math.round(slPrice * 100) / 100,
              takeProfitPriceUsd: Math.round(tpPrice * 100) / 100,
              trailingArmed: isArmed,
              trailingExitPriceUsd: trailingExit ? Math.round(trailingExit * 100) / 100 : null,
              peakPriceUsd: dryRun.openPosition.peakPriceUsd,
              openedAt: dryRun.openPosition.openedAt,
            }
          })(),
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

