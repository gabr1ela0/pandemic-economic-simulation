# Pandemic & Economic Simulation — Project Context

> **For AI agents reading this**: This document tracks the full context, architecture, design decisions, and progress of this simulation project. Read this before making any changes.

---

## Project Summary

A high-performance stochastic agent-based simulation modelling a pandemic and economy simultaneously. The "Pressure Cooker" scenario forces a government (the user) to manage a pandemic through policies that directly conflict with economic stability.

**Core tension**: Lockdowns slow the virus but crash the economy. Doing nothing kills people and also crashes the economy (via deaths suppressing demand). There's no free lunch.

---

## Architecture

### Files

| File | Role |
|------|------|
| `config.py` | All simulation constants. Edit this to tune without touching logic. |
| `agents.py` | `AgentPool` class — all 10,000 agents as NumPy arrays (vectorised). |
| `entities.py` | `Government`, `Banks`, `HealthcareDepartment`, `Company` macro-entities. |
| `simulation.py` | `SimulationEngine` — master tick loop with 5 ordered phases. |
| `main.py` | CLI entry point: launches Tkinter dashboard by default, or headless `--batch` mode. |
| `dashboard.py` | **Tkinter dashboard** — dark-theme GUI with live charts, KPI tiles, policy controls, event log, and toast notifications. |

### Simulation Tick Phases (strict order)

1. **Epidemiological** — Transmission (workplace + market), SEIR transitions, vaccination
2. **Labour** — Workforce counts, revenue, wages, struggling detection, firing/bankruptcy
3. **Consumption** — Agent spending, government stimulus payments
4. **Financial** — Bank interest accrual, loan repayments, new loans to struggling companies
5. **Reporting** — Snapshot all metrics to `records` list → CSV

### Agent State Machine

```
SUSCEPTIBLE → EXPOSED → INFECTIOUS_ASYMPTOMATIC → RECOVERED
                      ↘ INFECTIOUS_SYMPTOMATIC  → RECOVERED
                                                 → DEAD (daily mortality check)
```

Vaccinated agents skip the SUSCEPTIBLE → EXPOSED transition entirely.

---

## Key Config Parameters

| Parameter | Value | Effect |
|-----------|-------|--------|
| `NUM_AGENTS` | 10,000 | Population size |
| `NUM_COMPANIES` | 200 | ~50 per agent |
| `BASE_TRANSMISSION_RATE` | 0.055 | Per-contact daily probability |
| `LOCKDOWN_TRANSMISSION_MULTIPLIER` | [1.0, 0.7, 0.4, 0.15] | By level 0-3 |
| `MASK_TRANSMISSION_REDUCTION` | 0.50 | 50% reduction when mandate active |
| `BASE_DAILY_MORTALITY_RATE` | 0.007 | ~0.7% per day for symptomatic |
| `HEALTHCARE_BED_CAPACITY` | 500 | Per 10k population (5%) |
| `HEALTHCARE_OVERFLOW_MORTALITY_MULTIPLIER` | 2.0 | Doubles mortality when overwhelmed |
| `POVERTY_TRAP_MULTIPLIER` | 3 | Agents break lockdown if wallet < consumption × 3 |
| `FIRING_PROBABILITY` | 0.10 | % of workforce fired per tick when cash-negative |
| `BANKRUPTCY_CASH_THRESHOLD` | -$120,000 | Below this + max loan = company gone |

---

## Economics Model

### Company Revenue Formula
```
revenue = active_workers × PRODUCTIVITY_CONSTANT × demand_index

demand_index (Essential)     = ESSENTIAL_DEMAND_BASE × consumer_demand_index
demand_index (Non-Essential) = NON_ESSENTIAL_DEMAND_BASE × cdi × (1 - lockdown × LOCKDOWN_NON_ESSENTIAL_PENALTY)
```

### Consumer Demand Index (CDI)
```
cdi = death_suppression × lockdown_factor
    = max(0.10, 1 - total_deaths × 0.00004)  ×  max(0.30, 1 - lockdown × 0.10)
```
High death counts suppress demand even without lockdown — economy suffers either way.

### Poverty Trap (Critical Mechanic)
Agents ignore lockdowns if `wallet < base_consumption × 3`. This means:
- Rich agents comply with lockdowns
- Poor agents must work/go out to survive → create transmission chains
- Stimulus can break the poverty trap by raising wallets above threshold

### Bank Crisis Trigger
When `total_reserves < $2,500,000` (from $15M start):
- No new loans issued
- Interest rate spikes: 0.01%/day → 0.05%/day
- Companies that were struggling now go bankrupt faster

---

## Policy Levers (Government Controls)

| Policy | Range | Effect |
|--------|-------|--------|
| Lockdown Level | 0–3 | Multiplies transmission, cuts non-essential demand |
| Mask Mandate | On/Off | 50% transmission reduction |
| Stimulus Amount | $0–∞/day | Pays agents with wallet < $300, adds to national debt |
| Vaccination Rate | 0.0–1.0 | Fraction of max daily vaccinations (0.003 × rate × N) |

---

## Session History

### Session 1 — Initial Build
- **Spec**: Build a high-performance stochastic ABM with vectorised NumPy agents
- **Delivered**: Full Python simulation with 5-phase tick loop
  - `agents.py` — AgentPool with NumPy arrays, boolean masks for all agent operations
  - `entities.py` — Government, Banks, HealthcareDepartment, Company classes
  - `simulation.py` — SimulationEngine with all 5 phases
  - `config.py` — All constants extracted
  - `main.py` — Interactive CLI console + batch mode
