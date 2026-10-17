#!/usr/bin/env node
/* Micro test-swap CLI (Fase 6.2). Performs ONE real, tiny swap (default 0.005 SOL → USDC) through the
   server-side engine (where the Solana/@-alias modules live) and prints the full audit trail: Jupiter
   quote, priority fee, signed-tx size, Solscan receipt and the SOL/USDC balance change.

   The server (`npm run dev` / `npm run build && npm run start`) must be running, and `.env` must hold
   SOLANA_RPC_URL + SOLANA_PRIVATE_KEY (a dedicated, low-balance wallet).

   Usage:
     npm run micro-swap                       # preflight + prompt, then 0.005 SOL
     npm run micro-swap -- --dry-run          # preflight only, never swaps
     npm run micro-swap -- --yes              # skip the confirmation prompt
     npm run micro-swap -- --amount 0.005 --slippage 100 --max-priority 100000 --reserve 20000000  */

import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"

const argv = process.argv.slice(2)
const hasFlag = (name) => argv.includes(`--${name}`)
function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`)
  if (i !== -1 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) return argv[i + 1]
  const inline = argv.find((a) => a.startsWith(`--${name}=`))
  return inline ? inline.slice(name.length + 3) : fallback
}

const BASE = (flag("url", process.env.MICRO_SWAP_URL) || "http://localhost:3000").replace(/\/$/, "")
const DRY_RUN = hasFlag("dry-run")
const ASSUME_YES = hasFlag("yes") || hasFlag("y")

const num = (v) => (v === undefined || v === null || v === "" ? undefined : Number(v))
const payload = { confirm: true }
if (num(flag("amount")) !== undefined) payload.amountSol = num(flag("amount"))
if (num(flag("slippage")) !== undefined) payload.slippageBps = num(flag("slippage"))
if (num(flag("max-priority")) !== undefined) payload.maxPriorityLamports = num(flag("max-priority"))
if (num(flag("reserve")) !== undefined) payload.reserveLamports = num(flag("reserve"))
if (num(flag("max-impact")) !== undefined) payload.maxPriceImpactPercent = num(flag("max-impact"))

const sol = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(9)} SOL`
const usdc = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(6)} USDC`
const lamports = (n) => `${n.toLocaleString("en-US")} lamports`

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

async function main() {
  console.log(`\nMicro test-swap → ${BASE}`)

  let preflight
  try {
    preflight = await getJson("/api/bot/micro-swap")
  } catch (err) {
    console.error(`\nCould not reach the server at ${BASE}.`)
    console.error(`Start it first:  npm run dev   (or)   npm run build && npm run start`)
    console.error(`Detail: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }

  const p = preflight.body
  if (!p.configured) {
    console.error(`\nNot ready: ${p.reason}\n`)
    process.exit(1)
  }
  console.log(`  wallet   ${p.wallet}`)
  console.log(`  network  ${p.cluster} via ${p.provider}`)
  console.log(`  SOL      ${p.balances.sol} (${lamports(p.balances.solLamports)})`)
  console.log(`  USDC     ${p.balances.usdc}${p.ataExists ? "" : "  (no ATA yet — rent will be charged)"}`)
  console.log(`  need     ≥ ${lamports(p.requiredLamports)} for 0.005 SOL + fees + rent + reserve`)

  if (!p.ready) {
    console.error(`\nNot ready: ${p.reason}\n`)
    process.exit(1)
  }

  if (DRY_RUN) {
    console.log("\n--dry-run: preflight OK, no swap was sent.\n")
    process.exit(0)
  }

  const amount = payload.amountSol ?? 0.005
  console.log(`\nYou are about to send 1 REAL on-chain swap: ${amount} SOL → USDC.`)
  console.log("This spends real funds and cannot be undone.")

  if (!ASSUME_YES) {
    const rl = createInterface({ input, output })
    const answer = (await rl.question('Type "swap" to confirm: ')).trim().toLowerCase()
    rl.close()
    if (answer !== "swap") {
      console.log("Aborted — nothing sent.\n")
      process.exit(0)
    }
  }

  console.log("\nSubmitting…")
  let res
  try {
    const r = await fetch(`${BASE}/api/bot/micro-swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
    res = { status: r.status, body: await r.json().catch(() => ({})) }
  } catch (err) {
    console.error(`\nRequest failed: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }

  const b = res.body
  if (!b.ok) {
    console.error(`\nSWAP FAILED [${b.code ?? "error"}]${b.stage ? ` during ${b.stage}` : ""}: ${b.error}`)
    if (b.balanceBefore) console.error(`  balance before  ${b.balanceBefore.sol} SOL · ${b.balanceBefore.usdc} USDC`)
    if (b.balanceAfter) console.error(`  balance after   ${b.balanceAfter.sol} SOL · ${b.balanceAfter.usdc} USDC`)
    if (b.explorerUrl) console.error(`  receipt         ${b.explorerUrl}`)
    console.error("")
    process.exit(res.status >= 500 ? 2 : 1)
  }

  console.log("\n─ Jupiter quote ─────────────────────────────────────────")
  console.log(`  in       ${b.quote.inAmount} (raw) = ${b.input.amount} SOL`)
  console.log(`  out      ${b.quote.outAmount} (raw) = ${b.output.amount} USDC`)
  console.log(`  min out  ${b.quote.otherAmountThreshold} (slippage ${b.quote.slippageBps} bps)`)
  console.log(`  impact   ${b.quote.priceImpactPercent.toFixed(4)}%   best route: ${b.quote.bestRoute ? "yes" : "no"}`)
  console.log(`  route    ${b.quote.hops} hop(s) via ${b.quote.labels.join(", ") || "?"}`)
  if (b.quote.swapUsdValue !== null) console.log(`  value    ~$${b.quote.swapUsdValue.toFixed(4)}`)

  if (b.priorityFee) {
    console.log("\n─ Priority fee ──────────────────────────────────────────")
    console.log(`  ${b.priorityFee.lamports} lamports (${b.priorityFee.unitPriceMicroLamports} µlamports/CU × ${b.priorityFee.computeUnitLimit} CU)`)
    console.log(`  provider ${b.priorityFee.provider}${b.priorityFee.clamped ? "  (clamped)" : ""}`)
  }

  console.log("\n─ Signed transaction ────────────────────────────────────")
  console.log(`  fee payer ${b.transaction.feePayer}`)
  console.log(`  size      ${b.transaction.signedBytes} bytes (base64)`)
  console.log(`  signed    ${b.transaction.signedBase64.slice(0, 48)}…${b.transaction.signedBase64.slice(-24)}`)

  console.log("\n─ On-chain receipt ──────────────────────────────────────")
  console.log(`  signature ${b.transaction.signature}`)
  console.log(`  status    ${b.transaction.confirmationStatus} @ slot ${b.transaction.slot}`)
  console.log(`  solscan   ${b.transaction.explorerUrl}`)

  console.log("\n─ Balance change ────────────────────────────────────────")
  console.log(`  SOL   ${b.balanceBefore.sol} → ${b.balanceAfter.sol}   (${sol(b.delta.sol)}, ${lamports(b.delta.solLamports)})`)
  console.log(`  USDC  ${b.balanceBefore.usdc} → ${b.balanceAfter.usdc}   (${usdc(b.delta.usdc)}, raw ${b.delta.usdcRaw})`)
  console.log(`  guards  required ${lamports(b.guards.requiredLamports)} · tip ${lamports(b.guards.tipIncludedLamports)} · rent ${lamports(b.guards.ataRentIncludedLamports)} · reserve ${lamports(b.guards.reserveLamports)} · headroom ${lamports(b.guards.headroomLamports)}`)
  console.log(`  duration ${b.durationMs} ms`)

  console.log("\nMicro swap confirmed successfully.\n")
}

void main()
