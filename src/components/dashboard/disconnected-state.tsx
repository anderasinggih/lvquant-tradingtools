import { cn } from "@/lib/utils"

/* The disconnected indicator (rules §1): when a module has no real feed it says so, in
   plain text. No numbers, no pulsing dot, no decoration. */

export function DisconnectedState({
  status = "Awaiting Real-Time Feed / Disconnected",
  note,
  className,
}: {
  status?: string
  note?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-[16px] border border-foreground/[0.06] px-4 py-10 text-center",
        className,
      )}
      role="status"
    >
      <p className="font-mono text-[11.5px] text-foreground/45">{status}</p>
      {note ? <p className="max-w-sm text-[11px] leading-[1.5] text-foreground/35">{note}</p> : null}
    </div>
  )
}
