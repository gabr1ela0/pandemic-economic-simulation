import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CityMap, type CityMapHandle } from '@/components/CityMap'
import { ChartView } from '@/components/ChartView'
import { EndGameModal } from '@/components/EndGameModal'
import { MapHud } from '@/components/MapHud'
import { Sidebar } from '@/components/Sidebar'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { EventEntry } from '@/components/EventLog'
import { CONFIG } from '@/sim/config'
import { Government } from '@/sim/entities'
import { SimulationEngine, type TickRecord } from '@/sim/simulation'

type ViewMode = 'city' | 'chart'

const SPEED_TO_MS: Record<string, number> = {
  '0.25x': 400,
  '0.5x': 200,
  '1x': 100,
  '2x': 50,
  '5x': 20,
}

const RED = '#e74c3c'
const ORANGE = '#ff8c1a'
const ACCENT = '#5ec9f5'
const GREEN = '#2ecc71'

function newSim(): { gov: Government; sim: SimulationEngine } {
  const gov = new Government()
  const sim = new SimulationEngine(gov, CONFIG.RANDOM_SEED)
  return { gov, sim }
}

function App() {
  // ---- core sim ----
  const initial = useMemo(() => newSim(), [])
  const simRef = useRef<SimulationEngine>(initial.sim)
  const govRef = useRef<Government>(initial.gov)
  const cityRef = useRef<CityMapHandle | null>(null)
  const [simEpoch, setSimEpoch] = useState(0)

  // ---- view + run state ----
  const [viewMode, setViewMode] = useState<ViewMode>('city')
  const [running, setRunning] = useState(false)
  const [speedLabel, setSpeedLabel] = useState('1x')
  const tickMsRef = useRef(SPEED_TO_MS['1x'])

  // ---- policy state mirrored for UI ----
  const [lockdownLevel, setLockdownLevel] = useState(0)
  const [maskMandate, setMaskMandate] = useState(false)
  const [vaccinationPct, setVaccinationPct] = useState(0)
  const [stimulus, setStimulus] = useState(0)

  // ---- visible-only state, throttled from sim ----
  const [day, setDay] = useState(0)
  const [lastRecord, setLastRecord] = useState<TickRecord | null>(null)
  const [crisisScore, setCrisisScore] = useState(0)
  const [events, setEvents] = useState<EventEntry[]>([])
  const eventsKeySeen = useRef<Set<string>>(new Set())
  const peakUnempRef = useRef(0)
  const peakActiveRef = useRef(0)
  const eventCounterRef = useRef(0)
  const [endGame, setEndGame] = useState<{
    open: boolean
    reason: 'resolved' | 'maxDays' | 'manual'
    record: TickRecord | null
    days: number
    score: number
    peakUnemp: number
  }>({
    open: false,
    reason: 'manual',
    record: null,
    days: 0,
    score: 0,
    peakUnemp: 0,
  })

  // ---- tick loop ----

  const intervalRef = useRef<number | null>(null)

  const runTick = useCallback(() => {
    const sim = simRef.current
    sim.tick()
    cityRef.current?.onTick()

    const r = sim.records[sim.records.length - 1]
    setDay(sim.tickNum)
    setLastRecord(r)

    // Crisis score
    const active = r.exposed + r.infectiousAsymptomatic + r.infectiousSymptomatic
    peakActiveRef.current = Math.max(peakActiveRef.current, active)
    peakUnempRef.current = Math.max(peakUnempRef.current, r.unemploymentRatePct / 100)
    const score = Math.round(
      r.dead * 10 +
        peakUnempRef.current * 50 +
        r.companiesBankrupt * 40 +
        r.nationalDebt / 10_000,
    )
    setCrisisScore(score)

    // Milestone events
    const newEvents: EventEntry[] = []
    const fire = (key: string, message: string, colour: string) => {
      if (eventsKeySeen.current.has(key)) return
      eventsKeySeen.current.add(key)
      newEvents.push({
        id: ++eventCounterRef.current,
        day: sim.tickNum,
        message,
        colour,
      })
    }
    const prev = sim.records.length > 1 ? sim.records[sim.records.length - 2] : null
    if (r.dead > 0) fire('first_death', 'First fatality reported.', RED)
    if (r.healthcareOverwhelmed && !prev?.healthcareOverwhelmed) {
      fire(`hosp_overwhelmed_${sim.tickNum}`, 'Hospital capacity exceeded.', RED)
    }
    if (r.companiesBankrupt > 0) {
      fire('first_bankruptcy', 'First company bankruptcy.', ORANGE)
    }
    if (r.bankInCrisis && !prev?.bankInCrisis) {
      fire(`bank_crisis_${sim.tickNum}`, 'Banking reserves entered crisis zone.', RED)
    }
    if (peakActiveRef.current > 200 && active < peakActiveRef.current * 0.8) {
      fire('first_peak', 'First wave appears to have peaked.', ACCENT)
    }
    if (r.rehiresToday > 0) {
      fire('first_rehire', 'First rehires return to the labour market.', GREEN)
    }
    if (newEvents.length > 0) {
      setEvents((prev) => [...prev, ...newEvents])
    }

    // Auto-stop on resolution / max ticks (and pop the end-of-game modal)
    const epidemicResolved =
      sim.tickNum > 30 &&
      r.exposed + r.infectiousAsymptomatic + r.infectiousSymptomatic === 0
    const maxDaysHit = sim.tickNum >= CONFIG.NUM_TICKS
    if ((epidemicResolved || maxDaysHit) && !endGame.open) {
      setRunning(false)
      setEndGame({
        open: true,
        reason: maxDaysHit ? 'maxDays' : 'resolved',
        record: r,
        days: sim.tickNum,
        score,
        peakUnemp: peakUnempRef.current,
      })
    }
  }, [endGame.open])

  // Drive the interval based on running state + speed
  useEffect(() => {
    if (!running) {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }
    intervalRef.current = window.setInterval(runTick, tickMsRef.current)
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [running, speedLabel, runTick])

  // Push tick interval to the city map for animation pacing
  useEffect(() => {
    cityRef.current?.setTickIntervalMs(tickMsRef.current)
  }, [speedLabel, simEpoch])

  // ---- callbacks ----

  const onLockdownChange = (level: number) => {
    setLockdownLevel(level)
    govRef.current.setLockdown(level)
  }
  const onMaskChange = (enabled: boolean) => {
    setMaskMandate(enabled)
    govRef.current.setMaskMandate(enabled)
  }
  const onVaccinationChange = (pct: number) => {
    setVaccinationPct(pct)
    govRef.current.setVaccinationRate(pct / 100)
  }
  const onStimulusChange = (amount: number) => {
    setStimulus(amount)
    govRef.current.setStimulus(amount)
  }
  const onSpeedChange = (label: string) => {
    setSpeedLabel(label)
    tickMsRef.current = SPEED_TO_MS[label] ?? 100
  }
  const onRunToggle = () => setRunning((v) => !v)
  const onStep = () => {
    if (running) setRunning(false)
    runTick()
  }
  const onReset = () => {
    setRunning(false)
    const { sim, gov } = newSim()
    simRef.current = sim
    govRef.current = gov
    setSimEpoch((e) => e + 1)
    setDay(0)
    setLastRecord(null)
    setCrisisScore(0)
    setEvents([])
    eventsKeySeen.current.clear()
    eventCounterRef.current = 0
    peakUnempRef.current = 0
    peakActiveRef.current = 0
    setEndGame((g) => ({ ...g, open: false }))
    // Apply current UI policy state to the fresh government
    gov.setLockdown(lockdownLevel)
    gov.setMaskMandate(maskMandate)
    gov.setVaccinationRate(vaccinationPct / 100)
    gov.setStimulus(stimulus)
  }
  const onReplay = () => {
    setEndGame((g) => ({ ...g, open: false }))
    onReset()
    setRunning(true)
  }

  // ---- render ----

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        lockdownLevel={lockdownLevel}
        maskMandate={maskMandate}
        vaccinationPct={vaccinationPct}
        stimulus={stimulus}
        speedLabel={speedLabel}
        running={running}
        day={day}
        lastRecord={lastRecord}
        crisisScore={crisisScore}
        events={events}
        onLockdownChange={onLockdownChange}
        onMaskChange={onMaskChange}
        onVaccinationChange={onVaccinationChange}
        onStimulusChange={onStimulusChange}
        onSpeedChange={onSpeedChange}
        onRunToggle={onRunToggle}
        onStep={onStep}
        onReset={onReset}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-card/50 px-4 py-2">
          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(v: string) => {
              if (v === 'city' || v === 'chart') setViewMode(v)
            }}
          >
            <ToggleGroupItem value="city">City View</ToggleGroupItem>
            <ToggleGroupItem value="chart">Chart View</ToggleGroupItem>
          </ToggleGroup>
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {viewMode === 'city'
              ? 'Drag to pan · scroll to zoom · click the minimap to jump'
              : 'Charts auto-update each tick'}
          </span>
        </header>
        <div className="relative min-h-0 flex-1">
          <div
            className="absolute inset-0"
            style={{ display: viewMode === 'city' ? 'block' : 'none' }}
          >
            <CityMap
              ref={cityRef}
              sim={simRef.current}
              simEpoch={simEpoch}
            />
            {viewMode === 'city' ? (
              <MapHud
                day={day}
                lockdownLevel={lockdownLevel}
                maskMandate={maskMandate}
                vaccinationPct={vaccinationPct}
                stimulus={stimulus}
                active={
                  lastRecord
                    ? lastRecord.exposed +
                      lastRecord.infectiousAsymptomatic +
                      lastRecord.infectiousSymptomatic
                    : 0
                }
                deaths={lastRecord?.dead ?? 0}
                hospitalPct={
                  lastRecord
                    ? (lastRecord.healthcarePatients /
                        Math.max(1, lastRecord.healthcareCapacity)) *
                      100
                    : 0
                }
                hospitalOverwhelmed={lastRecord?.healthcareOverwhelmed ?? false}
                bankInCrisis={lastRecord?.bankInCrisis ?? false}
                running={running}
              />
            ) : null}
          </div>
          <div
            className="absolute inset-0"
            style={{ display: viewMode === 'chart' ? 'block' : 'none' }}
          >
            <ChartView records={simRef.current.records} />
          </div>
        </div>
      </main>

      <EndGameModal
        open={endGame.open}
        onClose={() => setEndGame((g) => ({ ...g, open: false }))}
        onReplay={onReplay}
        reason={endGame.reason}
        finalRecord={endGame.record}
        daysSurvived={endGame.days}
        peakUnempPct={endGame.peakUnemp}
        crisisScore={endGame.score}
      />
    </div>
  )
}

export default App
