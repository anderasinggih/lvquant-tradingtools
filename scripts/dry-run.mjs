#!/usr/bin/env node
/* Dry-run CLI (Fase 6.1). Starts the server-side dry-run loop (real live Jupiter price, no
   transaction sent), streams its log to the terminal, and prints a summary. The loop itself runs
   inside the Next.js server (where the `@/…` module aliases resolve); this script is a thin client.

   Usage:
     npm run dry-run -- --ticks 10 --interval 3000
     node scripts/dry-run.mjs --url http://localhost:3000 --ticks 20 --sl 1 --tp 2 --max-loss 10

   Requires the app to be running:  npm run dev   (or)   npm run build && npm run start   */

const argv = process.argv.slice(2)

function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`)
  if (i !== -1 && argv[i + 1] !== undefined) return argv[i + 1]
  const inline = argv.find((a) => a.startsWith(`--${name}=`))
  return inline ? inline.slice(name.length + 3) : fallback
}

const BASE = (flag("url", process.env.DRY_RUN_URL) || "http://localhost:3000").replace(/\/$/, "")
const TICKS = flag("ticks", null)
const TIMEOUT_MS = Number(flag("timeout", "120000"))
const POLL_MS = Number(flag("poll", "1000"))

const num = (v) => (v === null || v === undefined || v === "" ? undefined : Number(v))

const options = {
  intervalMs: num(flag("interval", "3000")),
  notionalUsd: num(flag("notional", "20")),
}
if (TICKS !== null) options.maxTicks = Number(TICKS)

const exitConfig = {}
if (num(flag("sl")) !== undefined) exitConfig.stopLossPct = num(flag("sl"))
if (num(flag("tp")) !== undefined) exitConfig.takeProfitPct = num(flag("tp"))
if (num(flag("trailing-start")) !== undefined) exitConfig.trailingStartPct = num(flag("trailing-start"))
if (num(flag("trailing-stop")) !== undefined) exitConfig.trailingStopPct = num(flag("trailing-stop"))
if (Object.keys(exitConfig).length > 0) options.exitConfig = exitConfig

const cbConfig = {}
if (num(flag("max-loss")) !== undefined) cbConfig.maxLossUsd = num(flag("max-loss"))
if (num(flag("max-loss-pct")) !== undefined) cbConfig.maxLossPct = num(flag("max-loss-pct"))
if (num(flag("capital")) !== undefined) cbConfig.capitalUsd = num(flag("capital"))
if (Object.keys(cbConfig).length > 0) options.circuitBreakerConfig = cbConfig

const COLOR = {
  info: "\x1b[2m",
  trade: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  reset: "\x1b[0m",
}
const paint = (level, text) => `${COLOR[level] ?? ""}${text}${COLOR.reset}`

async function main() {
  let started
  try {
    const res = await fetch(`${BASE}/api/bot/dry-run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
    started = body
  } catch (err) {
    console.error(`\nCould not start the dry-run at ${BASE}.`)
    console.error(`Is the app running?  npm run dev   (or)   npm run build && npm run start`)
    console.error(`Detail: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }

  console.log(`\nDry-run started at ${BASE}`)
  console.log(`  SOL/USDC · every ${options.intervalMs}ms · notional $${options.notionalUsd}${options.maxTicks ? ` · ${options.maxTicks} ticks` : ""}`)
  console.log(`  (paper trading on the live Jupiter price — no transaction is ever sent)\n`)

  const deadline = Date.now() + TIMEOUT_MS
  let seen = 0
  let latest = started

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    let state
    try {
      const res = await fetch(`${BASE}/api/bot/dry-run`, { cache: "no-store" })
      state = await res.json()
      if (!res.ok) throw new Error(state?.error ?? `HTTP ${res.status}`)
    } catch (err) {
      console.error(paint("error", `poll failed: ${err instanceof Error ? err.message : String(err)}`))
      continue
    }
    latest = state
    for (const entry of state.log.slice(seen)) {
      const stamp = new Date(entry.at).toLocaleTimeString("en-US", { hour12: false })
      console.log(`${paint(entry.level, `${stamp} ${entry.level.toUpperCase().padEnd(5)} ${entry.message}`)}`)
    }
    seen = state.log.length
    if (state.status !== "RUNNING") break
  }

  const c = latest.counters
  console.log(`\nSummary — status ${latest.status}`)
  console.log(`  ticks ${c.ticks} · entries ${c.entries} · exits ${c.exits} (SL ${c.stopLoss} / TP ${c.takeProfit} / trail ${c.trailingStop})`)
  console.log(`  blocked buys ${c.blockedBuys} · price errors ${c.priceErrors} · circuit breaker ${latest.circuitBreaker?.status}`)
  if (latest.trades?.length) {
    console.log(`  trades:`)
    for (const t of latest.trades) {
      console.log(`    ${t.exitReason.padEnd(13)} entry ${t.entryPriceUsd} → exit ${t.exitPriceUsd}  PnL ${t.pnlUsd.toFixed(2)} (${t.pnlPct.toFixed(2)}%)`)
    }
  }
  if (latest.lastError) console.log(paint("error", `  last error: ${latest.lastError}`))

  const ok = c.priceErrors === 0 && !latest.lastError
  console.log(ok ? paint("trade", "\nDry-run finished with no errors.\n") : paint("warn", "\nDry-run finished with warnings.\n"))

  if (latest.status === "RUNNING") {
    await fetch(`${BASE}/api/bot/dry-run`, { method: "DELETE" }).catch(() => {})
  }
  process.exit(ok ? 0 : 2)
}

void main()
