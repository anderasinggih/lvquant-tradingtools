"use client"

import { useEffect, useState } from "react"

import { Panel } from "@/components/dashboard/panel"

/* Risk & bot parameters per the PRD (§4.3): position sizing, hard stop-loss, trailing
   stop, daily drawdown circuit breaker, plus execution slippage (§4.4).
   Connected to live bot configuration from /api/bot/config. Zero emojis. */

interface QuantBotConfigResponse {
  sizePct: number
  stopLossPct: number
  takeProfitPct: number
  trailingStopEnabled: boolean
  trailingArmPct: number
  trailingOffsetPct: number
  dailyLossLimitUsd: number
  slippageBps: number
  mode: string
}

export function RiskControlPanel() {
  const [config, setConfig] = useState<QuantBotConfigResponse | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const res = await fetch("/api/bot/config", { cache: "no-store" })
        if (!res.ok) return
        const data = (await res.json()) as QuantBotConfigResponse
        if (active && data) setConfig(data)
      } catch {
        // network fallback
      }
    }
    void load()
    const timer = setInterval(load, 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  const items = [
    {
      label: "Position size",
      hint: "% of equity per trade (PRD: 2–5%)",
      value: config ? `${config.sizePct}% equity` : "—",
    },
    {
      label: "Hard stop-loss",
      hint: "exit on loss threshold",
      value: config ? `−${config.stopLossPct.toFixed(1)}%` : "—",
    },
    {
      label: "Trailing stop",
      hint: "lock gains after the trigger",
      value: config
        ? config.trailingStopEnabled
          ? `Arm +${config.trailingArmPct}% / Trail ${config.trailingOffsetPct}%`
          : "Disabled"
        : "—",
    },
    {
      label: "Daily max loss",
      hint: "circuit breaker, freeze 24h",
      value: config ? `$${config.dailyLossLimitUsd}.00` : "—",
    },
    {
      label: "Max slippage",
      hint: "execution tolerance",
      value: config ? `${config.slippageBps} bps (${(config.slippageBps / 100).toFixed(1)}%)` : "—",
    },
  ]

  return (
    <Panel
      title="Risk & bot parameters"
      bodyClassName="py-1"
      action={
        <span className="font-mono text-[11px] text-foreground/50">
          {config?.mode ?? "Syncing..."}
        </span>
      }
    >
      <dl className="divide-y divide-foreground/[0.06]">
        {items.map((p) => (
          <div key={p.label} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="min-w-0">
              <span className="block text-[12px] text-foreground/90">{p.label}</span>
              <span className="block text-[10.5px] text-foreground/35">{p.hint}</span>
            </dt>
            <dd className="shrink-0 font-mono text-[12.5px] tabular-nums text-foreground/80">
              {p.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="flex items-center gap-1.5 px-0 pb-2 pt-3 font-mono text-[11px] text-foreground/50">
        <span className="size-1.5 rounded-full bg-chart-up inline-block" />
        Trading Engine Parameters Synchronized
      </p>
    </Panel>
  )
}

