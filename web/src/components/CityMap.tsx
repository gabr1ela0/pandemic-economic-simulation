import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

import { CONFIG } from '@/sim/config'
import { HealthState } from '@/sim/agents'
import type { SimulationEngine } from '@/sim/simulation'
import {
  CITY_PROJ,
  DNIESTER,
  MAP_LOGICAL_H,
  MAP_LOGICAL_W,
  OUTLINE,
  PRUT,
  ROAD_SEGMENTS,
  distributeAroundCities,
  pointInOutline,
} from '@/sim/moldova'

// ---- visual constants ---------------------------------------------------

const COLOR_S = '#4a90d9'
const COLOR_E = '#f39c12'
const COLOR_IA = '#f1c40f'
const COLOR_IS = '#e74c3c'
const COLOR_R = '#2ecc71'

const COLOR_FOR_STATE: Record<number, string> = {
  [HealthState.Susceptible]: COLOR_S,
  [HealthState.Exposed]: COLOR_E,
  [HealthState.InfectiousAsymptomatic]: COLOR_IA,
  [HealthState.InfectiousSymptomatic]: COLOR_IS,
  [HealthState.Recovered]: COLOR_R,
}

const POVERTY_RING = '#ff8c1a'

const FLASH_COLORS = ['#ff6b5e', '#e74c3c', '#a83328']
const MAX_FLASH_LINES = 120
const FLASH_LIFETIME = 2

const RADIUS_NORMAL = 1.9
const RADIUS_SMALL = 1.2

// Agent sampling: at default zoom only a representative fraction of agents
// is drawn so dots don't swallow the buildings behind them. As the user zooms
// in, progressively more agents become visible.
const AGENT_SAMPLE_MIN = 1800
const AGENT_SAMPLE_FULL_ZOOM = 3.5

const B_COMPANY_ESS = '#5d6e8a'
const B_COMPANY_NON = '#384353'
const B_COMPANY_BANKRUPT = '#171c23'
const B_COMPANY_OUTLINE = '#22293a'
const B_COMPANY_STRUGGLE = '#ff8c1a'
const B_HOUSE = '#c8a97e'
const B_HOUSE_INFECTED = '#c87a6e'
const B_HOUSE_DARK = '#3a3a3a'
const B_HOUSE_OUTLINE = '#5a4a3e'
const B_MARKET = '#5dade2'
const B_MARKET_OUTLINE = '#1a5a8c'
const B_HOSPITAL = '#f4f4f4'
const B_HOSPITAL_FLASH = '#ff5050'
const B_HOSPITAL_CROSS = '#cc0000'
const B_UNEMP = '#b8941f'
const B_UNEMP_OUTLINE = '#5a4400'

const COUNTRY_FILL = '#152034'
const COUNTRY_OUTLINE = '#3b5279'
const COUNTRY_VOID_NIGHT = '#03050a'
const COUNTRY_VOID_DAY = '#091221'
const RIVER_COLOR = '#2c79b6'

const MIN_ZOOM = 0.25
const MAX_ZOOM = 5.0
const DEFAULT_ZOOM = 1.4
const LOW_ZOOM_THRESHOLD = 0.55

const NUM_MARKETS = 25
const NUM_HOSPITALS = 6
const NUM_UNEMP_OFFICES = 4
const NUM_HOUSES = Math.max(1, Math.floor(CONFIG.NUM_AGENTS / 10))

const MINIMAP_W = 180
const MINIMAP_H = 150
const MINIMAP_PAD = 12

const DAY_LENGTH_TICKS = 30 // 30 sim days = 1 visual day/night cycle

const WEATHER_CYCLE_MS = 30_000

// ---- types --------------------------------------------------------------

type BuildingKind = 'company' | 'house' | 'market' | 'hospital' | 'unemp'

interface Building {
  kind: BuildingKind
  id: number
  cityIdx: number
  cx: number
  cy: number
  w: number
  h: number
  // Company-only
  sector?: 'Essential' | 'Non-Essential'
  // House-only: cached per-render fill colour
  fill?: string
  // Market-only
  visits?: number
  // Animation: 0..1 progress for bankruptcy fade
  bankruptFade?: number
}

interface FlashLine {
  ax: number
  ay: number
  bx: number
  by: number
  ticksRemaining: number
}

type EffectKind = 'death' | 'recovery' | 'bankruptcy'

interface Effect {
  kind: EffectKind
  x: number
  y: number
  startMs: number
  durationMs: number
  /** For bankruptcy debris. */
  particles?: { x: number; y: number; vx: number; vy: number }[]
}

interface Cloud {
  x: number
  y: number
  vx: number
  r: number
  alpha: number
}

interface Layout {
  companies: Building[]
  houses: Building[]
  markets: Building[]
  hospitals: Building[]
  unemps: Building[]
  all: Building[]
  /** Lookup: agent index -> nearest hospital building idx (used by tooltips). */
  agentToHospital: Int32Array | null
}

interface MapData {
  n: number
  nHouses: number
  houseId: Int32Array
  /** For each agent: index in `layout.markets` they go to when shopping. */
  marketAssignment: Int32Array
  /** For each agent: index in `layout.unemps` they drift to when jobless. */
  unempAssignment: Int32Array
  jitterX: Float32Array
  jitterY: Float32Array
  staggerOffset: Float32Array
  /** Per-agent perpendicular path curvature for slight bezier wobble. */
  pathCurve: Float32Array
  coPosX: Float32Array
  coPosY: Float32Array
  housePosX: Float32Array
  housePosY: Float32Array
  marketPosX: Float32Array
  marketPosY: Float32Array
  unempPosX: Float32Array
  unempPosY: Float32Array
  startX: Float32Array
  startY: Float32Array
  targetX: Float32Array
  targetY: Float32Array
  prevHealth: Int8Array
  prevAlive: Uint8Array
  prevCo: Int32Array
  prevBankrupt: Uint8Array
  prevStruggling: Uint8Array
  /** Shuffled agent draw order — first K elements form a representative sample. */
  renderOrder: Int32Array
  flashLines: FlashLine[]
  effects: Effect[]
  tickStartPerf: number
  tickIntervalSec: number
  pulsePhase: number
  minimapGeom: { x: number; y: number; w: number; h: number }
  hoveredBuildingKey: string | null
  /** Drift state for sky background / clouds. */
  weatherClouds: Cloud[]
  weatherIsRaining: boolean
  weatherCycleStart: number
}

export interface CityMapHandle {
  onTick: () => void
  setTickIntervalMs: (ms: number) => void
  resetView: () => void
}

interface CityMapProps {
  sim: SimulationEngine
  simEpoch: number
}

// ---- helpers ------------------------------------------------------------

