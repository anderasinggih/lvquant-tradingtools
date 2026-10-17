import { type ReactNode } from "react"

import { cn } from "@/lib/utils"
import { SURFACE } from "@/components/ui/control-classes"

/* Layout container only (rules §4): no visual language of its own beyond the vault's
   SURFACE token and the 24px corner / 6px padding the vault's own boxes use (index-card).
   The page owns headings; panels just group a region. */

export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn("flex flex-col rounded-[24px] p-1.5", SURFACE, className)}>
      <div className="flex items-baseline justify-between gap-2 px-2.5 pt-2">
        <h2 className="text-[12px] text-foreground/45">{title}</h2>
        {action}
      </div>
      <div className={cn("flex-1 px-2.5 py-2.5", bodyClassName)}>{children}</div>
    </section>
  )
}
