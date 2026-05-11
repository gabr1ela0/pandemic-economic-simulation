import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { KpiTile } from '@/components/KpiTile'
import { EventLog, type EventEntry } from '@/components/EventLog'
import type { TickRecord } from '@/sim/simulation'
import { cn, formatMoney } from '@/lib/utils'

const SPEEDS: { label: string; ms: number }[] = [
  { label: '0.25x', ms: 400 },
  { label: '0.5x', ms: 200 },
  { label: '1x', ms: 100 },
  { label: '2x', ms: 50 },
  { label: '5x', ms: 20 },
]

const LOCKDOWN_LABELS = ['None', 'Light', 'Mod', 'Full']
const LOCKDOWN_COLOURS = [
  'bg-emerald-500 text-black',
  'bg-amber-400 text-black',
  'bg-orange-500 text-black',
  'bg-red-500 text-black',
]

export interface SidebarProps {
  // Policy state
  lockdownLevel: number
  maskMandate: boolean
  vaccinationPct: number
  stimulus: number
  speedLabel: string
  // Simulation state
  running: boolean
  day: number
  lastRecord: TickRecord | null
  crisisScore: number
  events: EventEntry[]
  // Callbacks
  onLockdownChange: (level: number) => void
  onMaskChange: (enabled: boolean) => void
  onVaccinationChange: (pct: number) => void
  onStimulusChange: (amount: number) => void
  onSpeedChange: (label: string) => void
  onRunToggle: () => void
  onStep: () => void
  onReset: () => void
}