function seededJitter(seed: number, n: number, low: number, high: number): Float32Array {
  let s = seed >>> 0
  if (s === 0) s = 0x9e3779b9
  const out = new Float32Array(n)
  const range = high - low
  for (let i = 0; i < n; i++) {
    let t = (s += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296
    out[i] = low + r * range
  }
  return out
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0
  if (s === 0) s = 0x9e3779b9
  return () => {
    let t = (s += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function smoothstep(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return t * t * (3 - 2 * t)
}

function computeAgentSampleLimit(scale: number, n: number): number {
  if (n <= AGENT_SAMPLE_MIN) return n
  if (scale >= AGENT_SAMPLE_FULL_ZOOM) return n
  if (scale <= DEFAULT_ZOOM) return AGENT_SAMPLE_MIN
  const t = (scale - DEFAULT_ZOOM) / (AGENT_SAMPLE_FULL_ZOOM - DEFAULT_ZOOM)
  return Math.min(n, Math.floor(AGENT_SAMPLE_MIN + (n - AGENT_SAMPLE_MIN) * t))
}

function generateLayout(
  companies: { sector: 'Essential' | 'Non-Essential' }[],
): Layout {
  const rng = makeRng(20260511)

  // Houses ~ population-distributed. Min-distance keeps a clear street gap
  // between rows so the country fill reads as roads, not floor tiles.
  const housePlacements = distributeAroundCities(NUM_HOUSES, rng, 1.3, 18)
  const houseB: Building[] = housePlacements.map((p, i) => ({
    kind: 'house',
    id: i,
    cityIdx: p.cityIdx,
    cx: p.x,
    cy: p.y,
    w: 14,
    h: 12,
    fill: B_HOUSE,
  }))

  const companyPlacements = distributeAroundCities(companies.length, rng, 1.0, 44)
  const companyB: Building[] = companyPlacements.map((p, i) => ({
    kind: 'company',
    id: i,
    cityIdx: p.cityIdx,
    cx: p.x,
    cy: p.y,
    w: 34,
    h: 26,
    sector: companies[i].sector,
    bankruptFade: 0,
  }))

  // Markets: at the bigger cities mostly; spread a few to smaller towns.
  // Use distribute but with smaller spread so they cluster near city centres.
  const marketPlacements = distributeAroundCities(NUM_MARKETS, rng, 0.7, 36)
  const marketB: Building[] = marketPlacements.map((p, i) => ({
    kind: 'market',
    id: i,
    cityIdx: p.cityIdx,
    cx: p.x,
    cy: p.y,
    w: 28,
    h: 22,
    visits: 0,
  }))

  // Hospitals: prioritise the largest cities. Chișinău gets 2 because it's huge.
  const hospitalCityOrder = [...CITY_PROJ]
    .map((c, idx) => ({ c, idx }))
    .sort((a, b) => b.c.pop - a.c.pop)
  const hospitalSpec: { cityIdx: number; offset: [number, number] }[] = []
  // Chișinău twice (different neighbourhoods)
  hospitalSpec.push({ cityIdx: hospitalCityOrder[0].idx, offset: [-110, -70] })
  hospitalSpec.push({ cityIdx: hospitalCityOrder[0].idx, offset: [120, 80] })
  // Then top-N others
  for (let i = 1; i < NUM_HOSPITALS - 1; i++) {
    hospitalSpec.push({ cityIdx: hospitalCityOrder[i].idx, offset: [0, 0] })
  }
  const hospitalB: Building[] = hospitalSpec.slice(0, NUM_HOSPITALS).map((spec, i) => {
    const city = CITY_PROJ[spec.cityIdx]
    return {
      kind: 'hospital',
      id: i,
      cityIdx: spec.cityIdx,
      cx: city.x + spec.offset[0],
      cy: city.y + spec.offset[1],
      w: 58,
      h: 46,
    }
  })

  // Unemployment offices: 4 biggest cities
  const unempB: Building[] = []
  for (let i = 0; i < NUM_UNEMP_OFFICES; i++) {
    const city = CITY_PROJ[hospitalCityOrder[i].idx]
    unempB.push({
      kind: 'unemp',
      id: i,
      cityIdx: hospitalCityOrder[i].idx,
      cx: city.x + 140,
      cy: city.y - 100,
      w: 36,
      h: 28,
    })
  }

  return {
    companies: companyB,
    houses: houseB,
    markets: marketB,
    hospitals: hospitalB,
    unemps: unempB,
    all: [...houseB, ...companyB, ...marketB, ...hospitalB, ...unempB],
    agentToHospital: null,
  }
}

// Pick the nearest item index from a list of (x,y) for a given (x,y).
function nearestIndex(
  xs: Float32Array,
  ys: Float32Array,
  x: number,
  y: number,
): number {
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - x
    const dy = ys[i] - y
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

// ---- component ----------------------------------------------------------

export const CityMap = forwardRef<CityMapHandle, CityMapProps>(function CityMap(
  { sim, simEpoch },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)

  const simRef = useRef(sim)
  simRef.current = sim

  const transformRef = useRef({
    offsetX: 0,
    offsetY: 0,
    scale: DEFAULT_ZOOM,
  })
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(
    null,
  )

  const layoutRef = useRef<Layout | null>(null)
  const dataRef = useRef<MapData | null>(null)

  // ---- imperative API -------------------------------------------------

  const onTickInternal = () => {
    const data = dataRef.current
    const layout = layoutRef.current
    if (!data || !layout) return
    const s = simRef.current
    const a = s.agents
    const n = a.n

    // Carry interpolated position forward as the new start.
    const elapsed = performance.now() / 1000 - data.tickStartPerf
    const baseT = Math.min(1, elapsed / Math.max(0.001, data.tickIntervalSec))
    for (let i = 0; i < n; i++) {
      const lt = Math.min(
        1,
        Math.max(0, (baseT - data.staggerOffset[i]) / Math.max(0.05, 1 - data.staggerOffset[i])),
      )
      const eased = smoothstep(lt)
      data.startX[i] = data.startX[i] + (data.targetX[i] - data.startX[i]) * eased
      data.startY[i] = data.startY[i] + (data.targetY[i] - data.startY[i]) * eased
    }

    const atWork = s.atWork
    const atMarket = s.atMarket
    const nMkt = layout.markets.length
    for (let i = 0; i < nMkt; i++) layout.markets[i].visits = 0

    for (let i = 0; i < n; i++) {
      let tx: number
      let ty: number
      if (a.isAlive[i] === 0) {
        tx = data.targetX[i]
        ty = data.targetY[i]
      } else if (atWork[i] && a.employed[i] && a.companyId[i] >= 0) {
        const co = a.companyId[i]
        tx = data.coPosX[co] + data.jitterX[i]
        ty = data.coPosY[co] + data.jitterY[i]
      } else if (atMarket[i] && nMkt > 0) {
        const m = data.marketAssignment[i]
        tx = data.marketPosX[m] + data.jitterX[i]
        ty = data.marketPosY[m] + data.jitterY[i]
        layout.markets[m].visits!++
      } else if (a.employed[i] === 0 && layout.unemps.length > 0 && i % 2 === 0) {
        const u = data.unempAssignment[i]
        tx = data.unempPosX[u] + data.jitterX[i] * 1.4
        ty = data.unempPosY[u] + data.jitterY[i] * 1.4
      } else {
        const h = data.houseId[i]
        tx = data.housePosX[h] + data.jitterX[i]
        ty = data.housePosY[h] + data.jitterY[i]
      }
      data.targetX[i] = Math.max(20, Math.min(MAP_LOGICAL_W - 20, tx))
      data.targetY[i] = Math.max(20, Math.min(MAP_LOGICAL_H - 20, ty))
    }

    data.tickStartPerf = performance.now() / 1000

    // Decay flash lines
    const kept: FlashLine[] = []
    for (const f of data.flashLines) {
      f.ticksRemaining--
      if (f.ticksRemaining > 0) kept.push(f)
    }
    data.flashLines = kept

    // Spawn flashes for new exposures (S -> E)
    const prevInfByCo = new Map<number, number>()
    let prevInfFallback = -1
    for (let i = 0; i < n; i++) {
      const ph = data.prevHealth[i]
      if (
        ph === HealthState.InfectiousAsymptomatic ||
        ph === HealthState.InfectiousSymptomatic
      ) {
        if (prevInfFallback < 0) prevInfFallback = i
        const co = data.prevCo[i]
        if (co >= 0 && !prevInfByCo.has(co)) prevInfByCo.set(co, i)
      }
    }
    if (prevInfFallback >= 0) {
      for (let i = 0; i < n; i++) {
        if (data.flashLines.length >= MAX_FLASH_LINES) break
        if (
          data.prevHealth[i] === HealthState.Susceptible &&
          a.healthState[i] === HealthState.Exposed
        ) {
          const co = a.companyId[i] >= 0 ? a.companyId[i] : data.prevCo[i]
          const infector =
            (co >= 0 ? prevInfByCo.get(co) : undefined) ?? prevInfFallback
          data.flashLines.push({
            ax: data.targetX[infector],
            ay: data.targetY[infector],
            bx: data.targetX[i],
            by: data.targetY[i],
            ticksRemaining: FLASH_LIFETIME,
          })
        }
      }
    }

    // ---- Per-agent event animations: deaths + recoveries ----
    const nowMs = performance.now()
    const Recovered = HealthState.Recovered
    for (let i = 0; i < n; i++) {
      // Death
      if (data.prevAlive[i] === 1 && a.isAlive[i] === 0) {
        if (data.effects.length < 220) {
          data.effects.push({
            kind: 'death',
            x: data.startX[i],
            y: data.startY[i],
            startMs: nowMs,
            durationMs: 1200,
          })
        }
      }
      // Recovery (transition into Recovered state)
      if (data.prevHealth[i] !== Recovered && a.healthState[i] === Recovered) {
        if (data.effects.length < 220) {
          data.effects.push({
            kind: 'recovery',
            x: data.startX[i],
            y: data.startY[i],
            startMs: nowMs,
            durationMs: 750,
          })
        }
      }
    }

    // Companies — bankruptcy / struggling
    const cur_bankrupt = data.prevBankrupt
    const cur_struggling = data.prevStruggling
    for (let i = 0; i < s.companies.length; i++) {
      const wasBankrupt = cur_bankrupt[i] === 1
      const isBankrupt = s.companies[i].bankrupt
      cur_bankrupt[i] = isBankrupt ? 1 : 0
      cur_struggling[i] = s.companies[i].isStruggling && !isBankrupt ? 1 : 0
      if (isBankrupt && !wasBankrupt) {
        layout.companies[i].bankruptFade = 0  // start the fill fade
        // Spawn debris particles
        if (data.effects.length < 220) {
          const b = layout.companies[i]
          const particles: { x: number; y: number; vx: number; vy: number }[] = []
          for (let k = 0; k < 14; k++) {
            const angle = (k / 14) * Math.PI * 2 + Math.random() * 0.4
            const speed = 60 + Math.random() * 50
            particles.push({
              x: b.cx,
              y: b.cy,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
            })
          }
          data.effects.push({
            kind: 'bankruptcy',
            x: b.cx,
            y: b.cy,
            startMs: nowMs,
            durationMs: 1500,
            particles,
          })
        }
      }
    }

    // House tinting
    const nHouses = layout.houses.length
    const symPerHouse = new Int32Array(nHouses)
    const alivePerHouse = new Int32Array(nHouses)
    const brokeUnempPerHouse = new Int32Array(nHouses)
    for (let i = 0; i < n; i++) {
      const h = data.houseId[i]
      if (a.isAlive[i]) {
        alivePerHouse[h]++
        if (a.healthState[i] === HealthState.InfectiousSymptomatic)
          symPerHouse[h]++
        if (
          !a.employed[i] &&
          a.wallet[i] < CONFIG.STIMULUS_WALLET_THRESHOLD
        )
          brokeUnempPerHouse[h]++
      }
    }
    for (let i = 0; i < nHouses; i++) {
      let fill = B_HOUSE
      if (alivePerHouse[i] === 0) fill = B_HOUSE_DARK
      else if (brokeUnempPerHouse[i] >= alivePerHouse[i]) fill = B_HOUSE_DARK
      else if (symPerHouse[i] > 0) fill = B_HOUSE_INFECTED
      layout.houses[i].fill = fill
    }

    data.prevHealth.set(a.healthState)
    data.prevAlive.set(a.isAlive)
    data.prevCo.set(a.companyId)
  }

  useImperativeHandle(ref, () => ({
    onTick: () => onTickInternal(),
    setTickIntervalMs: (ms: number) => {
      if (dataRef.current) {
        dataRef.current.tickIntervalSec = Math.max(0.020, ms / 1000)
      }
    },
    resetView: () => {
      const cv = canvasRef.current
      if (!cv) return
      fitToMap(cv.clientWidth, cv.clientHeight)
    },
  }))

  // ---- layout setup ---------------------------------------------------

  const fitToMap = (w: number, h: number) => {
    // Default view: zoomed in on Chișinău where most of the action lives.
    const chisinau = CITY_PROJ.find((c) => c.name === 'Chișinău')
    const cx = chisinau?.x ?? MAP_LOGICAL_W / 2
    const cy = chisinau?.y ?? MAP_LOGICAL_H / 2
    transformRef.current.scale = DEFAULT_ZOOM
    transformRef.current.offsetX = cx - w / DEFAULT_ZOOM / 2
    transformRef.current.offsetY = cy - h / DEFAULT_ZOOM / 2
  }
  const fitWholeCountry = (w: number, h: number) => {
    const sx = w / MAP_LOGICAL_W
    const sy = h / MAP_LOGICAL_H
    const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(sx, sy) * 0.95))
    transformRef.current.scale = scale
    transformRef.current.offsetX = MAP_LOGICAL_W / 2 - w / scale / 2
    transformRef.current.offsetY = MAP_LOGICAL_H / 2 - h / scale / 2
  }

  useEffect(() => {
    const s = simRef.current
    const n = s.agents.n
    const layout = generateLayout(s.companies)
    layoutRef.current = layout

    const houseId = new Int32Array(n)
    for (let i = 0; i < n; i++) {
      houseId[i] = Math.min(Math.floor(i / 10), layout.houses.length - 1)
    }

    const jitterX = seededJitter(20260511, n, -10, 10)
    const jitterY = seededJitter(20260512, n, -10, 10)
    const staggerOffset = seededJitter(20260513, n, 0, 0.20)
    const pathCurve = seededJitter(20260514, n, -0.18, 0.18)

    const coPosX = new Float32Array(layout.companies.length)
    const coPosY = new Float32Array(layout.companies.length)
    for (let i = 0; i < layout.companies.length; i++) {
      coPosX[i] = layout.companies[i].cx
      coPosY[i] = layout.companies[i].cy
    }
    const housePosX = new Float32Array(layout.houses.length)
    const housePosY = new Float32Array(layout.houses.length)
    for (let i = 0; i < layout.houses.length; i++) {
      housePosX[i] = layout.houses[i].cx
      housePosY[i] = layout.houses[i].cy
    }
    const marketPosX = new Float32Array(layout.markets.length)
    const marketPosY = new Float32Array(layout.markets.length)
    for (let i = 0; i < layout.markets.length; i++) {
      marketPosX[i] = layout.markets[i].cx
      marketPosY[i] = layout.markets[i].cy
    }
    const unempPosX = new Float32Array(layout.unemps.length)
    const unempPosY = new Float32Array(layout.unemps.length)
    for (let i = 0; i < layout.unemps.length; i++) {
      unempPosX[i] = layout.unemps[i].cx
      unempPosY[i] = layout.unemps[i].cy
    }

    // Per-agent assignments — nearest market / unemp office to their home.
    const marketAssignment = new Int32Array(n)
    const unempAssignment = new Int32Array(n)
    for (let i = 0; i < n; i++) {
      const hx = housePosX[houseId[i]]
      const hy = housePosY[houseId[i]]
      marketAssignment[i] = nearestIndex(marketPosX, marketPosY, hx, hy)
      unempAssignment[i] = nearestIndex(unempPosX, unempPosY, hx, hy)
    }

    const startX = new Float32Array(n)
    const startY = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      startX[i] = housePosX[houseId[i]] + jitterX[i]
      startY[i] = housePosY[houseId[i]] + jitterY[i]
    }
    const targetX = startX.slice()
    const targetY = startY.slice()

    // Shuffled agent render order so the first K agents form a uniform sample
    // across both index space and (via 10-per-house assignment) all geography.
    const renderOrder = new Int32Array(n)
    for (let i = 0; i < n; i++) renderOrder[i] = i
    const shuffleRng = makeRng(20260518)
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(shuffleRng() * (i + 1))
      const tmp = renderOrder[i]
      renderOrder[i] = renderOrder[j]
      renderOrder[j] = tmp
    }

    // Initial cloud field
    const clouds: Cloud[] = []
    const cRng = makeRng(20260520)
    for (let i = 0; i < 6; i++) {
      clouds.push({
        x: cRng() * MAP_LOGICAL_W,
        y: 100 + cRng() * (MAP_LOGICAL_H - 200),
        vx: 4 + cRng() * 6,
        r: 90 + cRng() * 70,
        alpha: 0.07 + cRng() * 0.06,
      })
    }

    dataRef.current = {
      n,
      nHouses: layout.houses.length,
      houseId,
      marketAssignment,
      unempAssignment,
      jitterX,
      jitterY,
      staggerOffset,
      pathCurve,
      coPosX,
      coPosY,
      housePosX,
      housePosY,
      marketPosX,
      marketPosY,
      unempPosX,
      unempPosY,
      startX,
      startY,
      targetX,
      targetY,
      prevHealth: new Int8Array(s.agents.healthState),
      prevAlive: new Uint8Array(s.agents.isAlive),
      prevCo: new Int32Array(s.agents.companyId),
      prevBankrupt: new Uint8Array(s.companies.length),
      prevStruggling: new Uint8Array(s.companies.length),
      renderOrder,
      flashLines: [],
      effects: [],
      tickStartPerf: performance.now() / 1000,
      tickIntervalSec: 0.1,
      pulsePhase: 0,
      minimapGeom: { x: 0, y: 0, w: 0, h: 0 },
      hoveredBuildingKey: null,
      weatherClouds: clouds,
      weatherIsRaining: false,
      weatherCycleStart: performance.now(),
    }

    const cv = canvasRef.current
    if (cv) fitToMap(cv.clientWidth, cv.clientHeight)
  }, [simEpoch])

  // ---- canvas sizing --------------------------------------------------

  useEffect(() => {
    const container = containerRef.current
    const cv = canvasRef.current
    if (!container || !cv) return
    const ro = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      cv.width = Math.max(1, Math.floor(rect.width * dpr))
      cv.height = Math.max(1, Math.floor(rect.height * dpr))
      cv.style.width = `${rect.width}px`
      cv.style.height = `${rect.height}px`
      const ctx = cv.getContext('2d')
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  // ---- mouse handlers -------------------------------------------------

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return

    const toLogical = (sx: number, sy: number) => {
      const t = transformRef.current
      return { lx: sx / t.scale + t.offsetX, ly: sy / t.scale + t.offsetY }
    }
    const isInMinimap = (sx: number, sy: number) => {
      const g = dataRef.current?.minimapGeom
      if (!g || g.w === 0) return false
      return sx >= g.x && sx <= g.x + g.w && sy >= g.y && sy <= g.y + g.h
    }
    const buildingAt = (lx: number, ly: number): Building | null => {
      const layout = layoutRef.current
      if (!layout) return null
      for (const b of layout.all) {
        if (
          Math.abs(lx - b.cx) <= b.w / 2 &&
          Math.abs(ly - b.cy) <= b.h / 2
        ) {
          return b
        }
      }
      return null
    }

    const onPointerDown = (e: PointerEvent) => {
      const rect = cv.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      if (isInMinimap(sx, sy)) {
        const g = dataRef.current!.minimapGeom
        const lx = ((sx - g.x) / g.w) * MAP_LOGICAL_W
        const ly = ((sy - g.y) / g.h) * MAP_LOGICAL_H
        const t = transformRef.current
        t.offsetX = lx - cv.clientWidth / (2 * t.scale)
        t.offsetY = ly - cv.clientHeight / (2 * t.scale)
        return
      }
      dragRef.current = {
        x: sx,
        y: sy,
        ox: transformRef.current.offsetX,
        oy: transformRef.current.offsetY,
      }
      cv.setPointerCapture(e.pointerId)
    }
    const onPointerMove = (e: PointerEvent) => {
      const rect = cv.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      if (dragRef.current) {
        const t = transformRef.current
        t.offsetX = dragRef.current.ox - (sx - dragRef.current.x) / t.scale
        t.offsetY = dragRef.current.oy - (sy - dragRef.current.y) / t.scale
        return
      }
      const tip = tooltipRef.current
      const data = dataRef.current
      const layout = layoutRef.current
      if (!tip || !data || !layout) return
      if (isInMinimap(sx, sy)) {
        tip.style.opacity = '0'
        data.hoveredBuildingKey = null
        return
      }
      const { lx, ly } = toLogical(sx, sy)
      const hovered = buildingAt(lx, ly)
      if (!hovered) {
        tip.style.opacity = '0'
        data.hoveredBuildingKey = null
        return
      }
      const key = `${hovered.kind}-${hovered.id}`
      data.hoveredBuildingKey = key
      tip.textContent = tooltipText(simRef.current, hovered, layout, data)
      tip.style.opacity = '1'
      tip.style.left = `${sx + 14}px`
      tip.style.top = `${sy + 12}px`
    }
    const onPointerUp = (e: PointerEvent) => {
      dragRef.current = null
      try {
        cv.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }
    const onPointerLeave = () => {
      const tip = tooltipRef.current
      if (tip) tip.style.opacity = '0'
      const data = dataRef.current
      if (data) data.hoveredBuildingKey = null
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = cv.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const direction = e.deltaY < 0 ? 1 : -1
      const factor = direction > 0 ? 1.18 : 1 / 1.18
      const t = transformRef.current
      const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, t.scale * factor))
      if (newScale === t.scale) return
      const lx = sx / t.scale + t.offsetX
      const ly = sy / t.scale + t.offsetY
      t.scale = newScale
      t.offsetX = lx - sx / newScale
      t.offsetY = ly - sy / newScale
    }

    cv.addEventListener('pointerdown', onPointerDown)
    cv.addEventListener('pointermove', onPointerMove)
    cv.addEventListener('pointerup', onPointerUp)
    cv.addEventListener('pointerleave', onPointerLeave)
    cv.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      cv.removeEventListener('pointerdown', onPointerDown)
      cv.removeEventListener('pointermove', onPointerMove)
      cv.removeEventListener('pointerup', onPointerUp)
      cv.removeEventListener('pointerleave', onPointerLeave)
      cv.removeEventListener('wheel', onWheel)
    }
  }, [])

  // ---- render loop ----------------------------------------------------

  useEffect(() => {
    let raf = 0
    const targetInterval = 1000 / 30
    let lastFrame = 0

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (now - lastFrame < targetInterval) return
      lastFrame = now
      try {
        renderFrame()
      } catch (err) {
        console.error(err)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const renderFrame = () => {
    const cv = canvasRef.current
    const data = dataRef.current
    const layout = layoutRef.current
    if (!cv || !data || !layout) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    const W = cv.clientWidth
    const H = cv.clientHeight
    const t = transformRef.current
    const s = simRef.current
    const a = s.agents

    // ---- day/night cycle ----
    const dayPhase = (s.tickNum % DAY_LENGTH_TICKS) / DAY_LENGTH_TICKS
    // 0 = noon, 0.5 = midnight, smooth cosine
    const lightness = 0.5 + 0.5 * Math.cos(dayPhase * Math.PI * 2)
    const voidColor = lerpHex(COUNTRY_VOID_NIGHT, COUNTRY_VOID_DAY, lightness)
    const countryFillColor = lerpHex('#0a1322', COUNTRY_FILL, lightness)
    const skyTint = lerpHex('#000814', '#1a2638', lightness)

    // ---- background ----
    ctx.fillStyle = skyTint
    ctx.fillRect(0, 0, W, H)

    // Apply transform
    ctx.save()
    ctx.translate(-t.offsetX * t.scale, -t.offsetY * t.scale)
    ctx.scale(t.scale, t.scale)

    // ---- fill outside the country (slightly different shade) ----
    // Draw the void rectangle, then cut out the country with composite.
    // Easiest: just fill the whole map area with void, then fill the country
    // outline on top.
    ctx.fillStyle = voidColor
    ctx.fillRect(0, 0, MAP_LOGICAL_W, MAP_LOGICAL_H)

    // Country fill
    ctx.fillStyle = countryFillColor
    drawPolygon(ctx, OUTLINE, true, false)

    // Rivers
    ctx.strokeStyle = RIVER_COLOR
    ctx.globalAlpha = 0.85
    ctx.lineWidth = 4 / t.scale
    drawPolyline(ctx, PRUT)
    drawPolyline(ctx, DNIESTER)
    ctx.globalAlpha = 1

    // Roads
    ctx.strokeStyle = '#3a4658'
    ctx.lineWidth = 2 / t.scale
    ctx.beginPath()
    for (const r of ROAD_SEGMENTS) {
      ctx.moveTo(r.ax, r.ay)
      ctx.lineTo(r.bx, r.by)
    }
    ctx.stroke()

    // ---- lockdown tint inside the country (subtle, scales with level) ----
    const lockdownLevel = s.government.lockdownLevel
    if (lockdownLevel > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(OUTLINE[0].x, OUTLINE[0].y)
      for (let i = 1; i < OUTLINE.length; i++) ctx.lineTo(OUTLINE[i].x, OUTLINE[i].y)
      ctx.closePath()
      ctx.clip()
      ctx.fillStyle = `rgba(231, 76, 60, ${(lockdownLevel * 0.04).toFixed(3)})`
      ctx.fillRect(0, 0, MAP_LOGICAL_W, MAP_LOGICAL_H)
      ctx.restore()
    }

    // ---- buildings ----
    drawBuildings(
      ctx,
      layout,
      t.scale,
      data,
      s.healthcare.overwhelmed,
      lockdownLevel,
    )

    // ---- hospital overflow crowd (red dots queueing outside when overwhelmed) ----
    if (s.healthcare.overwhelmed && layout.hospitals.length > 0) {
      const overflow = Math.max(
        0,
        s.healthcare.currentPatients - s.healthcare.bedCapacity,
      )
      const perHospital = Math.min(
        24,
        Math.ceil(overflow / layout.hospitals.length),
      )
      const wobble = (performance.now() / 800) % (Math.PI * 2)
      ctx.fillStyle = '#e74c3c'
      for (const h of layout.hospitals) {
        for (let i = 0; i < perHospital; i++) {
          const angle = (i / perHospital) * Math.PI * 2 + wobble * 0.15
          const dist = h.w * 0.65 + (i % 3) * 4
          const x = h.cx + Math.cos(angle) * dist
          const y = h.cy + Math.sin(angle) * dist
          ctx.beginPath()
          ctx.arc(x, y, 2.2, 0, 2 * Math.PI)
          ctx.fill()
        }
      }
    }

    // ---- transmission flashes (subtle) ----
    if (data.flashLines.length > 0) {
      ctx.lineWidth = 0.8 / t.scale
      for (const f of data.flashLines) {
        const idx = Math.max(
          0,
          Math.min(FLASH_COLORS.length - 1, FLASH_LIFETIME - f.ticksRemaining),
        )
        ctx.strokeStyle = FLASH_COLORS[idx]
        ctx.globalAlpha = (f.ticksRemaining / FLASH_LIFETIME) * 0.30
        ctx.beginPath()
        ctx.moveTo(f.ax, f.ay)
        ctx.lineTo(f.bx, f.by)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    // ---- agents ----
    const elapsedSec = performance.now() / 1000 - data.tickStartPerf
    const baseT = Math.min(1, elapsedSec / Math.max(0.001, data.tickIntervalSec))
    drawAgents(ctx, a, data, t.scale, baseT)

    // ---- ephemeral effects (deaths, recoveries, bankruptcy debris) ----
    drawEffects(ctx, data, t.scale, performance.now())

    // ---- country boundary stroke ----
    ctx.strokeStyle = COUNTRY_OUTLINE
    ctx.lineWidth = 2 / t.scale
    drawPolygon(ctx, OUTLINE, false, true)

    // ---- city labels (zoom-faded) ----
    drawCityLabels(ctx, t.scale)

    // ---- weather overlay (clouds) ----
    drawWeather(ctx, data, t.scale, performance.now())

    ctx.restore()

    // ---- night vignette ----
    if (lightness < 0.6) {
      const vignette = (0.6 - lightness) * 0.6
      ctx.fillStyle = `rgba(2, 4, 12, ${vignette.toFixed(2)})`
      ctx.fillRect(0, 0, W, H)
    }

    // ---- screen-space lockdown alert border (pulsing red on full lockdown) ----
    if (lockdownLevel >= 2) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 380)
      const alpha = (lockdownLevel === 3 ? 0.55 : 0.32) * pulse
      ctx.strokeStyle = `rgba(239, 68, 68, ${alpha.toFixed(2)})`
      ctx.lineWidth = lockdownLevel === 3 ? 6 : 4
      ctx.strokeRect(2, 2, W - 4, H - 4)
    }

    // ---- minimap (screen space) ----
    drawMinimap(ctx, W, H, layout, t, data)

    data.pulsePhase += 1 / 30
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-grab active:cursor-grabbing"
      />
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute z-10 max-w-xs whitespace-pre rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg backdrop-blur transition-opacity duration-150"
        style={{ opacity: 0, left: 0, top: 0 }}
      />
    </div>
  )
})

// ---- drawing helpers ----------------------------------------------------

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  fill: boolean,
  stroke: boolean,
): void {
  if (pts.length === 0) return
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.closePath()
  if (fill) ctx.fill()
  if (stroke) ctx.stroke()
}

