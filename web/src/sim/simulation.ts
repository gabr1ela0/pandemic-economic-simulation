// SimulationEngine — TypeScript port of code/simulation.py.
// Same 5-phase tick loop, same constants, same emergent behaviour.

import { AgentPool, HealthState } from './agents'
import { CONFIG } from './config'
import {
  Banks,
  Company,
  type CompanySector,
  Government,
  HealthcareDepartment,
} from './entities'
import { PRNG } from './prng'

export interface TickRecord {
  tick: number
  alive: number
  dead: number
  susceptible: number
  exposed: number
  infectiousAsymptomatic: number
  infectiousSymptomatic: number
  recovered: number
  vaccinated: number
  gdp: number
  unemploymentRatePct: number
  nationalDebt: number
  bankReserves: number
  bankInCrisis: boolean
  healthcarePatients: number
  healthcareCapacity: number
  healthcareOverwhelmed: boolean
  companiesStruggling: number
  companiesBankrupt: number
  lockdownLevel: number
  maskMandate: boolean
  stimulusAmount: number
  vaccinationRate: number
  meanWallet: number
  medianWallet: number
  consumerDemandIndex: number
  rehiresToday: number
}

export class SimulationEngine {
  rng: PRNG
  tickNum: number = 0
  government: Government
  banks: Banks
  healthcare: HealthcareDepartment
  agents: AgentPool
  companies: Company[]
  /** Pre-bool array, true if company i is Essential. */
  companyIsEssential: Uint8Array

  // Tick caches (refreshed at start of each tick)
  atWork: Uint8Array
  atMarket: Uint8Array

  records: TickRecord[] = []
  dailyGdp: number = 0
  rehiresToday: number = 0

  constructor(government?: Government, seed?: number) {
    const realSeed = seed ?? CONFIG.RANDOM_SEED
    this.rng = new PRNG(realSeed)
    this.government = government ?? new Government()
    this.banks = new Banks()
    this.healthcare = new HealthcareDepartment()
    this.agents = new AgentPool(CONFIG.NUM_AGENTS, this.rng)
    this.companies = this.initCompanies()
    this.companyIsEssential = new Uint8Array(this.companies.length)
    for (let i = 0; i < this.companies.length; i++) {
      this.companyIsEssential[i] = this.companies[i].sector === 'Essential' ? 1 : 0
    }
    this.assignAgentsToCompanies()
    this.atWork = new Uint8Array(this.agents.n)
    this.atMarket = new Uint8Array(this.agents.n)
    this.seedInfection()
  }

  private initCompanies(): Company[] {
    const nCo = CONFIG.NUM_COMPANIES
    const nEssential = Math.floor(nCo * CONFIG.ESSENTIAL_COMPANY_RATIO)
    const out: Company[] = []
    for (let i = 0; i < nCo; i++) {
      const sector: CompanySector = i < nEssential ? 'Essential' : 'Non-Essential'
      const cashSamples = this.rng.normal(
        CONFIG.INITIAL_COMPANY_CASH_MEAN,
        CONFIG.INITIAL_COMPANY_CASH_STD,
        1,
      )
      const cash = Math.max(CONFIG.INITIAL_COMPANY_CASH_MIN, cashSamples[0])
      out.push(new Company(i, sector, cash))
    }
    return out
  }

  private assignAgentsToCompanies(): void {
    const n = this.agents.n
    const nCo = this.companies.length
    const ids = this.rng.integers(0, nCo, n)
    for (let i = 0; i < n; i++) {
      this.agents.companyId[i] = ids[i]
      this.agents.employed[i] = 1
    }
  }

  private seedInfection(): void {
    const k = CONFIG.INITIAL_INFECTED_COUNT
    const idx = this.rng.choice(this.agents.n, k)
    for (let j = 0; j < idx.length; j++) {
      this.agents.healthState[idx[j]] = HealthState.InfectiousAsymptomatic
    }
  }

  // ---- master tick ----

  tick(): void {
    this.tickNum++
    const lockdown = this.government.lockdownLevel
    this.atWork = this.agents.atWorkMask(lockdown)
    this.atMarket = this.agents.atMarketMask(lockdown)
    this.epidemiologicalPhase()
    this.labourPhase()
    this.consumptionPhase()
    this.financialPhase()
    this.reportingPhase()
  }

  // ---- Phase 1 — Epidemiological ----

