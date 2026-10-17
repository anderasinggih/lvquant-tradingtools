import { connection, NextResponse } from "next/server"

import { getRpcStatus } from "@/lib/solana/connection"
import { EnvConfigError, RpcRequestError } from "@/lib/solana/errors"

/* Live RPC health probe — exposes the configured provider and current slot/version, or a
   transparent failure. Used by the dashboard to decide between live data and the disconnected
   state. No caching, no fabricated values. `connection()` keeps it request-time. */

export async function GET() {
  await connection()
  try {
    const status = await getRpcStatus()
    return NextResponse.json(status, { status: 200 })
  } catch (err) {
    if (err instanceof EnvConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    if (err instanceof RpcRequestError) {
      console.error(`[api/rpc/status] ${err.message}`)
      return NextResponse.json(
        {
          error: "Solana RPC request failed",
          operation: err.operation,
          provider: err.provider,
          attempts: err.attempts,
          transient: err.transient,
          detail: err.message,
        },
        { status: 502 },
      )
    }
    const detail = err instanceof Error ? err.message : String(err)
    console.error("[api/rpc/status] unexpected error:", detail)
    return NextResponse.json({ error: "Unexpected error", detail }, { status: 500 })
  }
}