function drawPolyline(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
): void {
  if (pts.length === 0) return
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.stroke()
}

function drawBuildings(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  scale: number,
  data: MapData,
  hospitalOverwhelmed: boolean,
  lockdownLevel: number,
): void {
  // Houses
  ctx.lineWidth = 0.5 / scale
  for (const h of layout.houses) {
    ctx.fillStyle = h.fill || B_HOUSE
    ctx.fillRect(h.cx - h.w / 2, h.cy - h.h / 2, h.w, h.h)
    if (scale > 0.7) {
      ctx.strokeStyle = B_HOUSE_OUTLINE
      ctx.strokeRect(h.cx - h.w / 2, h.cy - h.h / 2, h.w, h.h)
    }
  }

  // Companies (with bankruptcy fade + closed-on-lockdown markers)
  const pulseFast = Math.sin(data.pulsePhase * 6) > 0
  for (let i = 0; i < layout.companies.length; i++) {
    const c = layout.companies[i]
    const bankrupt = data.prevBankrupt[i] === 1
    const struggling = data.prevStruggling[i] === 1
    const closedByLockdown =
      !bankrupt && c.sector === 'Non-Essential' && lockdownLevel >= 2
    let fill: string
    if (bankrupt) {
      const fade = c.bankruptFade ?? 0
      const baseFill = c.sector === 'Essential' ? B_COMPANY_ESS : B_COMPANY_NON
      fill = lerpHex(baseFill, B_COMPANY_BANKRUPT, Math.min(1, fade))
      c.bankruptFade = Math.min(1, fade + 1 / 30)
    } else if (closedByLockdown) {
      const baseFill = B_COMPANY_NON
      fill = lerpHex(baseFill, '#1f2733', 0.55)
    } else {
      fill = c.sector === 'Essential' ? B_COMPANY_ESS : B_COMPANY_NON
    }
    ctx.fillStyle = fill
    ctx.fillRect(c.cx - c.w / 2, c.cy - c.h / 2, c.w, c.h)
    ctx.strokeStyle =
      struggling && pulseFast ? B_COMPANY_STRUGGLE : B_COMPANY_OUTLINE
    ctx.lineWidth = struggling ? 1.4 / scale : 0.7 / scale
    ctx.strokeRect(c.cx - c.w / 2, c.cy - c.h / 2, c.w, c.h)
    if (bankrupt) {
      ctx.strokeStyle = '#aa1010'
      ctx.lineWidth = 1.5 / scale
      ctx.beginPath()
      ctx.moveTo(c.cx - c.w / 2, c.cy - c.h / 2)
      ctx.lineTo(c.cx + c.w / 2, c.cy + c.h / 2)
      ctx.moveTo(c.cx - c.w / 2, c.cy + c.h / 2)
      ctx.lineTo(c.cx + c.w / 2, c.cy - c.h / 2)
      ctx.stroke()
    } else if (closedByLockdown && scale > 0.6) {
      // Small grey ✕ to signal "closed by mandate"
      ctx.strokeStyle = '#7a8aa3'
      ctx.lineWidth = 1.2 / scale
      const m = Math.min(c.w, c.h) * 0.32
      ctx.beginPath()
      ctx.moveTo(c.cx - m, c.cy - m * 0.8)
      ctx.lineTo(c.cx + m, c.cy + m * 0.8)
      ctx.moveTo(c.cx - m, c.cy + m * 0.8)
      ctx.lineTo(c.cx + m, c.cy - m * 0.8)
      ctx.stroke()
    }
    if (scale > 1.1) {
      ctx.fillStyle = bankrupt
        ? '#aa1010'
        : closedByLockdown
          ? '#586478'
          : '#aab2c8'
      ctx.font = '6px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(c.sector === 'Essential' ? 'E' : 'NE', c.cx, c.cy)
    }
  }

  // Markets
  ctx.lineWidth = 0.7 / scale
  for (const m of layout.markets) {
    ctx.fillStyle = B_MARKET
    ctx.fillRect(m.cx - m.w / 2, m.cy - m.h / 2, m.w, m.h)
    if (scale > 0.8) {
      ctx.strokeStyle = B_MARKET_OUTLINE
      ctx.strokeRect(m.cx - m.w / 2, m.cy - m.h / 2, m.w, m.h)
    }
  }

  // Hospitals
  for (const h of layout.hospitals) {
    ctx.fillStyle =
      hospitalOverwhelmed && pulseFast ? B_HOSPITAL_FLASH : B_HOSPITAL
    ctx.fillRect(h.cx - h.w / 2, h.cy - h.h / 2, h.w, h.h)
    ctx.strokeStyle = B_HOSPITAL_CROSS
    ctx.lineWidth = 1.2 / scale
    ctx.strokeRect(h.cx - h.w / 2, h.cy - h.h / 2, h.w, h.h)
    // Red cross
    ctx.lineWidth = Math.max(2, 4) / scale
    const cw = h.w * 0.30
    const ch = h.h * 0.40
    ctx.beginPath()
    ctx.moveTo(h.cx, h.cy - ch)
    ctx.lineTo(h.cx, h.cy + ch)
    ctx.moveTo(h.cx - cw, h.cy)
    ctx.lineTo(h.cx + cw, h.cy)
    ctx.stroke()
  }

  // Unemployment offices
  ctx.lineWidth = 0.7 / scale
  for (const u of layout.unemps) {
    ctx.fillStyle = B_UNEMP
    ctx.fillRect(u.cx - u.w / 2, u.cy - u.h / 2, u.w, u.h)
    ctx.strokeStyle = B_UNEMP_OUTLINE
    ctx.strokeRect(u.cx - u.w / 2, u.cy - u.h / 2, u.w, u.h)
  }

  // Hover glow on the hovered building
  if (data.hoveredBuildingKey) {
    const [kind, idStr] = data.hoveredBuildingKey.split('-')
    const id = Number(idStr)
    const arr =
      kind === 'company'
        ? layout.companies
        : kind === 'house'
          ? layout.houses
          : kind === 'market'
            ? layout.markets
            : kind === 'hospital'
              ? layout.hospitals
              : kind === 'unemp'
                ? layout.unemps
                : null
    const b = arr?.[id]
    if (b) {
      ctx.strokeStyle = '#5ec9f5'
      ctx.lineWidth = 2.2 / scale
      ctx.shadowColor = '#5ec9f5'
      ctx.shadowBlur = 14 / scale
      ctx.strokeRect(b.cx - b.w / 2 - 1, b.cy - b.h / 2 - 1, b.w + 2, b.h + 2)
      ctx.shadowBlur = 0
    }
  }
}

