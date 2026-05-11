// Hand-curated geographic data for the Moldova map view.
// All coordinates are real WGS-84 lat/lon; we use a simple equirectangular
// projection because the country is small enough that the distortion is invisible.

export const MAP_LOGICAL_W = 5000
export const MAP_LOGICAL_H = 4300

const LAT_MIN = 45.30
const LAT_MAX = 48.55
const LON_MIN = 26.55
const LON_MAX = 30.25

const PAD_X = 110
const PAD_Y = 110

export function project(lat: number, lon: number): { x: number; y: number } {
  const u = (lon - LON_MIN) / (LON_MAX - LON_MIN)
  const v = (LAT_MAX - lat) / (LAT_MAX - LAT_MIN)
  return {
    x: PAD_X + u * (MAP_LOGICAL_W - 2 * PAD_X),
    y: PAD_Y + v * (MAP_LOGICAL_H - 2 * PAD_Y),
  }
}

// Hand-traced Moldova outline (clockwise from NW). Approximate — meant to read
// as Moldova at a glance, not a survey.
const OUTLINE_LATLON: [number, number][] = [
  [48.46, 26.62],
  [48.50, 26.95],
  [48.48, 27.30],
  [48.40, 27.55],
  [48.45, 27.85],
  [48.36, 28.10],
  [48.30, 28.30],
  [48.18, 28.55],
  [48.05, 28.78],
  [47.92, 28.95],
  [47.78, 29.10],
  [47.62, 29.20],
  [47.45, 29.35],
  [47.30, 29.45],
  [47.10, 29.55],
  [46.95, 29.70],
  [46.80, 29.95],
  [46.75, 30.12],
  [46.55, 30.05],
  [46.40, 29.95],
  [46.20, 29.85],
  [46.05, 29.70],
  [45.85, 29.50],
  [45.65, 29.20],
  [45.50, 28.95],
  [45.40, 28.65],
  [45.45, 28.30],
  [45.55, 28.15],
  [45.75, 28.10],
  [45.90, 28.20],
  [46.05, 28.18],
  [46.18, 28.10],
  [46.30, 28.00],
  [46.45, 27.85],
  [46.55, 27.70],
  [46.70, 27.55],
  [46.85, 27.45],
  [47.00, 27.35],
  [47.15, 27.25],
  [47.30, 27.18],
  [47.45, 27.15],
  [47.60, 27.12],
  [47.75, 27.05],
  [47.88, 26.95],
  [48.00, 26.85],
  [48.12, 26.78],
  [48.25, 26.72],
  [48.38, 26.65],
]

// Prut river — runs along the western border, north to south.
const PRUT_LATLON: [number, number][] = [
  [48.45, 26.65],
  [48.20, 26.78],
  [47.95, 26.95],
  [47.70, 27.10],
  [47.40, 27.18],
  [47.10, 27.30],
  [46.85, 27.45],
  [46.60, 27.65],
  [46.35, 27.85],
  [46.10, 28.10],
  [45.85, 28.20],
  [45.60, 28.18],
  [45.45, 28.40],
]

// Dniester river — flows from north through Transnistria, then south to the sea.
const DNIESTER_LATLON: [number, number][] = [
  [48.30, 27.40],
  [48.18, 27.85],
  [48.05, 28.20],
  [47.88, 28.55],
  [47.72, 28.85],
  [47.55, 29.10],
  [47.30, 29.30],
  [47.05, 29.45],
  [46.85, 29.50],
  [46.65, 29.55],
  [46.40, 29.75],
  [46.15, 29.85],
  [45.90, 29.85],
]

export interface City {
  name: string
  lat: number
  lon: number
  pop: number   // thousands — used to weight building counts
  /** Logical-pixel cluster radius for procedural placement. */
  radius: number
  /** "country" font size (display tier). */
  tier: 1 | 2 | 3
}

