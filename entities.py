"""
Macro-entities: Government, Banks, HealthcareDepartment, Company.

Each acts as a singleton-style controller that the SimulationEngine references
directly.  Companies are plain objects instantiated in a list.
"""

from __future__ import annotations

import numpy as np

from config import CONFIG


#  Government

class Government:
    """
    Holds the four policy 'presets' the player can adjust between ticks.
    Also accumulates national_debt as stimulus is paid out.
    """

    def __init__(self) -> None:
        self.lockdown_level:    int   = CONFIG["INITIAL_LOCKDOWN_LEVEL"]
        self.mask_mandate:      bool  = CONFIG["INITIAL_MASK_MANDATE"]
        self.stimulus_amount:   float = CONFIG["INITIAL_STIMULUS_AMOUNT"]
        self.vaccination_rate:  float = CONFIG["INITIAL_VACCINATION_RATE"]
        self.national_debt:     float = 0.0

    #  Setters with validation

    def set_lockdown(self, level: int) -> None:
        if level not in (0, 1, 2, 3):
            raise ValueError("Lockdown level must be 0, 1, 2, or 3.")
        self.lockdown_level = level

    def set_mask_mandate(self, enabled: bool) -> None:
        self.mask_mandate = bool(enabled)

    def set_stimulus(self, amount: float) -> None:
        self.stimulus_amount = max(0.0, float(amount))

    def set_vaccination_rate(self, rate: float) -> None:
        self.vaccination_rate = float(np.clip(rate, 0.0, 1.0))

    # -- Computed properties ---------------------------------------------------

    def transmission_multiplier(self) -> float:
        m = CONFIG["LOCKDOWN_TRANSMISSION_MULTIPLIER"][self.lockdown_level]
        if self.mask_mandate:
            m *= 1.0 - CONFIG["MASK_TRANSMISSION_REDUCTION"]
        return m

    def __repr__(self) -> str:
        return (
            f"Government(lockdown={self.lockdown_level}, mask={self.mask_mandate}, "
            f"stimulus={self.stimulus_amount:.0f}, vacc={self.vaccination_rate:.2f}, "
            f"debt={self.national_debt:,.0f})"
        )


#  Banks

class Banks:
    """
    Tracks central reserves.  Once reserves fall below BANK_RESERVE_THRESHOLD
    the bank enters 'crisis' mode: interest rates spike and new loans are denied.
    """

    def __init__(self) -> None:
        self.total_reserves:   float = CONFIG["BANK_INITIAL_RESERVES"]
        self.outstanding_loans: float = 0.0

    @property
    def in_crisis(self) -> bool:
        return self.total_reserves < CONFIG["BANK_RESERVE_THRESHOLD"]

    @property
    def interest_rate(self) -> float:
        return (
            CONFIG["BANK_CRISIS_INTEREST_RATE"]
            if self.in_crisis
            else CONFIG["BANK_NORMAL_INTEREST_RATE"]
        )

    def request_loan(self, amount: float) -> float:
        if self.in_crisis:
            return 0.0
        headroom = self.total_reserves - CONFIG["BANK_RESERVE_THRESHOLD"]
        actual   = min(amount, max(0.0, headroom))
        if actual <= 0:
            return 0.0
        self.total_reserves   -= actual
        self.outstanding_loans += actual
        return actual

    def _accept_repayment(self, amount: float) -> None:
        repaid                  = min(amount, self.outstanding_loans)
        self.outstanding_loans -= repaid
        self.total_reserves    += repaid

    def tick(self, companies: list[Company]) -> None:
        """Accrue interest on every outstanding company loan; collect partial repayments."""
        rate = self.interest_rate
        repay_frac = CONFIG["BANK_LOAN_REPAYMENT_RATE"]
        for company in companies:
            if company.outstanding_loan <= 0:
                continue
            # Interest charge
            company.cash_balance -= company.outstanding_loan * rate
            # Partial repayment
            repayment             = company.outstanding_loan * repay_frac
            company.outstanding_loan -= repayment
            self._accept_repayment(repayment)


#  Healthcare

class HealthcareDepartment:
    """
    Tracks ICU / hospital capacity.  When current_patients exceeds bed_capacity
    the effective mortality rate is doubled for all symptomatic agents.
    """

    def __init__(self) -> None:
        self.bed_capacity:    int = CONFIG["HEALTHCARE_BED_CAPACITY"]
        self.current_patients: int = 0

    @property
    def overwhelmed(self) -> bool:
        return self.current_patients > self.bed_capacity

    @property
    def occupancy_ratio(self) -> float:
        return self.current_patients / max(1, self.bed_capacity)

    @property
    def effective_mortality_rate(self) -> float:
        base = CONFIG["BASE_DAILY_MORTALITY_RATE"]
        return (
            base * CONFIG["HEALTHCARE_OVERFLOW_MORTALITY_MULTIPLIER"]
            if self.overwhelmed
            else base
        )

    def update(self, symptomatic_count: int) -> None:
        self.current_patients = symptomatic_count


#  Company

class Company:
    """
    One firm.  Employee membership is derived dynamically from agents.company_id
    rather than being stored here, which keeps synchronisation trivial.
    """

    def __init__(self, company_id: int, sector: str, cash_balance: float) -> None:
        self.company_id:          int   = company_id
        self.sector:              str   = sector   # "Essential" | "Non-Essential"
        self.cash_balance:        float = cash_balance
        self.outstanding_loan:    float = 0.0
        self.is_struggling:       bool  = False
        self.ticks_struggling:    int   = 0
        self.bankrupt:            bool  = False
        self.total_revenue_earned: float = 0.0

    def compute_revenue(
        self,
        active_worker_count: int,
        consumer_demand_index: float,
        lockdown_level: int,
    ) -> float:
        if self.bankrupt or active_worker_count == 0:
            return 0.0

        if self.sector == "Essential":
            demand = CONFIG["ESSENTIAL_DEMAND_BASE"] * consumer_demand_index
        else:
            penalty = lockdown_level * CONFIG["LOCKDOWN_NON_ESSENTIAL_PENALTY"]
            demand  = (
                CONFIG["NON_ESSENTIAL_DEMAND_BASE"]
                * consumer_demand_index
                * max(0.0, 1.0 - penalty)
            )
        return active_worker_count * CONFIG["PRODUCTIVITY_CONSTANT"] * demand

    def __repr__(self) -> str:
        return (
            f"Company({self.company_id}, {self.sector}, "
            f"cash={self.cash_balance:,.0f}, "
            f"{'BANKRUPT' if self.bankrupt else 'struggling' if self.is_struggling else 'ok'})"
        )