function drawAgents(
  ctx: CanvasRenderingContext2D,
  a: import('@/sim/agents').AgentPool,
  data: MapData,
  scale: number,
  baseT: number,
): void {
  const n = a.n
  const lowZoom = scale < LOW_ZOOM_THRESHOLD
  const radiusOverride = lowZoom ? 1 : null
  const povertyMul = CONFIG.POVERTY_TRAP_MULTIPLIER

  // Zoom-based sampling: at default zoom we only draw ~AGENT_SAMPLE_MIN agents,
  // scaling up to the full population as the user zooms in.
  const sampleLimit = computeAgentSampleLimit(scale, n)

  const buckets: Record<number, number[]> = {
    [HealthState.Susceptible]: [],
    [HealthState.Exposed]: [],
    [HealthState.InfectiousAsymptomatic]: [],
    [HealthState.InfectiousSymptomatic]: [],
    [HealthState.Recovered]: [],
  }
  const povertyIdx: number[] = []
  for (let k = 0; k < sampleLimit; k++) {
    const i = data.renderOrder[k]
    if (a.isAlive[i] === 0) continue
    const state = a.healthState[i]
    const list = buckets[state]
    if (list) list.push(i)
    if (
      a.employed[i] &&
      a.wallet[i] < a.baseConsumption[i] * povertyMul
    ) {
      povertyIdx.push(i)
    }
  }

  for (const stateStr of Object.keys(buckets)) {
    const stateNum = Number(stateStr)
    const list = buckets[stateNum]
    if (list.length === 0) continue
    ctx.fillStyle = COLOR_FOR_STATE[stateNum]
    ctx.beginPath()
    for (const i of list) {
      const lt = Math.min(
        1,
        Math.max(
          0,
          (baseT - data.staggerOffset[i]) /
            Math.max(0.05, 1 - data.staggerOffset[i]),
        ),
      )
      const eased = smoothstep(lt)
      const dx = data.targetX[i] - data.startX[i]
      const dy = data.targetY[i] - data.startY[i]
      const x = data.startX[i] + dx * eased
      const y = data.startY[i] + dy * eased
      let r = radiusOverride ?? RADIUS_NORMAL
      if (radiusOverride === null) {
        const isPoor =
          a.employed[i] && a.wallet[i] < a.baseConsumption[i] * povertyMul
        const isUnemp = a.employed[i] === 0
        if (isPoor || isUnemp) r = RADIUS_SMALL
      }
      ctx.moveTo(x + r, y)
      ctx.arc(x, y, r, 0, 2 * Math.PI)
    }
    ctx.fill()
  }

  if (!lowZoom && povertyIdx.length) {
    ctx.strokeStyle = POVERTY_RING
    ctx.lineWidth = 1 / scale
    ctx.beginPath()
    for (const i of povertyIdx) {
      const lt = Math.min(
        1,
        Math.max(
          0,
          (baseT - data.staggerOffset[i]) /
            Math.max(0.05, 1 - data.staggerOffset[i]),
        ),
      )
      const eased = smoothstep(lt)
      const x = data.startX[i] + (data.targetX[i] - data.startX[i]) * eased
      const y = data.startY[i] + (data.targetY[i] - data.startY[i]) * eased
      ctx.moveTo(x + RADIUS_SMALL + 1, y)
      ctx.arc(x, y, RADIUS_SMALL + 1, 0, 2 * Math.PI)
    }
    ctx.stroke()
  }
}

