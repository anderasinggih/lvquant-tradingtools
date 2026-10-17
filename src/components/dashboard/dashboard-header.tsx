"use client"

import { useCallback, useEffect, useState } from "react"
import { useConnection, useWallet } from "@solana/wallet-adapter-react"
import { useWalletModal } from "@solana/wallet-adapter-react-ui"
import { LAMPORTS_PER_SOL } from "@solana/web3.js"

import { BUTTON } from "@/components/ui/control-classes"
import { LiveFigure } from "@/components/ui/live-figure"

/* Header with direct Phantom/Solflare Wallet connection.
   Zero dummy: reads real live balance on-chain via Helius connection.
   Utilitarian, clean fintech aesthetic matching SSYCH Vault (no emojis, no slop). */

export function DashboardHeader() {
  const { connection } = useConnection()
  const { publicKey, disconnect, connected, connecting } = useWallet()
  const { setVisible } = useWalletModal()

  const [balance, setBalance] = useState<number | null>(null)

  const fetchBalance = useCallback(async () => {
    if (!publicKey) {
      setBalance(null)
      return
    }
    try {
      const lamports = await connection.getBalance(publicKey)
      setBalance(lamports / LAMPORTS_PER_SOL)
    } catch {
      // ignore transient fetch error
    }
  }, [connection, publicKey])

  useEffect(() => {
    void fetchBalance()
    if (!publicKey) return
    const id = connection.onAccountChange(publicKey, () => {
      void fetchBalance()
    })
    return () => {
      void connection.removeAccountChangeListener(id)
    }
  }, [connection, fetchBalance, publicKey])

  const shorten = (addr: string) => `${addr.slice(0, 4)}...${addr.slice(-4)}`

  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div>
        <h1 className="text-[16px] font-medium tracking-[-0.01em] text-foreground/90">LVQuant</h1>
        <p className="mt-1 text-[12px] text-foreground/45">Solana · Jupiter & Drift Execution</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 tabular-nums">
        <div>
          <p className="text-[12px] text-foreground/45">SOL Balance</p>
          <div className="mt-1 text-[13px] font-medium text-foreground/90">
            {balance !== null ? (
              <span className="flex items-baseline gap-1">
                <LiveFigure intent={balance}>
                  <span>{balance.toFixed(4)}</span>
                </LiveFigure>
                <span className="text-[11px] text-foreground/45">SOL</span>
              </span>
            ) : (
              <span className="text-foreground/45">—</span>
            )}
          </div>
        </div>

        <div>
          <p className="text-[12px] text-foreground/45">Wallet</p>
          <div className="mt-1">
            {connected && publicKey ? (
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] text-foreground/90">
                  {shorten(publicKey.toBase58())}
                </span>
                <button
                  onClick={() => void disconnect()}
                  className="text-[11px] text-foreground/45 hover:text-foreground/80 underline cursor-pointer"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={() => setVisible(true)}
                disabled={connecting}
                className={`${BUTTON} h-8 px-4 text-[12px] font-medium cursor-pointer`}
              >
                {connecting ? "Connecting..." : "Connect Phantom Wallet"}
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
