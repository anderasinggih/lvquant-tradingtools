import { Panel } from "@/components/dashboard/panel"

/* Risk & bot parameters per the PRD (§4.3): position sizing, hard stop-loss, trailing
   stop, daily drawdown circuit breaker, plus execution slippage (§4.4). The parameter set
   is from spec; the values are the operator's to set, so nothing is pre-filled here.
   Fields stay read-only until the risk engine exists, and say so. */

const PARAMETERS = [
  { label: "Position size", hint: "% of equity per trade (PRD: 2–5%)" },
  { label: "Hard stop-loss", hint: "exit on loss threshold" },
  { label: "Trailing stop", hint: "lock gains after the trigger" },
  { label: "Daily max loss", hint: "circuit breaker, freeze 24h" },
  { label: "Max slippage", hint: "execution tolerance" },
] as const

export function RiskControlPanel() {
  return (
    <Panel title="Risk & bot parameters" bodyClassName="py-1">
      <dl className="divide-y divide-foreground/[0.06]">
        {PARAMETERS.map((p) => (
          <div key={p.label} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="min-w-0">
              <span className="block text-[12px] text-foreground/90">{p.label}</span>
              <span className="block text-[10.5px] text-foreground/35">{p.hint}</span>
            </dt>
            <dd className="shrink-0 text-[13px] tabular-nums text-foreground/35">—</dd>
          </div>
        ))}
      </dl>
      <p className="px-0 pb-2 pt-3 font-mono text-[11px] text-foreground/45">
        Awaiting Real-Time Feed / Disconnected
      </p>
    </Panel>
  )
}
