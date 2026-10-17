"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { FeedStatus, MarketHistory } from "@/lib/market/types"

/* Polls `/api/market/history` and keeps the real per-timeframe series. Candles move slowly, so the
   interval is longer than the live-price poll. Polling is pause-aware: it stops scheduling while the
   tab is hidden and re-reads on return. No mock: on failure the status is `error` and the last real
   data is kept (never replaced by a placeholder). */

export interface PriceHistoryState {
  status: FeedStatus
  data: MarketHistory | null
  error: string | null
  lastUpdatedAt: number | null
}

const DEFAULT_INTERVAL_MS = 60_000

export function usePriceHistory(
  options: { intervalMs?: number } = {},
): PriceHistoryState & { refresh: () => void } {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS

  const [state, setState] = useState<PriceHistoryState>({
    status: "connecting",
    data: null,
    error: null,
    lastUpdatedAt: null,
  })

  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stoppedRef = useRef(false)

  const poll = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch("/api/market/history", { signal: controller.signal, cache: "no-store" })
      const body = (await res.json().catch(() => null)) as
        | (MarketHistory & { error?: string; detail?: string })
        | null
      if (!res.ok) {
        const message = body?.error
          ? `${body.error}${body.detail ? `: ${body.detail}` : ""}`
          : `History feed responded HTTP ${res.status}`
        throw new Error(message)
      }
      if (!body) throw new Error("History feed returned an empty response")

      setState({ status: "live", data: body, error: null, lastUpdatedAt: Date.now() })
    } catch (err) {
      if (controller.signal.aborted) return
      setState((prev) => ({
        ...prev,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }))
    } finally {
      if (!stoppedRef.current && !document.hidden) {
        timerRef.current = setTimeout(poll, intervalMs)
      }
    }
  }, [intervalMs])

  useEffect(() => {
    stoppedRef.current = false
    void poll()
    return () => {
      stoppedRef.current = true
      abortRef.current?.abort()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [poll])

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && !stoppedRef.current) void poll()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [poll])

  return { ...state, refresh: () => void poll() }
}
