import { useEffect, useRef, useState } from 'react'
import { motion, useMotionValue, animate } from 'framer-motion'
import { cn, formatNumber } from '@/lib/utils'

type Status = 'good' | 'warn' | 'bad' | 'idle'

interface KpiTileProps {
  label: string
  /** Numeric value drives the count-up; for percentages pass `valueSuffix="%"`. */
  value: number | string
  sub?: string
  status?: Status
  className?: string
  valueSuffix?: string
  /** When true, the count-up uses 1 decimal place (for percent). */
  decimal?: boolean
}

const statusColour: Record<Status, string> = {
  good: 'text-emerald-400',
  warn: 'text-amber-400',
  bad: 'text-red-400',
  idle: 'text-foreground',
}

const statusGlow: Record<Status, string> = {
  good: 'shadow-[0_0_0_1px_rgba(16,185,129,0.2)]',
  warn: 'shadow-[0_0_0_1px_rgba(251,191,36,0.25)]',
  bad: 'shadow-[0_0_0_1px_rgba(239,68,68,0.3)]',
  idle: '',
}

export function KpiTile({
  label,
  value,
  sub,
  status = 'idle',
  className,
  valueSuffix,
  decimal = false,
}: KpiTileProps) {
  if (typeof value === 'string') {
    return (
      <Static
        label={label}
        value={value}
        sub={sub}
        status={status}
        className={className}
      />
    )
  }

  return (
    <Counting
      label={label}
      value={value}
      sub={sub}
      status={status}
      className={className}
      valueSuffix={valueSuffix}
      decimal={decimal}
    />
  )
}

function Static({
  label,
  value,
  sub,
  status,
  className,
}: {
  label: string
  value: string
  sub?: string
  status: Status
  className?: string
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'rounded-md border border-border bg-card/60 px-3 py-2 transition-shadow',
        statusGlow[status],
        className,
      )}
    >
      <div className="text-[10px] font-bold uppercase tracking-wider text-accent">
        {label}
      </div>
      <div
        className={cn(
          'mt-0.5 text-xl font-bold tabular-nums leading-none',
          statusColour[status],
        )}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-1 text-[10px] text-muted-foreground">{sub}</div>
      ) : null}
    </motion.div>
  )
}

function Counting({
  label,
  value,
  sub,
  status,
  className,
  valueSuffix,
  decimal,
}: {
  label: string
  value: number
  sub?: string
  status: Status
  className?: string
  valueSuffix?: string
  decimal: boolean
}) {
  const motionVal = useMotionValue(value)
  const [display, setDisplay] = useState<string>(() => formatVal(value, decimal, valueSuffix))
  const prevValRef = useRef(value)

  useEffect(() => {
    if (value === prevValRef.current) return
    const controls = animate(motionVal, value, {
      duration: 0.45,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(formatVal(v, decimal, valueSuffix)),
    })
    prevValRef.current = value
    return () => controls.stop()
  }, [value, decimal, valueSuffix, motionVal])

  return (
    <motion.div
      layout
      className={cn(
        'rounded-md border border-border bg-card/60 px-3 py-2 transition-shadow',
        statusGlow[status],
        className,
      )}
    >
      <div className="text-[10px] font-bold uppercase tracking-wider text-accent">
        {label}
      </div>
      <div
        className={cn(
          'mt-0.5 text-xl font-bold tabular-nums leading-none',
          statusColour[status],
        )}
      >
        {display}
      </div>
      {sub ? (
        <div className="mt-1 text-[10px] text-muted-foreground">{sub}</div>
      ) : null}
    </motion.div>
  )
}

function formatVal(v: number, decimal: boolean, suffix?: string): string {
  if (!Number.isFinite(v)) return '—'
  let s: string
  if (decimal) s = v.toFixed(1)
  else if (Math.abs(v) >= 10_000) s = formatNumber(v)
  else s = String(Math.round(v))
  return suffix ? `${s}${suffix}` : s
}
