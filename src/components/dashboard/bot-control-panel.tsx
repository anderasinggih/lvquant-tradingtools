"use client"

import { useCallback, useEffect, useState } from "react"

import { Panel } from "@/components/dashboard/panel"
import { BUTTON } from "@/components/ui/control-classes"
import { cn } from "@/lib/utils"

/* Emergency control panel (Fase 5.4): Pause / Resume the bot and a two-step PANIC SELL that cancels
   the trading loop and liquidates every open position back into the quote (SOL/USDC) via the real
   Jupiter execution path. The panel reads its state from `/api/bot/state` and shows each liquidation's
   on-chain Solscan receipt — no mock, no optimistic "closed" without a real signature (Rules §1). */

interface PositionView {
  id: string
  pair: string
  baseSymbol: string
  quoteSymbol: string
  baseAmount: number
}

interface CircuitBreakerView {
  status: "ACTIVE" | "CIRCUIT_BREAKER_TRIPPED"
  rollingLossUsd: number
  thresholdUsd: number
  lockedUntil: number | null
}

interface BotStatePayload {
  status: "RUNNING" | "PAUSED"
  running: boolean
  openPositions: number
  lastPauseReason: string | null
  lastPanicAt: string | null
  updatedAt: string
  positions: PositionView[]
  circuitBreaker: CircuitBreakerView
}

interface LiquidationView {
  positionId: string
  pair: string
  baseSymbol: string
  quoteSymbol: string
  proceedsUsd: number
  realizedPnlUsd: number
  realizedPnlPct: number
  signature: string
  explorerUrl: string
}

interface PanicSellFailure {
  positionId: string
  pair: string
  error: string
}

interface PanicReport {
  attempted: number
  closed: LiquidationView[]
  failures: PanicSellFailure[]
  startedAt: string
  finishedAt: string
}

const DOWN = "var(--chart-down)"
const UP = "var(--chart-up)"

const usd = (n: number) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const DANGER_BUTTON =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-[12px] font-medium outline-none transition-[background-color,color,scale] duration-150 focus-visible:ring-2 focus-visible:ring-foreground/25 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 motion-reduce:active:scale-100"

async function fetchState(signal?: AbortSignal): Promise<BotStatePayload> {
  const res = await fetch("/api/bot/state", { signal, cache: "no-store" })
  const body = (await res.json().catch(() => null)) as (BotStatePayload & { error?: string; detail?: string }) | null
  if (!res.ok) {
    throw new Error(body?.error ? `${body.error}${body.detail ? `: ${body.detail}` : ""}` : `Bot state HTTP ${res.status}`)
  }
  if (!body) throw new Error("Bot state returned an empty response")
  return body
}

async function postAction(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(path, { method: "POST", cache: "no-store" })
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok) {
    const message = typeof body?.error === "string" ? body.error : `Bot control responded HTTP ${res.status}`
    throw new Error(message)
  }
  return body ?? {}
}

