import { connection, NextResponse } from "next/server"

import { getBotController, type QuantBotConfig } from "@/lib/bot/controller"
import { messageOf } from "@/lib/solana/errors"

/* Bot configuration endpoint (GET: read current config, POST: update active bot parameters).
   Changes take effect immediately on the singleton BotController, affecting:
   - Strategy selection (EMA Trend, Mean Reversion, Breakout)
   - Execution Venue (Jupiter Spot vs Drift Perpetual Futures)
   - Drift Leverage (1x up to 50x)
   - Position sizing (% of portfolio balance)
   - Stop Loss, Take Profit, and Trailing Stop rules
   - Max Slippage BPS
   - 24h Circuit Breaker daily loss limit threshold
   - Trading mode (Dry-run paper trading vs Live Mainnet)
   Zero dummy: changes directly update active controller state. */

const NO_STORE = { "Cache-Control": "no-store" } as const

export async function GET() {
  await connection()
  const bot = getBotController()
  return NextResponse.json(bot.getConfig(), { status: 200, headers: NO_STORE })
}

export async function POST(request: Request) {
  await connection()
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<QuantBotConfig>
    const bot = getBotController()

    // Validate numeric ranges to guarantee capital safety (Rules §5)
    const patch: Partial<QuantBotConfig> = {}

    if (body.pair !== undefined) {
      if (typeof body.pair !== "string" || !body.pair.endsWith("/USDC")) {
        return NextResponse.json({ error: "Invalid trading pair format (e.g. SOL/USDC)" }, { status: 400, headers: NO_STORE })
      }
      patch.pair = body.pair.toUpperCase()
    }

    if (body.strategy !== undefined) {
      if (!["EMA Trend", "Mean Reversion", "Breakout"].includes(body.strategy)) {
        return NextResponse.json({ error: "Invalid strategy" }, { status: 400, headers: NO_STORE })
      }
      patch.strategy = body.strategy
    }

    if (body.venue !== undefined) {
      if (!["Jupiter Spot", "Drift Perp"].includes(body.venue)) {
        return NextResponse.json({ error: "Invalid execution venue" }, { status: 400, headers: NO_STORE })
      }
      patch.venue = body.venue
    }

    if (body.leverage !== undefined) {
      const lev = Number(body.leverage)
      if (isNaN(lev) || lev < 1 || lev > 50) {
        return NextResponse.json({ error: "Leverage must be between 1 and 50" }, { status: 400, headers: NO_STORE })
      }
      patch.leverage = lev
    }

    if (body.sizePct !== undefined) {
      const sz = Number(body.sizePct)
      if (isNaN(sz) || sz <= 0 || sz > 50) {
        return NextResponse.json({ error: "Position size must be between 1% and 50%" }, { status: 400, headers: NO_STORE })
      }
      patch.sizePct = sz
    }

    if (body.stopLossPct !== undefined) {
      const sl = Number(body.stopLossPct)
      if (isNaN(sl) || sl <= 0 || sl > 25) {
        return NextResponse.json({ error: "Stop loss must be between 0.1% and 25%" }, { status: 400, headers: NO_STORE })
      }
      patch.stopLossPct = sl
    }

    if (body.takeProfitPct !== undefined) {
      const tp = Number(body.takeProfitPct)
      if (isNaN(tp) || tp <= 0 || tp > 100) {
        return NextResponse.json({ error: "Take profit must be between 0.5% and 100%" }, { status: 400, headers: NO_STORE })
      }
      patch.takeProfitPct = tp
    }

    if (body.trailingStopEnabled !== undefined) {
      patch.trailingStopEnabled = Boolean(body.trailingStopEnabled)
    }

    if (body.slippageBps !== undefined) {
      const slip = Number(body.slippageBps)
      if (isNaN(slip) || slip < 10 || slip > 500) {
        return NextResponse.json({ error: "Slippage must be between 10 and 500 bps" }, { status: 400, headers: NO_STORE })
      }
      patch.slippageBps = slip
    }

    if (body.dailyLossLimitUsd !== undefined) {
      const dl = Number(body.dailyLossLimitUsd)
      if (isNaN(dl) || dl < 10 || dl > 10000) {
        return NextResponse.json({ error: "Daily loss limit must be between $10 and $10,000" }, { status: 400, headers: NO_STORE })
      }
      patch.dailyLossLimitUsd = dl
    }

    if (body.mode !== undefined) {
      if (!["Dry-Run", "Live Mainnet"].includes(body.mode)) {
        return NextResponse.json({ error: "Invalid trading mode" }, { status: 400, headers: NO_STORE })
      }
      patch.mode = body.mode
    }

    const updated = bot.updateConfig(patch)
    return NextResponse.json({ ok: true, config: updated }, { status: 200, headers: NO_STORE })
  } catch (err) {
    return NextResponse.json({ error: messageOf(err) }, { status: 500, headers: NO_STORE })
  }
}
