"use client"

import { useState } from "react"

import { Panel } from "@/components/dashboard/panel"
import { DisconnectedState } from "@/components/dashboard/disconnected-state"
import { SegmentedControl } from "@/components/ui/segmented-control"

/* Active positions and trade history. Both read from the wallet & execution layers, which
   are not wired yet, so the panel shows its true state. The view switch is the vault's
   SegmentedControl (control material), tabs switch the region, not fake rows. */

const VIEWS = ["Active positions", "Trade history"] as const
type View = (typeof VIEWS)[number]

const NOTES: Record<View, string> = {
  "Active positions": "Positions open on the wallet will list here, read on-chain.",
  "Trade history": "Filled swaps with their Solscan signatures will list here.",
}

export function PositionsPanel() {
  const [view, setView] = useState<View>(VIEWS[0])

  return (
    <Panel
      title={view}
      action={<SegmentedControl options={[...VIEWS]} value={view} onChange={(v) => setView(v as View)} label="Positions view" />}
      className="min-h-[260px]"
    >
      <DisconnectedState note={NOTES[view]} />
    </Panel>
  )
}