export function BotControlPanel({ className }: { className?: string }) {
  const [state, setState] = useState<BotStatePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<"pause" | "resume" | "panic" | null>(null)
  const [armed, setArmed] = useState(false)
  const [report, setReport] = useState<PanicReport | null>(null)

  const refresh = useCallback(async () => {
    try {
      setState(await fetchState())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined

    const tick = async () => {
      controller = new AbortController()
      try {
        const next = await fetchState(controller.signal)
        if (!stopped) {
          setState(next)
          setError(null)
        }
      } catch (err) {
        if (!stopped && !controller.signal.aborted) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (!stopped && !document.hidden) timer = setTimeout(tick, 5000)
      }
    }

    void tick()
    const onVisible = () => {
      if (!document.hidden && !stopped) void tick()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      stopped = true
      controller?.abort()
      if (timer) clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  const control = useCallback(
    async (path: string, action: "pause" | "resume" | "panic") => {
      setBusy(action)
      setError(null)
      try {
        const body = await postAction(path)
        if (action === "panic") setReport(body as unknown as PanicReport)
        setArmed(false)
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(null)
      }
    },
    [refresh],
  )

  return (
    <Panel
      title="Emergency control"
      className={className}
      action={
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-foreground/90">
          <span
            className="inline-block size-1.5 rounded-full"
            style={{ backgroundColor: state?.running ? UP : "color-mix(in srgb, var(--foreground) 35%, transparent)" }}
          />
          {state ? state.status : "—"}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 tabular-nums">
          <Stat label="Open positions" value={String(state?.openPositions ?? 0)} />
          <Stat label="Realized loss (24h)" value={usd(state?.circuitBreaker.rollingLossUsd ?? 0)} />
          <Stat label="Loss limit" value={usd(state?.circuitBreaker.thresholdUsd ?? 0)} />
          {state?.lastPauseReason ? <Stat label="Last pause reason" value={state.lastPauseReason} /> : null}
        </div>

        {state?.circuitBreaker.status === "CIRCUIT_BREAKER_TRIPPED" ? (
          <p className="text-[11.5px] font-medium" style={{ color: DOWN }}>
            Circuit breaker tripped
            {state.circuitBreaker.lockedUntil
              ? ` — buy block until ${new Date(state.circuitBreaker.lockedUntil).toLocaleString()}`
              : ""}
            .
          </p>
        ) : null}

        {error ? (
          <p className="font-mono text-[11px]" style={{ color: DOWN }} role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={cn(BUTTON, "h-8 px-3 text-[12px]")}
            disabled={busy !== null || !state}
            onClick={() => void control(state?.running ? "/api/bot/pause" : "/api/bot/resume", state?.running ? "pause" : "resume")}
          >
            {busy === "pause" || busy === "resume" ? "Working…" : state?.running ? "Pause bot" : "Resume bot"}
          </button>

          {armed ? (
            <>
              <button
                type="button"
                className={DANGER_BUTTON}
                style={{ backgroundColor: DOWN, color: "var(--background)" }}
                disabled={busy !== null}
                onClick={() => void control("/api/bot/panic", "panic")}
              >
                {busy === "panic"
                  ? "Liquidating…"
                  : `Confirm — liquidate ${state?.openPositions ?? 0} position${state?.openPositions === 1 ? "" : "s"}`}
              </button>
              <button
                type="button"
                className={cn(DANGER_BUTTON, "hover:bg-foreground/[0.06]")}
                style={{ color: "var(--foreground)" }}
                disabled={busy !== null}
                onClick={() => setArmed(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className={cn(DANGER_BUTTON, "hover:brightness-110")}
              style={{ backgroundColor: "color-mix(in srgb, var(--chart-down) 14%, transparent)", color: DOWN }}
              disabled={busy !== null || !state}
              onClick={() => setArmed(true)}
            >
              PANIC SELL
            </button>
          )}
        </div>

        {report ? <PanicResult report={report} /> : null}
      </div>
    </Panel>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10.5px] text-foreground/45">{label}</p>
      <p className="mt-0.5 text-[13px] text-foreground/90">{value}</p>
    </div>
  )
}

function PanicResult({ report }: { report: PanicReport }) {
  return (
    <div
      className="rounded-[16px] border border-foreground/[0.06] px-3 py-2.5"
      role="status"
      aria-live="polite"
    >
      <p className="text-[11.5px] text-foreground/90">
        Panic sell finished — {report.closed.length} of {report.attempted} position
        {report.attempted === 1 ? "" : "s"} liquidated
        {report.failures.length > 0 ? `, ${report.failures.length} failed` : ""}.
      </p>

      {report.closed.length > 0 ? (
        <ul className="mt-2 divide-y divide-foreground/[0.06]">
          {report.closed.map((fill) => (
            <li key={fill.positionId} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block text-[12px] text-foreground/90">
                  {fill.pair} → {fill.quoteSymbol}
                </span>
                <span className="block text-[10.5px] text-foreground/45">
                  Proceeds {usd(fill.proceedsUsd)} · PnL{" "}
                  <span style={{ color: fill.realizedPnlUsd >= 0 ? UP : DOWN }}>
                    {usd(fill.realizedPnlUsd)} ({fill.realizedPnlPct.toFixed(2)}%)
                  </span>
                </span>
              </span>
              <a
                href={fill.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 font-mono text-[11px] text-foreground/60 underline decoration-foreground/20 underline-offset-2 hover:text-foreground/90"
              >
                Solscan ↗
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {report.failures.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {report.failures.map((failure) => (
            <li key={failure.positionId} className="font-mono text-[11px]" style={{ color: DOWN }}>
              {failure.pair}: {failure.error}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
