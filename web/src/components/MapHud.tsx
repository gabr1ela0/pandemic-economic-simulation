import { motion, useMotionValue, animate } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  Skull,
  HeartPulse,
  ShieldAlert,
  Pause,
  Play,
} from 'lucide-react'
import { cn, formatNumber } from '@/lib/utils'

interface MapHudProps {
  day: number
  lockdownLevel: number
  maskMandate: boolean
  vaccinationPct: number
  stimulus: number
  active: number
  deaths: number
  hospitalPct: number
  hospitalOverwhelmed: boolean
  bankInCrisis: boolean
  running: boolean
}

const LOCKDOWN_LABELS = ['NONE', 'LIGHT', 'MODERATE', 'FULL'] as const
const LOCKDOWN_COLORS = [
  'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40',
  'bg-amber-500/15 text-amber-300 ring-amber-500/40',
  'bg-orange-500/15 text-orange-300 ring-orange-500/40',
  'bg-red-500/15 text-red-300 ring-red-500/40',
]

export function MapHud(props: MapHudProps) {
  const lockdown = Math.min(3, Math.max(0, props.lockdownLevel))
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col gap-2">
      <motion.div
        layout
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-border/80 bg-card/85 px-4 py-3 shadow-2xl backdrop-blur-md"
      >
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-widest text-accent">
              Day
            </span>
            <CountUp value={props.day} className="text-3xl font-bold leading-none tabular-nums" />
          </div>
          <span className="h-10 w-px bg-border" />
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Lockdown
            </span>
            <span
              className={cn(
                'rounded-md px-2 py-0.5 text-xs font-bold tracking-wide ring-1',
                LOCKDOWN_COLORS[lockdown],
              )}
            >
              {LOCKDOWN_LABELS[lockdown]}
            </span>
          </div>
          <span className="h-10 w-px bg-border" />
          <div className="flex items-center gap-2">
            {props.maskMandate ? (
              <Pill colour="cyan" label="MASKS" />
            ) : null}
            {props.vaccinationPct > 0 ? (
              <Pill colour="emerald" label={`VACC ${props.vaccinationPct}%`} />
            ) : null}
            {props.stimulus > 0 ? (
              <Pill colour="amber" label={`$${props.stimulus}`} />
            ) : null}
            {!props.maskMandate && props.vaccinationPct === 0 && props.stimulus === 0 ? (
              <span className="text-[10px] uppercase text-muted-foreground/60">
                No active policies
              </span>
            ) : null}
          </div>
          <span className="h-10 w-px bg-border" />
          <span
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1',
              props.running
                ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40'
                : 'bg-secondary text-muted-foreground ring-border',
            )}
          >
            {props.running ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {props.running ? 'Live' : 'Paused'}
          </span>
        </div>
      </motion.div>

      <motion.div
        layout
        className="flex items-center gap-2"
      >
        <Stat
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Active"
          value={props.active}
          tone={
            props.active > 1000 ? 'bad' : props.active > 200 ? 'warn' : 'idle'
          }
        />
        <Stat
          icon={<Skull className="h-3.5 w-3.5" />}
          label="Deaths"
          value={props.deaths}
          tone={
            props.deaths > 200 ? 'bad' : props.deaths > 50 ? 'warn' : 'idle'
          }
        />
        <Stat
          icon={<HeartPulse className="h-3.5 w-3.5" />}
          label="Hospital"
          value={`${Math.round(props.hospitalPct)}%`}
          tone={
            props.hospitalOverwhelmed
              ? 'bad'
              : props.hospitalPct > 70
                ? 'warn'
                : 'good'
          }
        />
        {props.bankInCrisis ? (
          <span className="rounded-md bg-red-500/20 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-red-300 ring-1 ring-red-500/40">
            <ShieldAlert className="mr-1 inline-block h-3 w-3" />
            Bank Crisis
          </span>
        ) : null}
      </motion.div>
    </div>
  )
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  tone: 'good' | 'warn' | 'bad' | 'idle'
}) {
  const colour = {
    good: 'text-emerald-300 ring-emerald-500/30',
    warn: 'text-amber-300 ring-amber-500/30',
    bad: 'text-red-300 ring-red-500/40 bg-red-500/15',
    idle: 'text-foreground ring-border',
  }[tone]
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border border-border/60 bg-card/85 px-2.5 py-1.5 shadow-md backdrop-blur-md ring-1',
        colour,
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <div className="flex flex-col leading-none">
        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <span className="text-sm font-bold tabular-nums">
          {typeof value === 'number' ? <CountUp value={value} /> : value}
        </span>
      </div>
    </div>
  )
}

function Pill({
  colour,
  label,
}: {
  colour: 'cyan' | 'emerald' | 'amber'
  label: string
}) {
  const map = {
    cyan: 'bg-cyan-500/15 text-cyan-300 ring-cyan-500/40',
    emerald: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40',
    amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/40',
  }[colour]
  return (
    <span
      className={cn(
        'rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1',
        map,
      )}
    >
      {label}
    </span>
  )
}

function CountUp({
  value,
  className,
}: {
  value: number
  className?: string
}) {
  const motionVal = useMotionValue(value)
  const [display, setDisplay] = useState(() => fmt(value))
  const prevRef = useRef(value)
  useEffect(() => {
    if (value === prevRef.current) return
    const controls = animate(motionVal, value, {
      duration: 0.4,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(fmt(v)),
    })
    prevRef.current = value
    return () => controls.stop()
  }, [value, motionVal])
  return <span className={className}>{display}</span>
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 10_000) return formatNumber(v)
  return Math.round(v).toLocaleString()
}
