"""
Vectorised agent pool.  All agent attributes are numpy arrays so every
per-agent operation can be expressed as a single array expression.
"""

from __future__ import annotations

import numpy as np
from enum import IntEnum

from config import CONFIG


#  Health states 

class HealthState(IntEnum):
    SUSCEPTIBLE             = 0
    EXPOSED                 = 1
    INFECTIOUS_ASYMPTOMATIC = 2
    INFECTIOUS_SYMPTOMATIC  = 3
    RECOVERED               = 4
    DEAD                    = 5


#  AgentPool 

class AgentPool:
    """
    Stores all per-agent state as numpy arrays of length n.

    Having every attribute as a flat array lets us apply boolean masks and
    arithmetic without any Python-level loops over agents.
    """

    def __init__(self, n: int, rng: np.random.Generator) -> None:
        self.n   = n
        self.rng = rng

        #  Health 
        self.health_state  = np.full(n, HealthState.SUSCEPTIBLE, dtype=np.int8)
        self.days_in_state = np.zeros(n, dtype=np.int16)
        self.is_alive      = np.ones(n,  dtype=bool)
        self.vaccinated    = np.zeros(n, dtype=bool)

        #  Economics 
        self.wallet = rng.normal(
            CONFIG["INITIAL_WALLET_MEAN"],
            CONFIG["INITIAL_WALLET_STD"],
            n,
        ).clip(min=CONFIG["INITIAL_WALLET_MIN"])

        self.base_consumption = rng.normal(
            CONFIG["BASE_CONSUMPTION_MEAN"],
            CONFIG["BASE_CONSUMPTION_STD"],
            n,
        ).clip(min=CONFIG["BASE_CONSUMPTION_MIN"])

        # 0 = never breaks lockdown; 1 = always breaks lockdown
        self.risk_tolerance = rng.uniform(0.0, 1.0, n)

        #  Employment 
        # -1 = unemployed
        self.company_id = np.full(n, -1, dtype=np.int32)
        self.employed   = np.zeros(n, dtype=bool)

    #  Boolean masks 

    def susceptible_mask(self) -> np.ndarray:
        return (
            (self.health_state == HealthState.SUSCEPTIBLE)
            & self.is_alive
            & ~self.vaccinated
        )

    def infectious_mask(self) -> np.ndarray:
        return (
            (
                (self.health_state == HealthState.INFECTIOUS_ASYMPTOMATIC)
                | (self.health_state == HealthState.INFECTIOUS_SYMPTOMATIC)
            )
            & self.is_alive
        )

    def at_work_mask(self, lockdown_level: int) -> np.ndarray:
        """
        Returns True for every agent who physically goes to work this tick.

        Symptomatic agents mostly self-isolate but a small fraction still
        attend (poverty / income pressure). Under lockdown the poverty trap
        overrides compliance; otherwise agents comply proportionally to the
        inverse of their risk_tolerance scaled by lockdown stringency.
        """
        symp = self.health_state == HealthState.INFECTIOUS_SYMPTOMATIC
        non_symp = (
            self.is_alive
            & self.employed
            & ~symp
            & (self.health_state != HealthState.DEAD)
        )
        symp_attends = (
            self.is_alive
            & self.employed
            & symp
            & (self.rng.random(self.n) < CONFIG["SYMPTOMATIC_WORK_ATTENDANCE_FACTOR"])
        )
        can_work = non_symp | symp_attends

        if lockdown_level == 0:
            return can_work

        poverty_trap = self.wallet < (
            self.base_consumption * CONFIG["POVERTY_TRAP_MULTIPLIER"]
        )
        # Higher lockdown level → smaller effective break probability
        break_prob = self.risk_tolerance / lockdown_level
        breaks_by_choice = self.rng.random(self.n) < break_prob
        return can_work & (poverty_trap | breaks_by_choice)

    def at_market_mask(self, lockdown_level: int) -> np.ndarray:
        """
        Returns True for agents who visit markets / public spaces this tick.
        Symptomatic agents mostly self-isolate but a small fraction still
        venture out for essentials.
        """
        symp = self.health_state == HealthState.INFECTIOUS_SYMPTOMATIC
        non_symp = (
            self.is_alive
            & ~symp
            & (self.health_state != HealthState.DEAD)
        )
        symp_attends = (
            self.is_alive
            & symp
            & (self.rng.random(self.n) < CONFIG["SYMPTOMATIC_MARKET_ATTENDANCE_FACTOR"])
        )
        mobile = non_symp | symp_attends

        if lockdown_level == 0:
            return mobile

        poverty_trap    = self.wallet < (
            self.base_consumption * CONFIG["POVERTY_TRAP_MULTIPLIER"]
        )
        compliance_rate = lockdown_level * 0.20
        goes_out        = poverty_trap | (self.rng.random(self.n) > compliance_rate)
        return mobile & goes_out

    #  Aggregate statistics 

    @property
    def total_alive(self) -> int:
        return int(self.is_alive.sum())

    @property
    def total_dead(self) -> int:
        return int((~self.is_alive).sum())

    @property
    def unemployment_rate(self) -> float:
        alive = int(self.is_alive.sum())
        if alive == 0:
            return 1.0
        return float((self.is_alive & ~self.employed).sum() / alive)

    @property
    def mean_wallet(self) -> float:
        alive = self.is_alive
        return float(self.wallet[alive].mean()) if alive.any() else 0.0

    @property
    def median_wallet(self) -> float:
        alive = self.is_alive
        return float(np.median(self.wallet[alive])) if alive.any() else 0.0

    def state_counts(self) -> dict[str, int]:
        hs = self.health_state
        return {
            "susceptible":              int((hs == HealthState.SUSCEPTIBLE).sum()),
            "exposed":                  int((hs == HealthState.EXPOSED).sum()),
            "infectious_asymptomatic":  int((hs == HealthState.INFECTIOUS_ASYMPTOMATIC).sum()),
            "infectious_symptomatic":   int((hs == HealthState.INFECTIOUS_SYMPTOMATIC).sum()),
            "recovered":                int((hs == HealthState.RECOVERED).sum()),
            "dead":                     int((hs == HealthState.DEAD).sum()),
        }
