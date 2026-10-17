import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { LivePricePanel } from "@/components/dashboard/live-price-panel"
import { PositionsPanel } from "@/components/dashboard/positions-panel"
import { RiskControlPanel } from "@/components/dashboard/risk-control-panel"

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-6 px-5 py-8 sm:px-8">
      <DashboardHeader />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <LivePricePanel className="lg:col-span-2" />

        <RiskControlPanel />
      </div>

      <PositionsPanel />
    </main>
  )
}
