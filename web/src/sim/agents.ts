// Vectorised agent pool — every per-agent attribute is a typed array so we
// can iterate the population in tight loops without GC pressure.

import { CONFIG } from './config'
import { PRNG } from './prng'

export const HealthState = {
  Susceptible: 0,
  Exposed: 1,
  InfectiousAsymptomatic: 2,
  InfectiousSymptomatic: 3,
  Recovered: 4,
  Dead: 5,
} as const
export type HealthStateValue = (typeof HealthState)[keyof typeof HealthState]

export class AgentPool {
  readonly n: number
  readonly rng: PRNG

  // Health
  healthState: Int8Array
  daysInState: Int16Array
  /** 1 = alive, 0 = dead. Stored as Uint8Array for speed. */
  isAlive: Uint8Array
  vaccinated: Uint8Array

  // Economics
  wallet: Float32Array
  baseConsumption: Float32Array
  /** [0, 1] — agents above this are more likely to break lockdown. */
  riskTolerance: Float32Array

  // Employment
  /** -1 = unemployed. */
  companyId: Int32Array
  employed: Uint8Array

  constructor(n: number, rng: PRNG) {
    this.n = n
    this.rng = rng

    this.healthState = new Int8Array(n) // 0 = Susceptible by default
    this.daysInState = new Int16Array(n)
    this.isAlive = new Uint8Array(n).fill(1)
    this.vaccinated = new Uint8Array(n)

    this.wallet = rng.normal(
      CONFIG.INITIAL_WALLET_MEAN,
      CONFIG.INITIAL_WALLET_STD,
      n,
    )
    for (let i = 0; i < n; i++) {
      if (this.wallet[i] < CONFIG.INITIAL_WALLET_MIN) {
        this.wallet[i] = CONFIG.INITIAL_WALLET_MIN
      }
    }

    this.baseConsumption = rng.normal(
      CONFIG.BASE_CONSUMPTION_MEAN,
      CONFIG.BASE_CONSUMPTION_STD,
      n,
    )
    for (let i = 0; i < n; i++) {
      if (this.baseConsumption[i] < CONFIG.BASE_CONSUMPTION_MIN) {
        this.baseConsumption[i] = CONFIG.BASE_CONSUMPTION_MIN
      }
    }

    this.riskTolerance = rng.uniform(0, 1, n)

    this.companyId = new Int32Array(n).fill(-1)
    this.employed = new Uint8Array(n)
  }

  /** Returns a fresh Uint8Array mask: agents who attend their workplace this tick. */
  atWorkMask(lockdownLevel: number): Uint8Array {
    const n = this.n
    const out = new Uint8Array(n)
    const symFactor = CONFIG.SYMPTOMATIC_WORK_ATTENDANCE_FACTOR
    const povertyMul = CONFIG.POVERTY_TRAP_MULTIPLIER
    for (let i = 0; i < n; i++) {
      if (!this.isAlive[i] || !this.employed[i]) continue
      const sym = this.healthState[i] === HealthState.InfectiousSymptomatic
      let canWork = false
      if (sym) {
        if (this.rng.next() < symFactor) canWork = true
      } else {
        canWork = true
      }
      if (!canWork) continue
      if (lockdownLevel === 0) {
        out[i] = 1
        continue
      }
      const poverty = this.wallet[i] < this.baseConsumption[i] * povertyMul
      const breakProb = this.riskTolerance[i] / lockdownLevel
      const breaks = this.rng.next() < breakProb
      if (poverty || breaks) out[i] = 1
    }
    return out
  }

  /** Returns a fresh Uint8Array mask: agents who go to public spaces this tick. */
  atMarketMask(lockdownLevel: number): Uint8Array {
    const n = this.n
    const out = new Uint8Array(n)
    const symFactor = CONFIG.SYMPTOMATIC_MARKET_ATTENDANCE_FACTOR
    const povertyMul = CONFIG.POVERTY_TRAP_MULTIPLIER
    for (let i = 0; i < n; i++) {
      if (!this.isAlive[i]) continue
      const sym = this.healthState[i] === HealthState.InfectiousSymptomatic
      let mobile = false
      if (sym) {
        if (this.rng.next() < symFactor) mobile = true
      } else {
        mobile = true
      }
      if (!mobile) continue
      if (lockdownLevel === 0) {
        out[i] = 1
        continue
      }
      const poverty = this.wallet[i] < this.baseConsumption[i] * povertyMul
      const compliance = lockdownLevel * 0.20
      if (poverty || this.rng.next() > compliance) out[i] = 1
    }
    return out
  }

  // ---- aggregate stats ----

  totalAlive(): number {
    let count = 0
    for (let i = 0; i < this.n; i++) count += this.isAlive[i]
    return count
  }

  totalDead(): number {
    return this.n - this.totalAlive()
  }

  unemploymentRate(): number {
    let alive = 0
    let unemp = 0
    for (let i = 0; i < this.n; i++) {
      if (this.isAlive[i]) {
        alive++
        if (!this.employed[i]) unemp++
      }
    }
    return alive === 0 ? 1 : unemp / alive
  }

  meanWallet(): number {
    let sum = 0
    let count = 0
    for (let i = 0; i < this.n; i++) {
      if (this.isAlive[i]) {
        sum += this.wallet[i]
        count++
      }
    }
    return count === 0 ? 0 : sum / count
  }

  medianWallet(): number {
    const tmp: number[] = []
    for (let i = 0; i < this.n; i++) {
      if (this.isAlive[i]) tmp.push(this.wallet[i])
    }
    if (tmp.length === 0) return 0
    tmp.sort((a, b) => a - b)
    const m = tmp.length >> 1
    return tmp.length % 2 === 0 ? (tmp[m - 1] + tmp[m]) / 2 : tmp[m]
  }

  stateCounts(): {
    susceptible: number
    exposed: number
    infectiousAsymptomatic: number
    infectiousSymptomatic: number
    recovered: number
    dead: number
  } {
    const counts = [0, 0, 0, 0, 0, 0]
    for (let i = 0; i < this.n; i++) counts[this.healthState[i]]++
    return {
      susceptible: counts[HealthState.Susceptible],
      exposed: counts[HealthState.Exposed],
      infectiousAsymptomatic: counts[HealthState.InfectiousAsymptomatic],
      infectiousSymptomatic: counts[HealthState.InfectiousSymptomatic],
      recovered: counts[HealthState.Recovered],
      dead: counts[HealthState.Dead],
    }
  }
}
