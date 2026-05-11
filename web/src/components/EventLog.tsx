import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'

export interface EventEntry {
  id: number
  day: number
  message: string
  colour: string
}

interface EventLogProps {
  entries: EventEntry[]
  className?: string
}

export function EventLog({ entries, className }: EventLogProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries.length])

  return (
    <div
      className={cn(
        'rounded-md border border-border bg-card/60 p-2',
        className,
      )}
    >
      <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-wider text-accent">
        Event Log
      </div>
      <div
        ref={scrollRef}
        className="scroll-thin max-h-32 overflow-y-auto pr-1 text-xs leading-snug text-muted-foreground"
      >
        {entries.length === 0 ? (
          <div className="px-1 py-2 text-[11px] italic text-muted-foreground/70">
            No events yet.
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {entries.map((e) => (
              <motion.div
                key={e.id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="px-1 py-0.5"
              >
                <span
                  className="mr-1 font-semibold"
                  style={{ color: e.colour }}
                >
                  [Day {String(e.day).padStart(3, ' ')}]
                </span>
                {e.message}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}
