import { NextResponse } from "next/server"
import { getActiveDriftPositions, openPerpPosition } from "@/lib/drift/perps"
import { isWalletConfigured } from "@/lib/solana/wallet"

export async function GET() {
  if (!isWalletConfigured()) {
    return NextResponse.json(
      { error: "Wallet not configured in .env" },
      { status: 503 }
    )
  }

  try {
    const positions = await getActiveDriftPositions()
    return NextResponse.json({
      status: "ok",
      positions,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

export async function POST(req: Request) {
  if (!isWalletConfigured()) {
    return NextResponse.json(
      { error: "Wallet not configured in .env" },
      { status: 503 }
    )
  }

  try {
    const body = (await req.json()) as {
      direction?: "LONG" | "SHORT"
      amountSol?: number
      marketIndex?: number
      leverage?: number
    }

    if (!body.direction || (body.direction !== "LONG" && body.direction !== "SHORT")) {
      return NextResponse.json(
        { error: "Invalid direction: must be LONG or SHORT" },
        { status: 400 }
      )
    }

    if (!body.amountSol || body.amountSol <= 0) {
      return NextResponse.json(
        { error: "Invalid amountSol: must be positive number" },
        { status: 400 }
      )
    }

    const result = await openPerpPosition({
      direction: body.direction,
      amountSol: body.amountSol,
      marketIndex: body.marketIndex ?? 0,
      leverage: body.leverage ?? 1,
    })

    return NextResponse.json({
      status: "ok",
      result,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