export function Sidebar(props: SidebarProps) {
  const r = props.lastRecord
  return (
    <aside className="scroll-thin flex h-full w-[320px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-card px-3 py-4">
      <div className="px-1">
        <div className="text-2xl font-bold tracking-tight text-accent">
          OUTBREAK
        </div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Command Center · Day {props.day}
        </div>
      </div>

      <Section title="Lockdown" badge={`Lv ${props.lockdownLevel}`}>
        <div className="grid grid-cols-4 gap-1">
          {LOCKDOWN_LABELS.map((lbl, i) => (
            <button
              key={lbl}
              onClick={() => props.onLockdownChange(i)}
              className={cn(
                'rounded-md px-2 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors',
                props.lockdownLevel === i
                  ? LOCKDOWN_COLOURS[i]
                  : 'bg-secondary text-muted-foreground hover:bg-secondary/70',
              )}
            >
              {lbl}
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Mask Mandate"
        badge={props.maskMandate ? 'On' : 'Off'}
      >
        <div className="flex items-center justify-between rounded-md border border-border bg-card/60 px-3 py-2">
          <span className="text-xs text-muted-foreground">Enable mandate</span>
          <Switch
            checked={props.maskMandate}
            onCheckedChange={props.onMaskChange}
          />
        </div>
      </Section>

      <Section
        title="Vaccination"
        badge={`${props.vaccinationPct}%`}
      >
        <div className="flex items-center gap-3 px-1">
          <span className="w-9 text-xs font-bold tabular-nums text-emerald-400">
            {props.vaccinationPct}%
          </span>
          <Slider
            value={[props.vaccinationPct]}
            min={0}
            max={100}
            step={1}
            onValueChange={(v) => props.onVaccinationChange(v[0])}
          />
        </div>
      </Section>

      <Section title="Stimulus" badge={`$${props.stimulus}`}>
        <div className="flex items-center gap-3 px-1">
          <span className="w-12 text-xs font-bold tabular-nums text-emerald-400">
            ${props.stimulus}
          </span>
          <Slider
            value={[props.stimulus]}
            min={0}
            max={200}
            step={5}
            onValueChange={(v) => props.onStimulusChange(v[0])}
          />
        </div>
      </Section>

      <Section title="Speed" badge={props.speedLabel}>
        <div className="grid grid-cols-5 gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s.label}
              onClick={() => props.onSpeedChange(s.label)}
              className={cn(
                'rounded-md px-1 py-1 text-[10px] font-bold uppercase transition-colors',
                props.speedLabel === s.label
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:bg-secondary/70',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Section>

      <div className="grid gap-2">
        <Button
          onClick={props.onRunToggle}
          className={cn(
            props.running
              ? 'bg-secondary text-foreground hover:bg-secondary/70'
              : 'bg-emerald-500 text-black hover:bg-emerald-400',
          )}
        >
          {props.running ? (
            <>
              <Pause className="h-4 w-4" /> Pause
            </>
          ) : (
            <>
              <Play className="h-4 w-4" /> Run
            </>
          )}
        </Button>
        <Button
          variant="secondary"
          className="bg-amber-400 text-black hover:bg-amber-300"
          onClick={props.onStep}
        >
          <SkipForward className="h-4 w-4" /> Next Day
        </Button>
        <Button
          variant="secondary"
          onClick={props.onReset}
        >
          <RotateCcw className="h-4 w-4" /> Reset
        </Button>
      </div>

      <div className="mt-1 grid grid-cols-2 gap-2">
        <KpiTile
          label="Active"
          value={
            r
              ? r.exposed + r.infectiousAsymptomatic + r.infectiousSymptomatic
              : '—'
          }
          sub={r ? `${r.infectiousSymptomatic.toLocaleString()} sympt` : ''}
          status={
            !r
              ? 'idle'
              : r.exposed + r.infectiousAsymptomatic + r.infectiousSymptomatic >
                  1000
                ? 'bad'
                : r.exposed +
                      r.infectiousAsymptomatic +
                      r.infectiousSymptomatic >
                    200
                  ? 'warn'
                  : 'idle'
          }
        />
        <KpiTile
          label="Deaths"
          value={r ? r.dead : '—'}
          status={
            !r ? 'idle' : r.dead > 200 ? 'bad' : r.dead > 50 ? 'warn' : 'idle'
          }
        />
        <KpiTile
          label="Hospital"
          value={
            r
              ? Math.round(
                  (r.healthcarePatients / Math.max(1, r.healthcareCapacity)) *
                    100,
                )
              : '—'
          }
          valueSuffix="%"
          sub={r ? `${r.healthcarePatients}/${r.healthcareCapacity}` : ''}
          status={
            !r
              ? 'idle'
              : r.healthcareOverwhelmed
                ? 'bad'
                : r.healthcarePatients / Math.max(1, r.healthcareCapacity) >
                    0.7
                  ? 'warn'
                  : 'good'
          }
        />
        <KpiTile
          label="Unemp"
          value={r ? r.unemploymentRatePct : '—'}
          decimal
          valueSuffix="%"
          status={
            !r
              ? 'idle'
              : r.unemploymentRatePct > 25
                ? 'bad'
                : r.unemploymentRatePct > 10
                  ? 'warn'
                  : 'idle'
          }
        />
        <KpiTile
          className="col-span-2"
          label="Bankrupt"
          value={r ? r.companiesBankrupt : '—'}
          sub={r ? `Reserves ${formatMoney(r.bankReserves)}` : ''}
          status={
            !r
              ? 'idle'
              : r.companiesBankrupt > 30
                ? 'bad'
                : r.companiesBankrupt > 10
                  ? 'warn'
                  : 'idle'
          }
        />
      </div>

      <div className="rounded-md border border-border bg-card/60 px-3 py-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-accent">
          Crisis Score
        </div>
        <div className="font-mono text-2xl font-bold tabular-nums">
          {String(props.crisisScore).padStart(5, '0')}
        </div>
      </div>

      <EventLog entries={props.events} />

      <div className="rounded-md border border-border bg-card/60 px-3 py-2 text-[11px]">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-accent">
          Legend
        </div>
        <div className="grid grid-cols-2 gap-y-1 text-muted-foreground">
          <Legend swatch="#4a90d9" label="Susceptible" />
          <Legend swatch="#f39c12" label="Exposed" />
          <Legend swatch="#f1c40f" label="Asympt." />
          <Legend swatch="#e74c3c" label="Sympt." />
          <Legend swatch="#2ecc71" label="Recovered" />
          <Legend swatch="#ff8c1a" label="Poverty" />
        </div>
      </div>
    </aside>
  )
}

function Section({
  title,
  badge,
  children,
}: {
  title: string
  badge?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[11px] font-bold uppercase tracking-wider text-accent">
          {title}
        </span>
        {badge ? <Badge variant="secondary">{badge}</Badge> : null}
      </div>
      {children}
    </div>
  )
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-2 rounded-sm"
        style={{ backgroundColor: swatch }}
      />
      <span>{label}</span>
    </div>
  )
}