- **Output format**: `sim_results.csv` with 27 columns per tick
- **Validation**: Sanity runs showed epidemic curve, economic collapse under no-policy conditions

### Session 2 — Tkinter Visual Dashboard
- **Request**: Visual interactive interface integrated into the Python project — `python main.py` opens the dashboard. Dark theme, game-style UI.
- **Delivered**: `dashboard.py` — a self-contained Tkinter dashboard that runs the real Python simulation in a background thread and updates the UI on every tick.
- **UI structure**:
  - **Sidebar (left, 300px)**: Policy controls (lockdown picker, mask mandate checkbox, vaccination slider, stimulus slider, speed selector), Run/Pause/Next Day/Reset buttons, legend.
  - **Main area (right)**: Five KPI tiles (Active, Deaths, Hospital %, Unemployment, Bankrupt companies), Crisis Score HUD, four live line charts (Infections, GDP, Hospital %, Wealth), Event Log, status bar.
- **Key classes**:
  - `Dashboard` — main `tk.Tk` window, owns the tick loop and all UI state.
  - `LineChart` — canvas-based line chart with halo effect, grid lines, auto-scaling y-axis.
  - `KpiTile` — animated numeric tile with sparkline and colour-coded status (green/yellow/red).
  - `Sparkline` — small inline trend chart inside each KPI tile.
  - `LockdownPicker` — row of four buttons (None/Light/Mod/Full) with colour coding per level.
  - `ScoreHud` — crisis score display updated every tick.
  - `EventLog` — scrollable text widget logging milestone events with coloured timestamps.
- **Toast notifications**: Slide in horizontally from the right at the bottom of the window. Triggered once per event type (first death, hospital overwhelmed, first bankruptcy, wave peak, bank crisis, first rehire). Auto-dismiss after 2 seconds.
- **Button design**: All buttons use `relief="groove"` with explicit `bg`, `fg`, `activebackground`, and `activeforeground` to ensure colours render correctly across platforms (macOS, Linux). Idle buttons use dark navy (`#2e3d52`) with white text. Selected/active states use bright colours (green, yellow, orange, red) with black text.
- **Game-over modal**: Appears when the epidemic ends or 365 ticks complete. Shows final score, deaths, peak unemployment, bankruptcies, national debt, days survived, and a Replay button.
- **Project structure after this session**:
  ```
  agents.py      — AgentPool (NumPy vectorised)
  entities.py    — Government, Banks, HealthcareDepartment, Company
  simulation.py  — SimulationEngine (5-phase tick loop)
  config.py      — All constants
  dashboard.py   — Tkinter GUI dashboard
  main.py        — Entry point (launches dashboard by default, --batch for headless)
  ```

### Session 3 — Dashboard UI Fixes
- **Button text readability**: Switched all buttons from `relief="flat"` to `relief="groove", bd=1` to force Tkinter to honour background colours on all platforms. Added `activebackground` and `activeforeground` to every button so hover/click states do not revert to system gray.
- **Lockdown buttons no longer cut off**: Sidebar width reduced from 320px to 300px, internal padding from 16px to 12px, button width from 7 to 6 chars. All four buttons now fit without clipping.
- **Toast position**: Moved from top-right (sliding in from the right) to bottom-right (sliding in horizontally from the right), so notifications do not obscure the KPI tiles.

---

## Simulation Outputs (CSV Columns)

`tick, alive, dead, susceptible, exposed, infectious_asymptomatic, infectious_symptomatic, recovered, vaccinated, gdp, unemployment_rate_pct, national_debt, bank_reserves, bank_in_crisis, healthcare_patients, healthcare_capacity, healthcare_overwhelmed, companies_struggling, companies_bankrupt, lockdown_level, mask_mandate, stimulus_amount, vaccination_rate, mean_wallet, median_wallet, consumer_demand_index`

---

## Known Behaviours / Emergent Dynamics

1. **Healthcare overflow cascade**: If symptomatic count exceeds 500, mortality doubles → more deaths → demand suppression → economy contracts further even without lockdown
2. **Poverty trap spreads disease**: Lower-wallet populations break lockdowns → virus persists in poorer subgroups → R_eff stays > 1 despite lockdown
3. **Non-essential sector collapses fastest**: Lockdown level 2+ with sustained CDI drop often bankrupts non-essential companies within 60-90 days
4. **Bank crisis accelerates bankruptcies**: Once reserves hit crisis threshold, companies can't get new loans → cascade of bankruptcies
5. **Vaccination sweet spot**: Rate 0.4-0.6 + early lockdown 1 seems to minimise both deaths and economic damage
6. **Stimulus paradox**: High stimulus keeps the economy alive but inflates national debt; stopping stimulus mid-crisis crashes wallets → poverty trap activates → more transmission

---

## Potential Future Improvements

- [ ] Re-employment mechanic (unemployed agents find new jobs over time)
- [ ] Age stratification (elderly agents have higher mortality)
- [ ] Geographic clustering (agents have spatial positions, local transmission clusters)
- [ ] Variant waves (new virus variants with different R0 / severity)
- [ ] Testing & contact tracing policy lever
- [ ] Export dashboard to PNG/data
- [ ] Policy presets ("no intervention", "Sweden model", "New Zealand model")
- [ ] Multi-run comparison / parameter sweep UI
- [ ] WebWorker for simulation (keeps UI responsive at 10× speed)
- [ ] Python backend + WebSocket for real-time streaming of Python sim → browser