"use client"

import { useEffect, useRef, useState } from "react"

/* usePointed: live content runs only while it is being looked at.
   Spread `bind` on the component's root; `live` is true while the pointer is on it
   or focus is inside it, and stays true for `linger` ms after it leaves. */
export function usePointed<T extends HTMLElement = HTMLDivElement>({ linger = 600 } = {}) {
  const ref = useRef<T>(null)
  const [pointed, setPointed] = useState(false)
  const [seen, setSeen] = useState(false)
  const [touch] = useState(() => typeof matchMedia === "function" && !matchMedia("(hover: hover) and (pointer: fine)").matches)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!touch || !ref.current || typeof IntersectionObserver === "undefined") return
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { threshold: 0.5 })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [touch])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const on = () => {
    window.clearTimeout(timer.current)
    setPointed(true)
  }
  const off = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setPointed(false), linger)
  }

  return {
    ref,
    live: touch ? seen : pointed,
    bind: {
      onPointerEnter: on,
      onPointerLeave: off,
      onFocus: on,
      onBlur: (e: React.FocusEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) off()
      },
    },
  }
}