function drawCityLabels(ctx: CanvasRenderingContext2D, scale: number) {
  for (const c of CITY_PROJ) {
    let alpha = 0
    if (c.tier === 1) alpha = scale > 0.32 ? 1 : 0.3
    else if (c.tier === 2) alpha = scale > 0.55 ? 1 : 0
    else alpha = scale > 0.85 ? 1 : 0
    if (alpha <= 0) continue
    const fontSize =
      c.tier === 1 ? 16 / scale : c.tier === 2 ? 12 / scale : 10 / scale
    ctx.globalAlpha = alpha
    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // Halo
    ctx.fillStyle = 'rgba(0,0,0,0.65)'
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue
        ctx.fillText(c.name, c.x + dx, c.y + dy)
      }
    }
    ctx.fillStyle = c.tier === 1 ? '#ffffff' : '#dfe6f0'
    ctx.fillText(c.name, c.x, c.y)
    // Capital marker
    if (c.name === 'Chișinău') {
      ctx.fillStyle = '#f4d03f'
      ctx.beginPath()
      ctx.arc(c.x, c.y - fontSize * 0.7, 2.5 / scale, 0, 2 * Math.PI)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
}

function drawWeather(
  ctx: CanvasRenderingContext2D,
  data: MapData,
  _scale: number,
  now: number,
) {
  // Rain on/off cycle
  const phase = ((now - data.weatherCycleStart) % WEATHER_CYCLE_MS) / WEATHER_CYCLE_MS
  data.weatherIsRaining = phase > 0.65 && phase < 0.85

  // Drift clouds
  for (const c of data.weatherClouds) {
    c.x += c.vx * (1 / 30)
    if (c.x - c.r > MAP_LOGICAL_W) c.x = -c.r
    ctx.fillStyle = `rgba(220,225,235,${c.alpha})`
    ctx.beginPath()
    ctx.arc(c.x, c.y, c.r, 0, 2 * Math.PI)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(c.x + c.r * 0.6, c.y - c.r * 0.2, c.r * 0.7, 0, 2 * Math.PI)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(c.x - c.r * 0.5, c.y + c.r * 0.1, c.r * 0.6, 0, 2 * Math.PI)
    ctx.fill()
  }

  // Rain (sparse vertical streaks)
  if (data.weatherIsRaining) {
    ctx.strokeStyle = 'rgba(160,190,230,0.4)'
    ctx.lineWidth = 1
    ctx.beginPath()
    const stepX = 70
    const seedShift = Math.floor(now / 60)
    for (let x = 0; x < MAP_LOGICAL_W; x += stepX) {
      for (let row = 0; row < 12; row++) {
        const yBase = ((row * 240 + seedShift * 11) % MAP_LOGICAL_H)
        ctx.moveTo(x + (row * 7) % stepX, yBase)
        ctx.lineTo(x + (row * 7) % stepX - 4, yBase + 12)
      }
    }
    ctx.stroke()
  }
}

