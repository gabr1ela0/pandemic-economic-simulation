// Macro entities: Government, Banks, HealthcareDepartment, Company.

import { CONFIG, type LockdownLevel } from './config'

export class Government {
  lockdownLevel: LockdownLevel = CONFIG.INITIAL_LOCKDOWN_LEVEL as LockdownLevel
  maskMandate: boolean = CONFIG.INITIAL_MASK_MANDATE
  stimulusAmount: number = CONFIG.INITIAL_STIMULUS_AMOUNT
  vaccinationRate: number = CONFIG.INITIAL_VACCINATION_RATE
  nationalDebt: number = 0

  setLockdown(level: number): void {
    if (level !== 0 && level !== 1 && level !== 2 && level !== 3) {
      throw new Error('Lockdown level must be 0, 1, 2, or 3.')
    }
    this.lockdownLevel = level as LockdownLevel
  }

  setMaskMandate(enabled: boolean): void {
    this.maskMandate = !!enabled
  }

  setStimulus(amount: number): void {
    this.stimulusAmount = Math.max(0, amount)
  }

  setVaccinationRate(rate: number): void {
    this.vaccinationRate = Math.max(0, Math.min(1, rate))
  }

  transmissionMultiplier(): number {
    let m = CONFIG.LOCKDOWN_TRANSMISSION_MULTIPLIER[this.lockdownLevel]
    if (this.maskMandate) m *= 1 - CONFIG.MASK_TRANSMISSION_REDUCTION
    return m
  }
}

export class Banks {
  totalReserves: number = CONFIG.BANK_INITIAL_RESERVES
  outstandingLoans: number = 0

  get inCrisis(): boolean {
    return this.totalReserves < CONFIG.BANK_RESERVE_THRESHOLD
  }

  get interestRate(): number {
    return this.inCrisis
      ? CONFIG.BANK_CRISIS_INTEREST_RATE
      : CONFIG.BANK_NORMAL_INTEREST_RATE
  }

  requestLoan(amount: number): number {
    if (this.inCrisis) return 0
    const headroom = this.totalReserves - CONFIG.BANK_RESERVE_THRESHOLD
    const actual = Math.min(amount, Math.max(0, headroom))
    if (actual <= 0) return 0
    this.totalReserves -= actual
    this.outstandingLoans += actual
    return actual
  }

  acceptRepayment(amount: number): void {
    const repaid = Math.min(amount, this.outstandingLoans)
    this.outstandingLoans -= repaid
    this.totalReserves += repaid
  }

  tick(companies: Company[]): void {
    const rate = this.interestRate
    const repayFrac = CONFIG.BANK_LOAN_REPAYMENT_RATE
    for (const c of companies) {
      if (c.outstandingLoan <= 0) continue
      c.cashBalance -= c.outstandingLoan * rate
      const repayment = c.outstandingLoan * repayFrac
      c.outstandingLoan -= repayment
      this.acceptRepayment(repayment)
    }
  }
}

export class HealthcareDepartment {
  bedCapacity: number = CONFIG.HEALTHCARE_BED_CAPACITY
  currentPatients: number = 0

  get overwhelmed(): boolean {
    return this.currentPatients > this.bedCapacity
  }

  get occupancyRatio(): number {
    return this.currentPatients / Math.max(1, this.bedCapacity)
  }

  get effectiveMortalityRate(): number {
    const base = CONFIG.BASE_DAILY_MORTALITY_RATE
    return this.overwhelmed
      ? base * CONFIG.HEALTHCARE_OVERFLOW_MORTALITY_MULTIPLIER
      : base
  }

  update(symptomaticCount: number): void {
    this.currentPatients = symptomaticCount
  }
}

export type CompanySector = 'Essential' | 'Non-Essential'

export class Company {
  companyId: number
  sector: CompanySector
  cashBalance: number
  outstandingLoan: number = 0
  isStruggling: boolean = false
  ticksStruggling: number = 0
  bankrupt: boolean = false
  totalRevenueEarned: number = 0

  constructor(companyId: number, sector: CompanySector, cashBalance: number) {
    this.companyId = companyId
    this.sector = sector
    this.cashBalance = cashBalance
  }
}
