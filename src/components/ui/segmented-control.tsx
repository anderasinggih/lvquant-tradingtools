"use client"

import { useId, useState } from "react"
import { motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { SEGMENT_OFF, THUMB, TRACK } from "@/components/ui/control-classes"

/* Segmented Control, rebuilt through the ssych-component skill (2026-09-29).
   What changed against the version before it (in git history), and why:
   · the track sets tabular numerals, so labels with a figure in them (1D, 1W, 3M) line up
   This is the material every control in the library is cut from
   (src/components/library/controls.ts), so the track, the thumb, the sizes and the
   glide are the original's, value for value.
   2026-10-02 audit: the control now reads its material from control-classes (TRACK, THUMB,
   SEGMENT_OFF) instead of its own 8% copy, so the thumb turns white on a raised light
   surface like every other control; the options are an explicit 28px tall (h-7) at 11.5px
   with no letter spacing, the control text size of spec 14.4; an optional `label` names
   the group for a screen reader. Props and the export are unchanged. */

export interface SegmentedControlProps {
  options: string[]
  /** Controlled value; omit to let the control manage its own state. */
  value?: string
  onChange?: (v: string) => void
  className?: string
  /** what the group switches, read by a screen reader (optional) */
  label?: string
}

/**
 * The range switcher as a primitive: a hairline pill whose thumb glides
 * between options with a shared-layout tween. Tabular labels, no chrome.
 */
export function SegmentedControl({ options, value, onChange, className, label }: SegmentedControlProps) {
  const reduced = useReducedMotion()
  const uid = useId()
  const [inner, setInner] = useState(value ?? options[0])
  const current = value ?? inner

  return (
    <div role="group" aria-label={label} className={cn("inline-flex items-center gap-0.5 tabular-nums", TRACK, className)}>
      {options.map((o) => {
        const on = o === current
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => {
              setInner(o)
              onChange?.(o)
            }}
            className={cn(
              "group relative inline-flex h-7 items-center rounded-full px-3 text-[11.5px] outline-none transition-colors duration-200 focus-visible:text-foreground/90",
              on ? "text-foreground/90" : SEGMENT_OFF,
            )}
          >
            {on && (
              /* transitions.dev sliding-tabs feel: a clean 250ms smooth-out tween */
              <motion.span
                layoutId={`${uid}-thumb`}
                className={cn("absolute inset-0 rounded-full", THUMB)}
                transition={reduced ? { duration: 0 } : { duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              />
            )}
            {/* the press answers on the label, so the thumb's layout glide measures an unscaled button */}
            <span className="relative inline-block transition-transform duration-150 group-active:scale-[0.97] motion-reduce:transition-none motion-reduce:group-active:scale-100">{o}</span>
          </button>
        )
      })}
    </div>
  )
}