  private epidemiologicalPhase(): void {
    const a = this.agents
    const n = a.n
    const pBase =
      CONFIG.BASE_TRANSMISSION_RATE * this.government.transmissionMultiplier()

    const newExposed = new Uint8Array(n)

    // Workplace transmission ------------------------------------------
    const infPerCo = new Int32Array(this.companies.length)
    for (let i = 0; i < n; i++) {
      if (
        !this.atWork[i] ||
        !a.isAlive[i] ||
        !a.employed[i] ||
        !this.isInfectious(a.healthState[i])
      ) {
        continue
      }
      const co = a.companyId[i]
      if (co >= 0) infPerCo[co]++
    }
    for (let i = 0; i < n; i++) {
      if (
        !this.atWork[i] ||
        !this.isSusceptible(a, i) ||
        !a.employed[i]
      ) {
        continue
      }
      const co = a.companyId[i]
      if (co < 0) continue
      const exposure = infPerCo[co]
      if (exposure === 0) continue
      const pInf = 1 - Math.pow(1 - pBase, exposure)
      if (this.rng.next() < pInf) newExposed[i] = 1
    }

    // Market transmission (mean field) -------------------------------
    const pMkt = pBase * CONFIG.MARKET_TRANSMISSION_SCALE
    let infMktCnt = 0
    for (let i = 0; i < n; i++) {
      if (
        this.atMarket[i] &&
        a.isAlive[i] &&
        this.isInfectious(a.healthState[i])
      ) {
        infMktCnt++
      }
    }
    if (infMktCnt > 0) {
      const expected = CONFIG.MARKET_CONTACT_FRACTION * infMktCnt
      const pMktInf = 1 - Math.pow(1 - pMkt, Math.max(1, expected))
      for (let i = 0; i < n; i++) {
        if (
          this.atMarket[i] &&
          this.isSusceptible(a, i) &&
          this.rng.next() < pMktInf
        ) {
          newExposed[i] = 1
        }
      }
    }

    // Apply exposures (don't overwrite vaccinated / non-susceptible) --
    for (let i = 0; i < n; i++) {
      if (newExposed[i] && this.isSusceptible(a, i)) {
        a.healthState[i] = HealthState.Exposed
        a.daysInState[i] = 0
      }
    }

    this.advanceStates()
    if (this.government.vaccinationRate > 0) this.applyVaccinations()
  }

  private isSusceptible(a: AgentPool, i: number): boolean {
    return (
      a.healthState[i] === HealthState.Susceptible &&
      a.isAlive[i] === 1 &&
      a.vaccinated[i] === 0
    )
  }

  private isInfectious(state: number): boolean {
    return (
      state === HealthState.InfectiousAsymptomatic ||
      state === HealthState.InfectiousSymptomatic
    )
  }

  private advanceStates(): void {
    const a = this.agents
    const n = a.n
    const mortality = this.healthcare.effectiveMortalityRate

    // Increment days_in_state for all active disease states
    for (let i = 0; i < n; i++) {
      const s = a.healthState[i]
      if (
        s !== HealthState.Susceptible &&
        s !== HealthState.Recovered &&
        s !== HealthState.Dead
      ) {
        a.daysInState[i]++
      }
    }

    // Exposed -> Infectious_A or Infectious_S
    for (let i = 0; i < n; i++) {
      if (
        a.healthState[i] === HealthState.Exposed &&
        a.daysInState[i] >= CONFIG.INCUBATION_DAYS
      ) {
        if (this.rng.next() < CONFIG.ASYMPTOMATIC_RATIO) {
          a.healthState[i] = HealthState.InfectiousAsymptomatic
        } else {
          a.healthState[i] = HealthState.InfectiousSymptomatic
        }
        a.daysInState[i] = 0
      }
    }

    // Infectious_A -> Recovered
    for (let i = 0; i < n; i++) {
      if (
        a.healthState[i] === HealthState.InfectiousAsymptomatic &&
        a.daysInState[i] >= CONFIG.ASYMPTOMATIC_INFECTIOUS_DAYS
      ) {
        a.healthState[i] = HealthState.Recovered
        a.daysInState[i] = 0
      }
    }

    // Infectious_S -> Dead (daily mortality) or Recovered
    let symCount = 0
    for (let i = 0; i < n; i++) {
      if (
        a.healthState[i] === HealthState.InfectiousSymptomatic &&
        a.isAlive[i]
      ) {
        symCount++
        if (this.rng.next() < mortality) {
          a.healthState[i] = HealthState.Dead
          a.isAlive[i] = 0
          a.employed[i] = 0
          symCount-- // they died this tick — don't count them as a patient
        } else if (a.daysInState[i] >= CONFIG.SYMPTOMATIC_RECOVERY_DAYS) {
          a.healthState[i] = HealthState.Recovered
          a.daysInState[i] = 0
        }
      }
    }
    // Re-count symptomatic for the bed-occupancy update (post-deaths/recoveries)
    let symFinal = 0
    for (let i = 0; i < n; i++) {
      if (a.healthState[i] === HealthState.InfectiousSymptomatic) symFinal++
    }
    this.healthcare.update(symFinal)
  }