// Real Moldovan cities + populations (thousands). Tier governs label visibility.
export const CITIES: City[] = [
  { name: 'Chișinău',  lat: 47.0105, lon: 28.8638, pop: 640, radius: 360, tier: 1 },
  { name: 'Bălți',     lat: 47.7544, lon: 27.9229, pop: 145, radius: 200, tier: 1 },
  { name: 'Tiraspol',  lat: 46.8403, lon: 29.6433, pop: 130, radius: 185, tier: 1 },
  { name: 'Bender',    lat: 46.8369, lon: 29.4839, pop: 100, radius: 150, tier: 2 },
  { name: 'Cahul',     lat: 45.9077, lon: 28.1949, pop:  30, radius:  95, tier: 2 },
  { name: 'Ungheni',   lat: 47.2093, lon: 27.7949, pop:  30, radius:  90, tier: 2 },
  { name: 'Comrat',    lat: 46.2967, lon: 28.6628, pop:  25, radius:  85, tier: 2 },
  { name: 'Soroca',    lat: 48.1544, lon: 28.2992, pop:  22, radius:  80, tier: 2 },
  { name: 'Orhei',     lat: 47.3857, lon: 28.8233, pop:  20, radius:  80, tier: 2 },
  { name: 'Strășeni',  lat: 47.1444, lon: 28.6082, pop:  20, radius:  72, tier: 3 },
  { name: 'Edineț',    lat: 48.1714, lon: 27.3119, pop:  17, radius:  72, tier: 3 },
  { name: 'Ialoveni',  lat: 46.9445, lon: 28.7794, pop:  17, radius:  72, tier: 3 },
  { name: 'Hîncești',  lat: 46.8268, lon: 28.5887, pop:  16, radius:  70, tier: 3 },
  { name: 'Florești',  lat: 47.8839, lon: 28.2954, pop:  14, radius:  64, tier: 3 },
  { name: 'Drochia',   lat: 48.0353, lon: 27.8131, pop:  13, radius:  64, tier: 3 },
  { name: 'Călărași',  lat: 47.2569, lon: 28.3038, pop:  12, radius:  64, tier: 3 },
]

// Roads: pairs of city names. Polylines are computed from the city positions
// at draw time. Slightly stylised — these aren't the real M-route alignments.
export const ROADS: [string, string][] = [
  ['Chișinău', 'Bălți'],
  ['Chișinău', 'Tiraspol'],
  ['Chișinău', 'Bender'],
  ['Chișinău', 'Cahul'],
  ['Chișinău', 'Ungheni'],
  ['Chișinău', 'Hîncești'],
  ['Chișinău', 'Comrat'],
  ['Chișinău', 'Orhei'],
  ['Chișinău', 'Ialoveni'],
  ['Chișinău', 'Strășeni'],
  ['Bălți', 'Soroca'],
  ['Bălți', 'Edineț'],
  ['Bălți', 'Ungheni'],
  ['Bălți', 'Drochia'],
  ['Bălți', 'Florești'],
  ['Bălți', 'Orhei'],
  ['Edineț', 'Soroca'],
  ['Drochia', 'Edineț'],
  ['Soroca', 'Florești'],
  ['Florești', 'Orhei'],
  ['Orhei', 'Strășeni'],
  ['Strășeni', 'Călărași'],
  ['Călărași', 'Ungheni'],
  ['Hîncești', 'Cahul'],
  ['Hîncești', 'Comrat'],
  ['Comrat', 'Cahul'],
  ['Bender', 'Tiraspol'],
  ['Bender', 'Comrat'],
]

// ---- projected geometry ------------------------------------------------------

function projectMany(coords: [number, number][]): { x: number; y: number }[] {
  return coords.map(([lat, lon]) => project(lat, lon))
}

export const OUTLINE = projectMany(OUTLINE_LATLON)
export const PRUT = projectMany(PRUT_LATLON)
export const DNIESTER = projectMany(DNIESTER_LATLON)

