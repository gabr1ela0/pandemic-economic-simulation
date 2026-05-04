"""
SimulationEngine — the master tick loop.

Phase order (per spec):
  1. Epidemiological  — transmission + SEIR transitions + vaccination
  2. Labour           — workforce, revenue, wages, struggling, firing
  3. Consumption      — agent spending + government stimulus
  4. Financial        — bank interest / repayments + company loans
  5. Reporting        — collect daily metrics snapshot
"""

from __future__ import annotations

import time
from typing import Optional

import numpy as np
import pandas as pd

from config import CONFIG
from agents import AgentPool, HealthState
from entities import Banks, Company, Government, HealthcareDepartment


class SimulationEngine:

    def __init__(
        self,
        government: Optional[Government] = None,
        seed: Optional[int] = None,
    ) -> None:
        seed        = seed if seed is not None else CONFIG["RANDOM_SEED"]
        self.rng    = np.random.default_rng(seed)
        self.tick_num = 0

        # ── Macro entities ────────────────────────────────────────
        self.government  = government or Government()
        self.banks       = Banks()
        self.healthcare  = HealthcareDepartment()

        # ── Agent pool ────────────────────────────────────────────
        self.agents = AgentPool(CONFIG["NUM_AGENTS"], self.rng)

        # ── Companies ─────────────────────────────────────────────
        self.companies: list[Company] = self._init_companies()
        self._assign_agents_to_companies()

        # ── Precomputed company attribute arrays (kept in sync) ───
        n_co = len(self.companies)
        self._company_is_essential = np.array(
            [c.sector == "Essential" for c in self.companies], dtype=bool
        )

        # ── Seed the outbreak ─────────────────────────────────────
        self._seed_infection()

        # ── Tick-level caches (refreshed at start of each tick) ───
        self._at_work:   np.ndarray = np.zeros(self.agents.n, dtype=bool)
        self._at_market: np.ndarray = np.zeros(self.agents.n, dtype=bool)

        # ── Metrics ───────────────────────────────────────────────
        self.records:        list[dict] = []
        self.daily_gdp:      float      = 0.0
        self._rehires_today: int        = 0

    # ─────────────────────────────────────────────────────────────────────────
    #  Initialisation helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _init_companies(self) -> list[Company]:
        n_co        = CONFIG["NUM_COMPANIES"]
        n_essential = int(n_co * CONFIG["ESSENTIAL_COMPANY_RATIO"])
        companies   = []
        for i in range(n_co):
            sector = "Essential" if i < n_essential else "Non-Essential"
            cash   = float(
                self.rng.normal(
                    CONFIG["INITIAL_COMPANY_CASH_MEAN"],
                    CONFIG["INITIAL_COMPANY_CASH_STD"],
                )
            )
            cash = max(CONFIG["INITIAL_COMPANY_CASH_MIN"], cash)
            companies.append(Company(company_id=i, sector=sector, cash_balance=cash))
        return companies

    def _assign_agents_to_companies(self) -> None:
        n   = self.agents.n
        n_co = len(self.companies)
        ids = self.rng.integers(0, n_co, n)
        self.agents.company_id[:] = ids
        self.agents.employed[:]   = True

    def _seed_infection(self) -> None:
        k = CONFIG["INITIAL_INFECTED_COUNT"]
        idx = self.rng.choice(self.agents.n, size=k, replace=False)
        self.agents.health_state[idx] = HealthState.INFECTIOUS_ASYMPTOMATIC

    # ─────────────────────────────────────────────────────────────────────────
    #  Master tick
    # ─────────────────────────────────────────────────────────────────────────

    def tick(self) -> None:
        self.tick_num += 1
        lockdown = self.government.lockdown_level

        # Cache stochastic decisions once so both epi and labour see the same workers
        self._at_work   = self.agents.at_work_mask(lockdown)
        self._at_market = self.agents.at_market_mask(lockdown)

        self._epidemiological_phase()
        self._labour_phase()
        self._consumption_phase()
        self._financial_phase()
        self._reporting_phase()

    # ─────────────────────────────────────────────────────────────────────────
    #  Phase 1 — Epidemiological
    # ─────────────────────────────────────────────────────────────────────────

    def _epidemiological_phase(self) -> None:
        p_base = (
            CONFIG["BASE_TRANSMISSION_RATE"]
            * self.government.transmission_multiplier()
        )

        susceptible = self.agents.susceptible_mask()
        infectious  = self.agents.infectious_mask()
        new_exposed = np.zeros(self.agents.n, dtype=bool)

        # ── Workplace transmission ────────────────────────────────
        inf_at_work = self._at_work & infectious
        sus_at_work = self._at_work & susceptible & self.agents.employed

        if inf_at_work.any() and sus_at_work.any():
            # Count infectious colleagues per company in one bincount call
            inf_per_co = np.bincount(
                self.agents.company_id[inf_at_work],
                minlength=len(self.companies),
            )
            sus_idx    = np.where(sus_at_work)[0]
            exposure   = inf_per_co[self.agents.company_id[sus_idx]]
            p_infected = 1.0 - (1.0 - p_base) ** exposure
            roll       = self.rng.random(len(sus_idx))
            new_exposed[sus_idx[roll < p_infected]] = True

        # ── Market transmission (mean-field) ──────────────────────
        p_mkt       = p_base * CONFIG["MARKET_TRANSMISSION_SCALE"]
        inf_mkt_cnt = int((self._at_market & infectious).sum())
        sus_at_mkt  = self._at_market & susceptible

        if inf_mkt_cnt > 0 and sus_at_mkt.any():
            expected_inf_contacts = CONFIG["MARKET_CONTACT_FRACTION"] * inf_mkt_cnt
            p_mkt_inf  = 1.0 - (1.0 - p_mkt) ** max(1.0, expected_inf_contacts)
            sus_mkt    = np.where(sus_at_mkt)[0]
            roll       = self.rng.random(len(sus_mkt))
            new_exposed[sus_mkt[roll < p_mkt_inf]] = True

        # Apply exposures (don't overwrite already-infected agents)
        really_new = new_exposed & susceptible
        self.agents.health_state[really_new]  = HealthState.EXPOSED
        self.agents.days_in_state[really_new] = 0

        # ── SEIR state transitions ────────────────────────────────
        self._advance_states()

        # ── Vaccination ───────────────────────────────────────────
        if self.government.vaccination_rate > 0:
            self._apply_vaccinations()

    def _advance_states(self) -> None:
        agents        = self.agents
        mortality_rate = self.healthcare.effective_mortality_rate

        # Increment days counter for all active disease states
        progressing = (
            (agents.health_state != HealthState.SUSCEPTIBLE)
            & (agents.health_state != HealthState.RECOVERED)
            & (agents.health_state != HealthState.DEAD)
        )
        agents.days_in_state[progressing] += 1

        # Exposed → Infectious_A or Infectious_S
        to_infect = (
            (agents.health_state == HealthState.EXPOSED)
            & (agents.days_in_state >= CONFIG["INCUBATION_DAYS"])
        )
        if to_infect.any():
            asym = to_infect & (self.rng.random(agents.n) < CONFIG["ASYMPTOMATIC_RATIO"])
            symp = to_infect & ~asym
            agents.health_state[asym] = HealthState.INFECTIOUS_ASYMPTOMATIC
            agents.health_state[symp] = HealthState.INFECTIOUS_SYMPTOMATIC
            agents.days_in_state[to_infect] = 0

        # Infectious_A → Recovered
        to_recover_a = (
            (agents.health_state == HealthState.INFECTIOUS_ASYMPTOMATIC)
            & (agents.days_in_state >= CONFIG["ASYMPTOMATIC_INFECTIOUS_DAYS"])
        )
        agents.health_state[to_recover_a]  = HealthState.RECOVERED
        agents.days_in_state[to_recover_a] = 0

        # Infectious_S → Dead (daily mortality roll) or Recovered (after full period)
        symptomatic = (
            (agents.health_state == HealthState.INFECTIOUS_SYMPTOMATIC)
            & agents.is_alive
        )
        if symptomatic.any():
            dies    = symptomatic & (self.rng.random(agents.n) < mortality_rate)
            agents.health_state[dies] = HealthState.DEAD
            agents.is_alive[dies]     = False
            agents.employed[dies]     = False

            recovers = (
                symptomatic
                & ~dies
                & (agents.days_in_state >= CONFIG["SYMPTOMATIC_RECOVERY_DAYS"])
            )
            agents.health_state[recovers]  = HealthState.RECOVERED
            agents.days_in_state[recovers] = 0

        # Sync healthcare bed occupancy
        symp_count = int(
            (agents.health_state == HealthState.INFECTIOUS_SYMPTOMATIC).sum()
        )
        self.healthcare.update(symp_count)

    def _apply_vaccinations(self) -> None:
        rate = self.government.vaccination_rate
        n_per_tick = max(1, int(
            self.agents.n * rate * CONFIG["VACCINATIONS_PER_DAY_PER_RATE"]
        ))
        sus_idx = np.where(self.agents.susceptible_mask())[0]
        if len(sus_idx) == 0:
            return
        chosen = self.rng.choice(
            sus_idx,
            size=min(n_per_tick, len(sus_idx)),
            replace=False,
        )
        self.agents.vaccinated[chosen] = True

    # ─────────────────────────────────────────────────────────────────────────
    #  Phase 2 — Labour
    # ─────────────────────────────────────────────────────────────────────────

    def _labour_phase(self) -> None:
        agents   = self.agents
        lockdown = self.government.lockdown_level
        cdi      = self._consumer_demand_index()

        at_work    = self._at_work
        emp_alive  = agents.employed & agents.is_alive

        # Vectorised: worker counts per company
        at_work_per_co = np.bincount(
            agents.company_id[at_work & agents.employed],
            minlength=len(self.companies),
        )
        emp_per_co = np.bincount(
            agents.company_id[emp_alive],
            minlength=len(self.companies),
        )

        # Vectorised revenue ─ Essential vs Non-Essential demand
        demand_ess  = CONFIG["ESSENTIAL_DEMAND_BASE"] * cdi
        penalty     = lockdown * CONFIG["LOCKDOWN_NON_ESSENTIAL_PENALTY"]
        demand_non  = (
            CONFIG["NON_ESSENTIAL_DEMAND_BASE"] * cdi * max(0.0, 1.0 - penalty)
        )
        demand_per_co = np.where(
            self._company_is_essential, demand_ess, demand_non
        )
        revenue_per_co = (
            at_work_per_co * CONFIG["PRODUCTIVITY_CONSTANT"] * demand_per_co
        )

        # Wages: every agent at work earns DAILY_WAGE
        agents.wallet[at_work] += CONFIG["DAILY_WAGE"]

        self.daily_gdp = float(revenue_per_co.sum())

        # Update company objects and handle struggling / bankruptcy
        max_loan = CONFIG["BANK_LOAN_AMOUNT"] * CONFIG["BANK_MAX_LOAN_MULTIPLE"]
        for i, company in enumerate(self.companies):
            if company.bankrupt:
                continue

            revenue        = float(revenue_per_co[i])
            wage_bill      = float(at_work_per_co[i]) * CONFIG["DAILY_WAGE"]
            total_emp      = int(emp_per_co[i])
            active_workers = int(at_work_per_co[i])

            company.cash_balance        += revenue - wage_bill
            company.total_revenue_earned += revenue

            # ── Struggling check ──
            workforce_ratio   = active_workers / max(1, total_emp)
            company.is_struggling = workforce_ratio < CONFIG["WORKFORCE_STRUGGLING_THRESHOLD"]

            if company.is_struggling:
                company.ticks_struggling += 1

                # Bankruptcy: deeply negative cash and loans maxed out
                if (
                    company.cash_balance   < CONFIG["BANKRUPTCY_CASH_THRESHOLD"]
                    and company.outstanding_loan >= max_loan * 0.9
                ):
                    company.bankrupt = True
                    emp_mask = emp_alive & (agents.company_id == i)
                    emp_idx  = np.where(emp_mask)[0]
                    agents.employed[emp_idx]   = False
                    agents.company_id[emp_idx] = -1
                    continue

                # Fire a fraction of the workforce while cash-negative
                if company.cash_balance < 0 and total_emp > 1:
                    emp_mask = emp_alive & (agents.company_id == i)
                    emp_idx  = np.where(emp_mask)[0]
                    n_fire   = max(1, int(len(emp_idx) * CONFIG["FIRING_PROBABILITY"]))
                    fire_idx = self.rng.choice(
                        emp_idx,
                        size=min(n_fire, len(emp_idx)),
                        replace=False,
                    )
                    agents.employed[fire_idx]   = False
                    agents.company_id[fire_idx] = -1
            else:
                company.ticks_struggling = 0

        # ── Re-employment ────────────────────────────────────────
        # Healthy companies (cash and workforce both above thresholds)
        # rehire unemployed agents at a low per-tick probability.
        self._rehires_today = 0
        unemp_idx = np.where(
            agents.is_alive & ~agents.employed & (agents.company_id == -1)
        )[0]
        if len(unemp_idx) > 0:
            workforce_ratio = at_work_per_co / np.maximum(1, emp_per_co)
            eligible = []
            min_cash = CONFIG["REHIRE_HEALTHY_COMPANY_CASH_MIN"]
            min_ratio = CONFIG["REHIRE_HEALTHY_WORKFORCE_RATIO"]
            for i, c in enumerate(self.companies):
                if (
                    not c.bankrupt
                    and not c.is_struggling
                    and c.cash_balance > min_cash
                    and workforce_ratio[i] > min_ratio
                ):
                    eligible.append(c.company_id)
            if eligible:
                eligible_ids = np.array(eligible, dtype=np.int32)
                hire_roll = self.rng.random(len(unemp_idx))
                hire_mask = hire_roll < CONFIG["BASE_REHIRE_PROBABILITY"]
                n_hires = int(hire_mask.sum())
                if n_hires > 0:
                    chosen_cos = self.rng.choice(eligible_ids, size=n_hires)
                    hired_idx = unemp_idx[hire_mask]
                    agents.company_id[hired_idx] = chosen_cos
                    agents.employed[hired_idx] = True
                    self._rehires_today = n_hires

    # ─────────────────────────────────────────────────────────────────────────
    #  Phase 3 — Consumption
    # ─────────────────────────────────────────────────────────────────────────

    def _consumption_phase(self) -> None:
        agents = self.agents
        gov    = self.government
        alive  = agents.is_alive

        # Every living agent pays their minimum daily consumption
        agents.wallet[alive] -= agents.base_consumption[alive]
        agents.wallet.clip(min=0.0, out=agents.wallet)

        # Stimulus: government pays agents below the wallet threshold
        if gov.stimulus_amount > 0:
            needs = alive & (agents.wallet < CONFIG["STIMULUS_WALLET_THRESHOLD"])
            agents.wallet[needs] += gov.stimulus_amount
            gov.national_debt    += float(needs.sum()) * gov.stimulus_amount

    # ─────────────────────────────────────────────────────────────────────────
    #  Phase 4 — Financial
    # ─────────────────────────────────────────────────────────────────────────

    def _financial_phase(self) -> None:
        self.banks.tick(self.companies)

        max_loan = CONFIG["BANK_LOAN_AMOUNT"] * CONFIG["BANK_MAX_LOAN_MULTIPLE"]
        for company in self.companies:
            if company.bankrupt:
                continue
            if (
                company.is_struggling
                and company.cash_balance < 0
                and company.outstanding_loan < max_loan
            ):
                loan = self.banks.request_loan(CONFIG["BANK_LOAN_AMOUNT"])
                company.cash_balance     += loan
                company.outstanding_loan += loan

    # ─────────────────────────────────────────────────────────────────────────
    #  Phase 5 — Reporting
    # ─────────────────────────────────────────────────────────────────────────

    def _reporting_phase(self) -> None:
        counts  = self.agents.state_counts()
        gov     = self.government
        hc      = self.healthcare
        banks   = self.banks
        cdi     = self._consumer_demand_index()
        n_bankrupt   = sum(1 for c in self.companies if c.bankrupt)
        n_struggling = sum(1 for c in self.companies if c.is_struggling and not c.bankrupt)

        self.records.append({
            "tick":                     self.tick_num,
            "alive":                    self.agents.total_alive,
            "dead":                     counts["dead"],
            "susceptible":              counts["susceptible"],
            "exposed":                  counts["exposed"],
            "infectious_asymptomatic":  counts["infectious_asymptomatic"],
            "infectious_symptomatic":   counts["infectious_symptomatic"],
            "recovered":                counts["recovered"],
            "vaccinated":               int(self.agents.vaccinated.sum()),
            "gdp":                      round(self.daily_gdp, 2),
            "unemployment_rate_pct":    round(self.agents.unemployment_rate * 100, 2),
            "national_debt":            round(gov.national_debt, 2),
            "bank_reserves":            round(banks.total_reserves, 2),
            "bank_in_crisis":           int(banks.in_crisis),
            "healthcare_patients":      hc.current_patients,
            "healthcare_capacity":      hc.bed_capacity,
            "healthcare_overwhelmed":   int(hc.overwhelmed),
            "companies_struggling":     n_struggling,
            "companies_bankrupt":       n_bankrupt,
            "lockdown_level":           gov.lockdown_level,
            "mask_mandate":             int(gov.mask_mandate),
            "stimulus_amount":          gov.stimulus_amount,
            "vaccination_rate":         gov.vaccination_rate,
            "mean_wallet":              round(self.agents.mean_wallet, 2),
            "median_wallet":            round(self.agents.median_wallet, 2),
            "consumer_demand_index":    round(cdi, 4),
            "rehires_today":            self._rehires_today,
        })

    # ─────────────────────────────────────────────────────────────────────────
    #  Helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _consumer_demand_index(self) -> float:
        death_suppression = max(
            0.10,
            1.0 - self.agents.total_dead * CONFIG["DEATH_DEMAND_SUPPRESSION_FACTOR"],
        )
        lockdown_factor = max(0.30, 1.0 - self.government.lockdown_level * 0.10)
        return death_suppression * lockdown_factor

    # ─────────────────────────────────────────────────────────────────────────
    #  Public API
    # ─────────────────────────────────────────────────────────────────────────

    def run(
        self,
        ticks: Optional[int] = None,
        verbose: bool = True,
    ) -> pd.DataFrame:
        ticks    = ticks or CONFIG["NUM_TICKS"]
        interval = CONFIG["PRINT_INTERVAL"]
        t0       = time.perf_counter()

        for t in range(ticks):
            self.tick()
            if verbose and (t % interval == 0 or t == ticks - 1):
                self.print_status()
            # Early exit if everyone is dead or recovered (no active spread)
            counts = self.agents.state_counts()
            if (
                counts["exposed"]
                + counts["infectious_asymptomatic"]
                + counts["infectious_symptomatic"]
                == 0
                and t > 30
            ):
                if verbose:
                    print(f"\n[Day {self.tick_num}] Epidemic resolved — ending early.")
                break

        elapsed = time.perf_counter() - t0
        if verbose:
            print(
                f"\nSimulation done: {self.tick_num} ticks in "
                f"{elapsed:.1f}s  ({elapsed / self.tick_num * 1000:.1f} ms/tick)"
            )
        return self.export_results()

    def export_results(self, filepath: Optional[str] = None) -> pd.DataFrame:
        filepath = filepath or CONFIG["OUTPUT_FILE"]
        df = pd.DataFrame(self.records)
        df.to_csv(filepath, index=False)
        return df

    def print_status(self) -> None:
        counts = self.agents.state_counts()
        gov    = self.government
        hc     = self.healthcare
        hc_str = (
            f"\033[91mOVERWHELMED {hc.current_patients}/{hc.bed_capacity}\033[0m"
            if hc.overwhelmed
            else f"{hc.current_patients}/{hc.bed_capacity}"
        )
        bankrupt   = sum(1 for c in self.companies if c.bankrupt)
        struggling = sum(1 for c in self.companies if c.is_struggling and not c.bankrupt)

        print(
            f"Day {self.tick_num:>3} │ "
            f"Dead: {counts['dead']:>4}  "
            f"Symp: {counts['infectious_symptomatic']:>4}  "
            f"Asym: {counts['infectious_asymptomatic']:>4}  "
            f"Recov: {counts['recovered']:>5}  │  "
            f"GDP: {self.daily_gdp:>10,.0f}  "
            f"Unemp: {self.agents.unemployment_rate * 100:>5.1f}%  "
            f"Debt: {gov.national_debt:>10,.0f}  │  "
            f"HC: {hc_str}  "
            f"Biz: {struggling}↓ {bankrupt}✗  "
            f"│ L{gov.lockdown_level}"
            f"{'M' if gov.mask_mandate else ' '}"
            f"{'V' if gov.vaccination_rate > 0 else ' '}"
            f"{'$' if gov.stimulus_amount > 0 else ' '}"
        )