function drawMinimap(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  layout: Layout,
  t: { offsetX: number; offsetY: number; scale: number },
  data: MapData,
): void {
  const x0 = W - MINIMAP_W - MINIMAP_PAD
  const y0 = H - MINIMAP_H - MINIMAP_PAD
  data.minimapGeom = { x: x0, y: y0, w: MINIMAP_W, h: MINIMAP_H }
  ctx.fillStyle = '#0a0e14'
  ctx.fillRect(x0, y0, MINIMAP_W, MINIMAP_H)
  ctx.strokeStyle = '#22293a'
  ctx.lineWidth = 1
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, MINIMAP_W - 1, MINIMAP_H - 1)

  const scx = MINIMAP_W / MAP_LOGICAL_W
  const scy = MINIMAP_H / MAP_LOGICAL_H

  // Country shape on minimap
  ctx.fillStyle = '#1c2538'
  ctx.beginPath()
  ctx.moveTo(x0 + OUTLINE[0].x * scx, y0 + OUTLINE[0].y * scy)
  for (let i = 1; i < OUTLINE.length; i++) {
    ctx.lineTo(x0 + OUTLINE[i].x * scx, y0 + OUTLINE[i].y * scy)
  }
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#3b5279'
  ctx.lineWidth = 0.8
  ctx.stroke()

  // Hospitals
  ctx.fillStyle = '#cc0000'
  for (const h of layout.hospitals) {
    ctx.fillRect(x0 + h.cx * scx - 2, y0 + h.cy * scy - 2, 4, 3)
  }
  // Unemp offices
  ctx.fillStyle = '#b8941f'
  for (const u of layout.unemps) {
    ctx.fillRect(x0 + u.cx * scx - 2, y0 + u.cy * scy - 1, 3, 2)
  }
  // Markets
  ctx.fillStyle = '#5dade2'
  for (const m of layout.markets) {
    ctx.fillRect(x0 + m.cx * scx - 1, y0 + m.cy * scy - 1, 2, 2)
  }

  // Viewport rect
  const vw = W / Math.max(0.001, t.scale)
  const vh = H / Math.max(0.001, t.scale)
  let rx0 = x0 + t.offsetX * scx
  let ry0 = y0 + t.offsetY * scy
  let rx1 = x0 + (t.offsetX + vw) * scx
  let ry1 = y0 + (t.offsetY + vh) * scy
  rx0 = Math.max(x0, Math.min(x0 + MINIMAP_W, rx0))
  ry0 = Math.max(y0, Math.min(y0 + MINIMAP_H, ry0))
  rx1 = Math.max(x0, Math.min(x0 + MINIMAP_W, rx1))
  ry1 = Math.max(y0, Math.min(y0 + MINIMAP_H, ry1))
  ctx.strokeStyle = '#5ec9f5'
  ctx.lineWidth = 1.5
  ctx.strokeRect(rx0, ry0, rx1 - rx0, ry1 - ry0)

  // Title
  ctx.fillStyle = '#9ca3af'
  ctx.font = 'bold 9px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('MOLDOVA', x0 + 6, y0 + 5)
}

