"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { FeedStatus, MarketHistory } from "@/lib/market/types"

/* Polls `/api/market/history?token=...` and keeps the real per-timeframe series.
   Supports dynamic token selection (SOL, BONK, WIF, etc).
   No mock: on failure the status is `error` and the last real data is kept. */

export interface PriceHistoryState {
  status: FeedStatus
  data: MarketHistory | null
  error: string | null
  lastUpdatedAt: number | null
}

const DEFAULT_INTERVAL_MS = 60_000

export function usePriceHistory(
  options: { intervalMs?: number; token?: string } = {},
): PriceHistoryState & { refresh: () => void } {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const token = options.token ?? "SOL"

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
      const res = await fetch(`/api/market/history?token=${encodeURIComponent(token)}`, {
        signal: controller.signal,
        cache: "no-store",
      })
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
      const message = err instanceof Error ? err.message : String(err)
      setState((prev) => ({ ...prev, status: "error", error: message }))
    } finally {
      if (!stoppedRef.current) {
        timerRef.current = setTimeout(() => void poll(), intervalMs)
      }
    }
  }, [intervalMs, token])

  useEffect(() => {
    stoppedRef.current = false
    void poll()

    const onVisibilityChange = () => {
      if (document.hidden) {
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
      } else {
        void poll()
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      stoppedRef.current = true
      abortRef.current?.abort()
      if (timerRef.current) clearTimeout(timerRef.current)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [poll])

  return { ...state, refresh: poll }
}
