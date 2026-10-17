/* Wallet & balance region. Nothing is connected yet (the wallet/RPC layer lands in Fase 2),
   so both figures read their true state: no address, no balance. No placeholder numbers. */

export function DashboardHeader() {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div>
        <h1 className="text-[16px] font-medium tracking-[-0.01em] text-foreground/90">LVQuant</h1>
        <p className="mt-1 text-[12px] text-foreground/45">Solana · Jupiter DEX aggregator</p>
      </div>

      <div className="flex flex-wrap items-start gap-x-8 gap-y-3 tabular-nums">
        <div>
          <p className="text-[12px] text-foreground/45">Wallet</p>
          <p className="mt-1 text-[13px] text-foreground/90">Not connected</p>
        </div>
        <div>
          <p className="text-[12px] text-foreground/45">Live balance</p>
          <p className="mt-1 font-mono text-[11.5px] text-foreground/45">Awaiting Real-Time Feed / Disconnected</p>
        </div>
      </div>
    </header>
  )
}