function tooltipText(
  s: SimulationEngine,
  b: Building,
  layout: Layout,
  data: MapData,
): string {
  const a = s.agents
  const cityName = CITY_PROJ[b.cityIdx]?.name ?? '—'
  if (b.kind === 'company') {
    const c = s.companies[b.id]
    let workers = 0
    for (let i = 0; i < a.n; i++) {
      if (a.companyId[i] === b.id && a.employed[i] && a.isAlive[i]) workers++
    }
    const status = c.bankrupt ? 'BANKRUPT' : c.isStruggling ? 'Struggling' : 'OK'
    return (
      `Company ${b.id} (${b.sector}) — ${cityName}\n` +
      `Status: ${status}\n` +
      `Workers: ${workers}\n` +
      `Cash: $${Math.round(c.cashBalance).toLocaleString()}\n` +
      `Loan:  $${Math.round(c.outstandingLoan).toLocaleString()}`
    )
  }
  if (b.kind === 'house') {
    let alive = 0
    let dead = 0
    let symp = 0
    for (let i = 0; i < a.n; i++) {
      if (data.houseId[i] !== b.id) continue
      if (a.isAlive[i]) {
        alive++
        if (a.healthState[i] === HealthState.InfectiousSymptomatic) symp++
      } else dead++
    }
    return (
      `House ${b.id} — ${cityName}\n` +
      `Residents alive: ${alive}\n` +
      `Symptomatic: ${symp}\n` +
      `Dead: ${dead}`
    )
  }
  if (b.kind === 'market') {
    const m = layout.markets[b.id]
    return `Market ${b.id} — ${cityName}\nVisits this tick: ${m.visits ?? 0}`
  }
  if (b.kind === 'hospital') {
    return (
      `Hospital ${b.id + 1} of ${layout.hospitals.length} — ${cityName}\n` +
      `Network patients: ${s.healthcare.currentPatients} / ${s.healthcare.bedCapacity}\n` +
      `Overwhelmed: ${s.healthcare.overwhelmed ? 'YES' : 'no'}`
    )
  }
  if (b.kind === 'unemp') {
    let unemp = 0
    for (let i = 0; i < a.n; i++) {
      if (a.isAlive[i] && !a.employed[i]) unemp++
    }
    return `Unemployment Office — ${cityName}\nTotal unemployed: ${unemp.toLocaleString()}`
  }
  return ''
}

