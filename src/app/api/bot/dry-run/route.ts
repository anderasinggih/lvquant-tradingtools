import { connection, NextResponse } from "next/server"

import { getDryRunEngine, type DryRunOptions } from "@/lib/bot/dry-run"
import type { CircuitBreakerConfig } from "@/lib/risk/circuit-breaker"
import type { PositionExitConfig } from "@/lib/risk/positions"
import { messageOf } from "@/lib/solana/errors"

/* Dry-run control (Fase 6.1): start / inspect / stop the background paper-trading loop that runs on
   the REAL live Jupiter price with no transaction sent. POST starts it (optional JSON options), GET
   returns the live state + log, DELETE stops it. `connection()` marks the handlers request-time so
   Cache Components never prerenders them. */

const NO_STORE = { "Cache-Control": "no-store" } as const

function parseOptions(body: Record<string, unknown>): DryRunOptions {
  const options: DryRunOptions = {}
  if (body.intervalMs !== undefined) options.intervalMs = Number(body.intervalMs)
  if (body.maxTicks !== undefined && body.maxTicks !== null) options.maxTicks = Number(body.maxTicks)
  if (body.notionalUsd !== undefined) options.notionalUsd = Number(body.notionalUsd)
  if (body.maxLogEntries !== undefined) options.maxLogEntries = Number(body.maxLogEntries)
  if (body.exitConfig && typeof body.exitConfig === "object") {
    options.exitConfig = body.exitConfig as PositionExitConfig
  }
  if (body.circuitBreakerConfig && typeof body.circuitBreakerConfig === "object") {
    options.circuitBreakerConfig = body.circuitBreakerConfig as CircuitBreakerConfig
  }
  return options
}

export async function POST(request: Request) {
  await connection()
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const state = getDryRunEngine().start(parseOptions(body ?? {}))
    return NextResponse.json(state, { status: 200, headers: NO_STORE })
  } catch (err) {
    return NextResponse.json({ error: messageOf(err) }, { status: 400, headers: NO_STORE })
  }
}

export async function GET() {
  await connection()
  return NextResponse.json(getDryRunEngine().state(), { status: 200, headers: NO_STORE })
}

export async function DELETE() {
  await connection()
  return NextResponse.json(getDryRunEngine().stop("manual (api)"), { status: 200, headers: NO_STORE })
}