export const CITY_PROJ = CITIES.map((c) => {
  const p = project(c.lat, c.lon)
  return { ...c, x: p.x, y: p.y }
})
const CITY_BY_NAME = new Map(CITY_PROJ.map((c) => [c.name, c]))

export const ROAD_SEGMENTS: { ax: number; ay: number; bx: number; by: number }[] =
  ROADS.map(([a, b]) => {
    const ca = CITY_BY_NAME.get(a)!
    const cb = CITY_BY_NAME.get(b)!
    return { ax: ca.x, ay: ca.y, bx: cb.x, by: cb.y }
  })

// ---- point-in-polygon (ray casting on the projected outline) ------------------

export function pointInOutline(x: number, y: number): boolean {
  const poly = OUTLINE
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi
    if (intersect) inside = !inside
  }
  return inside
}

// ---- building placement -----------------------------------------------------

interface Placement { x: number; y: number; cityIdx: number }

/**
 * Distribute `count` items across the cities, weighted by population, with
 * gaussian-ish offsets inside each city's radius. Rejects placements that fall
 * outside the country outline.
 *
 * When `minSelfDist` > 0, candidate placements within that distance of an
 * already-placed same-kind item (in the same city) are rejected — this enforces
 * visible gaps between buildings.
 */
export function distributeAroundCities(
  count: number,
  rng: () => number,
  jitterScale = 1.0,
  minSelfDist = 0,
): Placement[] {
  const totalPop = CITY_PROJ.reduce((s, c) => s + c.pop, 0)
  const out: Placement[] = []

  const allocations: number[] = CITY_PROJ.map((c) =>
    Math.max(1, Math.round((c.pop / totalPop) * count)),
  )
  // Adjust to hit exactly `count`
  let placed = allocations.reduce((s, n) => s + n, 0)
  let i = 0
  while (placed > count) {
    if (allocations[i % CITY_PROJ.length] > 1) {
      allocations[i % CITY_PROJ.length]--
      placed--
    }
    i++
    if (i > 1000) break
  }
  while (placed < count) {
    allocations[0]++
    placed++
  }

  const minDistSq = minSelfDist * minSelfDist
  for (let cityIdx = 0; cityIdx < CITY_PROJ.length; cityIdx++) {
    const c = CITY_PROJ[cityIdx]
    const target = allocations[cityIdx]
    const cityStart = out.length
    let placedHere = 0
    let attempts = 0
    const maxAttempts = target * 60
    let relaxFactor = 1.0
    while (placedHere < target && attempts < maxAttempts) {
      attempts++
      // Allow the minimum distance to gradually relax if placement is hard,
      // so we don't fall back to on-center collapse for dense cities.
      if (minSelfDist > 0 && attempts > target * 20 && relaxFactor > 0.5) {
        relaxFactor *= 0.92
      }
      const effMinSq =
        minSelfDist > 0 ? minDistSq * relaxFactor * relaxFactor : 0
      // Box-Muller ish radial sample
      const r =
        Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-9))) *
        c.radius *
        0.45 *
        jitterScale
      const theta = rng() * Math.PI * 2
      const x = c.x + r * Math.cos(theta)
      const y = c.y + r * Math.sin(theta)
      if (!pointInOutline(x, y)) continue
      if (effMinSq > 0) {
        let tooClose = false
        for (let k = cityStart; k < out.length; k++) {
          const dx = out[k].x - x
          const dy = out[k].y - y
          if (dx * dx + dy * dy < effMinSq) {
            tooClose = true
            break
          }
        }
        if (tooClose) continue
      }
      out.push({ x, y, cityIdx })
      placedHere++
    }
    // Top up with on-city-center placements if we couldn't fit them inside the polygon
    while (placedHere < target) {
      out.push({ x: c.x, y: c.y, cityIdx })
      placedHere++
    }
  }
  return out
}