// ---- colour helpers ----------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return [r, g, b]
}

function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `rgb(${r},${g},${bl})`
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${a.toFixed(3)})`
}

function drawEffects(
  ctx: CanvasRenderingContext2D,
  data: MapData,
  scale: number,
  nowMs: number,
): void {
  if (data.effects.length === 0) return
  const kept: Effect[] = []
  for (const eff of data.effects) {
    const t = (nowMs - eff.startMs) / eff.durationMs
    if (t >= 1) continue
    kept.push(eff)
    const alpha = 1 - t
    if (eff.kind === 'death') {
      const r = 3 + t * 16
      ctx.strokeStyle = rgba('#e74c3c', alpha * 0.85)
      ctx.lineWidth = 1.4 / scale
      ctx.beginPath()
      ctx.arc(eff.x, eff.y, r, 0, 2 * Math.PI)
      ctx.stroke()
      // Inner solid pulse early in the animation
      if (t < 0.3) {
        ctx.fillStyle = rgba('#e74c3c', (0.3 - t) * 1.6)
        ctx.beginPath()
        ctx.arc(eff.x, eff.y, 2.5, 0, 2 * Math.PI)
        ctx.fill()
      }
    } else if (eff.kind === 'recovery') {
      const r = 2 + t * 11
      ctx.strokeStyle = rgba('#2ecc71', alpha * 0.75)
      ctx.lineWidth = 1.1 / scale
      ctx.beginPath()
      ctx.arc(eff.x, eff.y, r, 0, 2 * Math.PI)
      ctx.stroke()
    } else if (eff.kind === 'bankruptcy' && eff.particles) {
      const dt = (nowMs - eff.startMs) / 1000
      ctx.fillStyle = rgba('#aa1010', alpha)
      for (const p of eff.particles) {
        const px = p.x + p.vx * dt
        const py = p.y + p.vy * dt + 80 * dt * dt // gravity
        ctx.beginPath()
        ctx.arc(px, py, 1.6 + 1 / scale, 0, 2 * Math.PI)
        ctx.fill()
      }
    }
  }
  data.effects = kept
}
