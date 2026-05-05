"""
All simulation constants. Tune freely — nothing is hard-coded elsewhere.
"""

CONFIG: dict = {

    #  Simulation 
    "NUM_AGENTS":               10_000,
    "NUM_TICKS":                365,
    "NUM_COMPANIES":            200,
    "ESSENTIAL_COMPANY_RATIO":  0.30,   # fraction of companies classed "Essential"
    "RANDOM_SEED":              42,
    "INITIAL_INFECTED_COUNT":   10,

    #  Epidemiology 
    #   BASE_TRANSMISSION_RATE: per-contact probability of infecting a susceptible
    "BASE_TRANSMISSION_RATE":                   0.045,
    #   MARKET_CONTACT_FRACTION: share of the market crowd each agent contacts per tick
    "MARKET_CONTACT_FRACTION":                  0.04,
    #   MARKET_TRANSMISSION_SCALE: market contacts are less close than workplace contacts
    "MARKET_TRANSMISSION_SCALE":                0.55,
    "INCUBATION_DAYS":                          5,    # Exposed → Infectious
    "ASYMPTOMATIC_INFECTIOUS_DAYS":             4,    # Inf_A → Recovered
    "SYMPTOMATIC_RECOVERY_DAYS":                10,   # Inf_S → Recovered (if alive)
    "ASYMPTOMATIC_RATIO":                       0.40, # fraction who never become symptomatic
    "BASE_DAILY_MORTALITY_RATE":                0.007,
    "HEALTHCARE_OVERFLOW_MORTALITY_MULTIPLIER": 2.0,
    "MASK_TRANSMISSION_REDUCTION":              0.50, # fraction reduction when mask mandate active
    # Index = lockdown level (0-3)
    "LOCKDOWN_TRANSMISSION_MULTIPLIER":         [1.00, 0.70, 0.40, 0.15],
    # Daily fraction of susceptible pop vaccinated (scaled by vaccination_rate preset)
    "VACCINATIONS_PER_DAY_PER_RATE":            0.003,

    #  Economy 
    "INITIAL_WALLET_MEAN":          1_200.0,
    "INITIAL_WALLET_STD":           400.0,
    "INITIAL_WALLET_MIN":           150.0,
    "BASE_CONSUMPTION_MEAN":        55.0,  # per tick minimum spend
    "BASE_CONSUMPTION_STD":         18.0,
    "BASE_CONSUMPTION_MIN":         15.0,
    "DAILY_WAGE":                   80.0,  # wage per working tick
    "PRODUCTIVITY_CONSTANT":        120.0, # revenue per worker per tick before demand scaling
    "INITIAL_COMPANY_CASH_MEAN":    80_000.0,
    "INITIAL_COMPANY_CASH_STD":     25_000.0,
    "INITIAL_COMPANY_CASH_MIN":     10_000.0,
    # Baseline demand indices (multiplied by consumer_demand_index each tick)
    "ESSENTIAL_DEMAND_BASE":        0.90,
    "NON_ESSENTIAL_DEMAND_BASE":    0.75,
    # Per lockdown level penalty applied only to Non-Essential sector demand
    "LOCKDOWN_NON_ESSENTIAL_PENALTY":   0.22,
    # Each death suppresses overall consumer demand by this fraction
    "DEATH_DEMAND_SUPPRESSION_FACTOR":  0.00004,

    #  Poverty Trap 
    # Agent ignores lockdown if wallet < base_consumption * this multiplier
    "POVERTY_TRAP_MULTIPLIER": 3,

    #  Labour
    # Active workforce fraction below which company is "Struggling"
    "WORKFORCE_STRUGGLING_THRESHOLD": 0.50,
    # Fraction of workforce fired per tick while struggling AND cash-negative
    "FIRING_PROBABILITY":             0.10,
    # Company cash below this while loan-maxed → bankruptcy (fire all staff)
    "BANKRUPTCY_CASH_THRESHOLD":      -120_000.0,
    # Per-tick chance an unemployed agent is rehired by a healthy company (~50% over 100 days)
    "BASE_REHIRE_PROBABILITY":           0.005,
    # Only companies with cash above this are eligible to hire
    "REHIRE_HEALTHY_COMPANY_CASH_MIN":   5_000.0,
    # Only companies with workforce ratio above this are eligible to hire
    "REHIRE_HEALTHY_WORKFORCE_RATIO":    0.7,
    # Fraction of symptomatic agents that still attend work (poverty / income pressure)
    "SYMPTOMATIC_WORK_ATTENDANCE_FACTOR":   0.30,
    # Fraction of symptomatic agents that still go to market
    "SYMPTOMATIC_MARKET_ATTENDANCE_FACTOR": 0.10,

    #  Banking 
    "BANK_INITIAL_RESERVES":      15_000_000.0,
    "BANK_RESERVE_THRESHOLD":      2_500_000.0,
    "BANK_LOAN_AMOUNT":               50_000.0,
    "BANK_MAX_LOAN_MULTIPLE":         3,         # company can hold up to N * LOAN_AMOUNT
    "BANK_NORMAL_INTEREST_RATE":      0.0001,    # daily rate
    "BANK_CRISIS_INTEREST_RATE":      0.0005,
    "BANK_LOAN_REPAYMENT_RATE":       0.008,     # fraction of outstanding loan repaid per tick

    #  Healthcare 
    "HEALTHCARE_BED_CAPACITY": 500,   # beds for 10k population

    #  Government Defaults 
    "INITIAL_LOCKDOWN_LEVEL":   0,     # 0-3
    "INITIAL_MASK_MANDATE":     False,
    "INITIAL_STIMULUS_AMOUNT":  0.0,   # flat payment per needy agent per tick
    "INITIAL_VACCINATION_RATE": 0.0,   # 0.0-1.0 scale factor
    # Agents with wallet below this receive stimulus
    "STIMULUS_WALLET_THRESHOLD": 300.0,

    #  Output 
    "OUTPUT_FILE":    "sim_results.csv",
    "PRINT_INTERVAL": 7,   # console update every N ticks
}
