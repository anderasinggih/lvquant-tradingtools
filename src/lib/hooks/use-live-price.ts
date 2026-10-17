"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { LiveMarketPrice, LivePriceState } from "@/lib/market/types"

/* Polls `/api/market/price` on an interval and keeps a short history of the observed prices so
   the chart can draw a real, growing series. Polling is pause-aware: it stops scheduling while
   the tab is hidden and re-reads on return. No mock: on failure the status is `error` and the
   last real data is kept (never replaced by a placeholder). */

export interface UseLivePriceOptions {
  /** polling interval in ms */
  intervalMs?: number
  /** how many recent ticks to retain for the chart */
  maxPoints?: number
}

const DEFAULT_INTERVAL_MS = 5_000
const DEFAULT_MAX_POINTS = 300

export function useLivePrice(options: UseLivePriceOptions = {}): LivePriceState & { refresh: () => void } {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const maxPoints = options.maxPoints ?? DEFAULT_MAX_POINTS

  const [state, setState] = useState<LivePriceState>({
    status: "connecting",
    data: null,
    error: null,
    ticks: [],
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
      const res = await fetch("/api/market/price", { signal: controller.signal, cache: "no-store" })
      const body = (await res.json().catch(() => null)) as
        | (LiveMarketPrice & { error?: string; detail?: string })
        | null
      if (!res.ok) {
        const message = body?.error
          ? `${body.error}${body.detail ? `: ${body.detail}` : ""}`
          : `Price feed responded HTTP ${res.status}`
        throw new Error(message)
      }
      if (!body) throw new Error("Price feed returned an empty response")

      setState((prev) => {
        const at = Date.now()
        const ticks = [...prev.ticks, { price: body.price, at }].slice(-maxPoints)
        return { status: "live", data: body, error: null, ticks, lastUpdatedAt: at }
      })
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
  }, [intervalMs, maxPoints])

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