  private applyVaccinations(): void {
    const a = this.agents
    const rate = this.government.vaccinationRate
    const nPerTick = Math.max(
      1,
      Math.floor(a.n * rate * CONFIG.VACCINATIONS_PER_DAY_PER_RATE),
    )
    // Build pool of susceptible indices
    const pool: number[] = []
    for (let i = 0; i < a.n; i++) {
      if (
        a.healthState[i] === HealthState.Susceptible &&
        a.isAlive[i] &&
        !a.vaccinated[i]
      ) {
        pool.push(i)
      }
    }
    if (pool.length === 0) return
    const k = Math.min(nPerTick, pool.length)
    // Reservoir-style: sample k without replacement
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(this.rng.next() * (pool.length - i))
      const tmp = pool[i]
      pool[i] = pool[j]
      pool[j] = tmp
      a.vaccinated[pool[i]] = 1
    }
  }

  // ---- Phase 2 — Labour ----

  private labourPhase(): void {
    const a = this.agents
    const lockdown = this.government.lockdownLevel
    const cdi = this.consumerDemandIndex()

    const nCo = this.companies.length
    const atWorkPerCo = new Int32Array(nCo)
    const empPerCo = new Int32Array(nCo)
    for (let i = 0; i < a.n; i++) {
      if (!a.isAlive[i]) continue
      const co = a.companyId[i]
      if (co < 0) continue
      if (a.employed[i]) empPerCo[co]++
      if (a.employed[i] && this.atWork[i]) atWorkPerCo[co]++
    }

    // Wages
    for (let i = 0; i < a.n; i++) {
      if (this.atWork[i]) a.wallet[i] += CONFIG.DAILY_WAGE
    }

    // Vectorised revenue
    const demandEss = CONFIG.ESSENTIAL_DEMAND_BASE * cdi
    const penalty = lockdown * CONFIG.LOCKDOWN_NON_ESSENTIAL_PENALTY
    const demandNon =
      CONFIG.NON_ESSENTIAL_DEMAND_BASE * cdi * Math.max(0, 1 - penalty)

    let gdp = 0
    for (let i = 0; i < nCo; i++) {
      const demand = this.companyIsEssential[i] ? demandEss : demandNon
      const revenue = atWorkPerCo[i] * CONFIG.PRODUCTIVITY_CONSTANT * demand
      gdp += revenue
      const c = this.companies[i]
      if (c.bankrupt) continue
      const wageBill = atWorkPerCo[i] * CONFIG.DAILY_WAGE
      c.cashBalance += revenue - wageBill
      c.totalRevenueEarned += revenue

      const totalEmp = empPerCo[i]
      const ratio = totalEmp > 0 ? atWorkPerCo[i] / totalEmp : 0
      c.isStruggling = ratio < CONFIG.WORKFORCE_STRUGGLING_THRESHOLD
      const maxLoan = CONFIG.BANK_LOAN_AMOUNT * CONFIG.BANK_MAX_LOAN_MULTIPLE

      if (c.isStruggling) {
        c.ticksStruggling++
        // Bankruptcy
        if (
          c.cashBalance < CONFIG.BANKRUPTCY_CASH_THRESHOLD &&
          c.outstandingLoan >= maxLoan * 0.9
        ) {
          c.bankrupt = true
          for (let j = 0; j < a.n; j++) {
            if (a.isAlive[j] && a.employed[j] && a.companyId[j] === i) {
              a.employed[j] = 0
              a.companyId[j] = -1
            }
          }
          continue
        }
        // Fire some workforce while cash-negative
        if (c.cashBalance < 0 && totalEmp > 1) {
          // Collect employed indices
          const emp: number[] = []
          for (let j = 0; j < a.n; j++) {
            if (a.isAlive[j] && a.employed[j] && a.companyId[j] === i) {
              emp.push(j)
            }
          }
          const nFire = Math.max(
            1,
            Math.floor(emp.length * CONFIG.FIRING_PROBABILITY),
          )
          // Sample nFire indices without replacement (partial Fisher-Yates)
          const k = Math.min(nFire, emp.length)
          for (let j = 0; j < k; j++) {
            const swap = j + Math.floor(this.rng.next() * (emp.length - j))
            const tmp = emp[j]
            emp[j] = emp[swap]
            emp[swap] = tmp
            a.employed[emp[j]] = 0
            a.companyId[emp[j]] = -1
          }
        }
      } else {
        c.ticksStruggling = 0
      }
    }
    this.dailyGdp = gdp

    // Re-employment: healthy companies hire from the pool of unemployed
    this.rehiresToday = 0
    const unempIdx: number[] = []
    for (let i = 0; i < a.n; i++) {
      if (a.isAlive[i] && !a.employed[i] && a.companyId[i] === -1) unempIdx.push(i)
    }
    if (unempIdx.length > 0) {
      const eligibleCos: number[] = []
      const minCash = CONFIG.REHIRE_HEALTHY_COMPANY_CASH_MIN
      const minRatio = CONFIG.REHIRE_HEALTHY_WORKFORCE_RATIO
      for (let i = 0; i < nCo; i++) {
        const c = this.companies[i]
        const ratio = empPerCo[i] > 0 ? atWorkPerCo[i] / empPerCo[i] : 0
        if (
          !c.bankrupt &&
          !c.isStruggling &&
          c.cashBalance > minCash &&
          ratio > minRatio
        ) {
          eligibleCos.push(i)
        }
      }
      if (eligibleCos.length > 0) {
        let n = 0
        for (let k = 0; k < unempIdx.length; k++) {
          if (this.rng.next() < CONFIG.BASE_REHIRE_PROBABILITY) {
            const co = eligibleCos[Math.floor(this.rng.next() * eligibleCos.length)]
            const ag = unempIdx[k]
            a.employed[ag] = 1
            a.companyId[ag] = co
            n++
          }
        }
        this.rehiresToday = n
      }
    }
  }

  // ---- Phase 3 — Consumption ----

  private consumptionPhase(): void {
    const a = this.agents
    const gov = this.government

    for (let i = 0; i < a.n; i++) {
      if (!a.isAlive[i]) continue
      a.wallet[i] -= a.baseConsumption[i]
      if (a.wallet[i] < 0) a.wallet[i] = 0
    }

    if (gov.stimulusAmount > 0) {
      let needyCount = 0
      for (let i = 0; i < a.n; i++) {
        if (a.isAlive[i] && a.wallet[i] < CONFIG.STIMULUS_WALLET_THRESHOLD) {
          a.wallet[i] += gov.stimulusAmount
          needyCount++
        }
      }
      gov.nationalDebt += needyCount * gov.stimulusAmount
    }
  }

  // ---- Phase 4 — Financial ----

  private financialPhase(): void {
    this.banks.tick(this.companies)
    const maxLoan = CONFIG.BANK_LOAN_AMOUNT * CONFIG.BANK_MAX_LOAN_MULTIPLE
    for (const c of this.companies) {
      if (c.bankrupt) continue
      if (c.isStruggling && c.cashBalance < 0 && c.outstandingLoan < maxLoan) {
        const loan = this.banks.requestLoan(CONFIG.BANK_LOAN_AMOUNT)
        c.cashBalance += loan
        c.outstandingLoan += loan
      }
    }
  }

  // ---- Phase 5 — Reporting ----

  private reportingPhase(): void {
    const a = this.agents
    const counts = a.stateCounts()
    const cdi = this.consumerDemandIndex()
    let nBankrupt = 0
    let nStruggling = 0
    for (const c of this.companies) {
      if (c.bankrupt) nBankrupt++
      else if (c.isStruggling) nStruggling++
    }
    let vaccinated = 0
    for (let i = 0; i < a.n; i++) vaccinated += a.vaccinated[i]

    this.records.push({
      tick: this.tickNum,
      alive: a.totalAlive(),
      dead: counts.dead,
      susceptible: counts.susceptible,
      exposed: counts.exposed,
      infectiousAsymptomatic: counts.infectiousAsymptomatic,
      infectiousSymptomatic: counts.infectiousSymptomatic,
      recovered: counts.recovered,
      vaccinated,
      gdp: this.dailyGdp,
      unemploymentRatePct: a.unemploymentRate() * 100,
      nationalDebt: this.government.nationalDebt,
      bankReserves: this.banks.totalReserves,
      bankInCrisis: this.banks.inCrisis,
      healthcarePatients: this.healthcare.currentPatients,
      healthcareCapacity: this.healthcare.bedCapacity,
      healthcareOverwhelmed: this.healthcare.overwhelmed,
      companiesStruggling: nStruggling,
      companiesBankrupt: nBankrupt,
      lockdownLevel: this.government.lockdownLevel,
      maskMandate: this.government.maskMandate,
      stimulusAmount: this.government.stimulusAmount,
      vaccinationRate: this.government.vaccinationRate,
      meanWallet: a.meanWallet(),
      medianWallet: a.medianWallet(),
      consumerDemandIndex: cdi,
      rehiresToday: this.rehiresToday,
    })
  }

  // ---- helpers ----

  consumerDemandIndex(): number {
    const deathSuppression = Math.max(
      0.10,
      1 - this.agents.totalDead() * CONFIG.DEATH_DEMAND_SUPPRESSION_FACTOR,
    )
    const lockdownFactor = Math.max(
      0.30,
      1 - this.government.lockdownLevel * 0.10,
    )
    return deathSuppression * lockdownFactor
  }
}
