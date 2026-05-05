# Pandemic & Economic Simulation - Code Explanation

This document explains how the simulation works: every parameter that meaningfully shapes the outcome, the two-channel transmission model, the economic model, the banking subsystem, and the design choices that make the scenario hard to "win." It is written so a non-programmer can follow the logic, while the formulas and constants remain precise enough for a technical reader to audit.

---

## Section 3 - Key Parameters

Every constant lives in `config.py`. The ones below are the levers that drive the dynamics - the rest are cosmetic or initial-condition noise.

### Epidemiology

**`BASE_TRANSMISSION_RATE` - `0.045`.** The per-contact daily probability that an infectious agent infects a susceptible one in the workplace setting. Every other transmission probability in the model is derived from this number. It sits between flu (≈0.02) and a high-R0 respiratory virus (≈0.08) so the curve grows fast enough to be alarming but slow enough that policy choices visibly matter. Lower it and the epidemic fizzles regardless of policy; raise it and even level-3 lockdown cannot stop the wave.

**`MARKET_CONTACT_FRACTION` - `0.04`.** In the market setting, each susceptible agent is treated as making contact with a small share of the infectious crowd that day. 0.04 means about 4% of the infectious people present count as effective contacts for any given susceptible - a plausible number for brief, distanced interactions in shops, transit, and public space.

**`MARKET_TRANSMISSION_SCALE` - `0.55`.** Market contacts are shorter, more distanced, and less likely to involve sustained exposure than workplace contacts, so the per-contact probability is scaled by 0.55. Workplace transmission stays the dominant channel; the market is the persistent low-grade leak that keeps R_eff above zero even when offices are quiet.

**`INCUBATION_DAYS` - `5`.** Days between exposure and becoming infectious. This is the "stealth window" in which the epidemic compounds invisibly.

**`ASYMPTOMATIC_INFECTIOUS_DAYS` - `4`.** Asymptomatic carriers transmit for four days before recovering. They never trigger the mortality roll.

**`SYMPTOMATIC_RECOVERY_DAYS` - `10`.** Symptomatic agents are infectious and at mortality risk for ten days, then recover if still alive.

**`ASYMPTOMATIC_RATIO` - `0.40`.** 40% of newly infectious agents take the asymptomatic branch. They survive automatically and keep going to work, which is why a moderate asymptomatic share is one of the most destabilising parameters in the model: it caps how much benefit you can get from telling sick people to stay home.

**`BASE_DAILY_MORTALITY_RATE` - `0.007`.** Each day a symptomatic agent rolls against this probability. Roughly 0.7% per day across a 10-day course gives a case fatality rate near 7% - at the upper end of historical respiratory pandemics, intentionally high enough that "just let it run" is not a comfortable answer.

**`HEALTHCARE_BED_CAPACITY` - `500`.** Beds available for a population of 10,000 (a 5% surge capacity, deliberately tight). Whenever the symptomatic count exceeds this, the system flips into overflow mode.

**`HEALTHCARE_OVERFLOW_MORTALITY_MULTIPLIER` - `2.0`.** When overwhelmed, every symptomatic agent's daily mortality roll is doubled. This is the cliff edge in the curve - once you fall over it, deaths spike and stay elevated until cases drop back below capacity.

**`POVERTY_TRAP_MULTIPLIER` - `3`.** An agent ignores lockdown if their wallet falls below `base_consumption × 3` - roughly three days of buffer. This is the central coupling between the epidemic and the economy: once people run out of money, no policy keeps them home.

**`LOCKDOWN_TRANSMISSION_MULTIPLIER` - `[1.0, 0.7, 0.4, 0.15]`.** Indexed by lockdown level (0–3). Level 0 is no policy. Level 3 is a hard lockdown reducing effective transmission to 15% of baseline. The non-linear spacing reflects that mild restrictions barely move R_eff, while a true lockdown is a step-change.

**`MASK_TRANSMISSION_REDUCTION` - `0.50`.** A mask mandate scales the lockdown multiplier by 0.5. Stacks multiplicatively with lockdown, so masks-plus-level-2 (`0.4 × 0.5 = 0.20`) is nearly as effective as masks-free level 3 - and far cheaper economically.

**`VACCINATIONS_PER_DAY_PER_RATE` - `0.003`.** At the maximum vaccination preset (rate = 1.0), 0.3% of the population is vaccinated per day. A full population takes well over a year at peak rate - so vaccines are a slow, long-game lever, not an emergency brake.

### Economy

**`INITIAL_WALLET_MEAN` - `1,200.0`.** Mean starting cash per agent. With `BASE_CONSUMPTION_MEAN = 55` per day, this is roughly three weeks of buffer before the poverty trap kicks in.

**`DAILY_WAGE` - `80.0`.** Earned per agent per working tick. Wage minus consumption (`80 − 55`) is the daily surplus that lets compliant employed agents accumulate wealth and stay above the poverty trap.

**`BASE_CONSUMPTION_MEAN` - `55.0`.** Minimum daily spend per living agent, sampled per agent at start with std 18, floor 15. This is the constant drag on every wallet - the reason unemployed agents collapse into the poverty trap within a few weeks.

**`PRODUCTIVITY_CONSTANT` - `120.0`.** Revenue generated per active worker per tick before demand scaling. At full demand (`cdi ≈ 1.0`, essential sector) this gives revenue per worker of about 108, slightly above the 80 wage - companies are profitable when their workforce is healthy and demand is intact, and lose money once either condition breaks.

**`DEATH_DEMAND_SUPPRESSION_FACTOR` - `0.00004`.** Each cumulative death suppresses the consumer demand index by this fraction. After 5,000 deaths, demand is suppressed by 20% from grief, fear, and lost consumers - independent of any lockdown. This is the mechanism by which a pure-laissez-faire policy still tanks the economy: the bodies themselves are a demand shock.

### Banking and bankruptcy

**`BANK_INITIAL_RESERVES` - `15,000,000.0` and `BANK_RESERVE_THRESHOLD` - `2,500,000.0`.** The bank starts with $15M and enters crisis mode once reserves fall below $2.5M. The 6× ratio gives a long runway for normal times but means the crisis flips abruptly once distressed companies start drawing loans en masse.

**`FIRING_PROBABILITY` - `0.10` and `BANKRUPTCY_CASH_THRESHOLD` - `−$120,000`.** A struggling, cash-negative company fires 10% of its workforce per tick - fast enough to cascade into mass unemployment within weeks if the demand shock persists. Bankruptcy triggers when cash falls below −$120K *and* the company has already maxed out its loans, so bankruptcy is a terminal condition, not a panic reaction.

---

## Section 4 - The two-setting transmission model

The simulation runs transmission through two completely separate channels every tick - workplace and market - and adds the resulting infections together. They use different math because they model different physical situations.

**Workplace transmission** is local. Agents who are at work share an environment with the other people employed at the same company, and nobody else. For each company we count how many infectious workers showed up that day (`np.bincount` over `company_id` for the infectious-and-at-work mask). For every susceptible worker at the same company, the probability of *not* getting infected that day is `(1 − p_base)^k` where `k` is the number of infectious colleagues. The probability of getting infected is therefore `1 − (1 − p_base)^k`. This compound formula matters: with 5 infectious colleagues the daily probability is around 20%, not 5×; with 20 it saturates near 60%. Big infected companies become outbreak factories; small ones stay clean.

**Market transmission** is a mean-field shortcut. Markets and public spaces don't have a clean group structure - anyone can encounter anyone - so simulating it as a graph would be expensive and add little realism. Instead we count the total number of infectious agents who went out that day, multiply by `MARKET_CONTACT_FRACTION` to get an expected contact count, and apply the same compounding formula with `p_mkt = p_base × MARKET_TRANSMISSION_SCALE`. Every susceptible who went to market faces the same averaged risk that day. This loses the long-tail variance you'd get from a network model but captures the right central tendency at a fraction of the cost.

The two settings are kept separate because their dynamics respond differently to policy. A lockdown reduces *who goes to market* (fewer agents in the susceptible-at-market mask) and reduces transmission probability via the lockdown multiplier; it does not directly close workplaces. Essential workers still report to work even at level 3, so workplace transmission persists even under the strictest lockdown, while market transmission collapses sharply. Splitting the channels is what allows the model to show that "lockdown" is not one knob - it's two effects acting on two different settings, with two different return curves.

The `MARKET_TRANSMISSION_SCALE = 0.55` factor exists because workplace contact is qualitatively different from market contact: eight hours in a shared room versus a few minutes in a queue. The exact value isn't fitted to data - it's chosen so that with default parameters, market transmission is a real but secondary contributor (~25–35% of new exposures in a typical run) rather than dominant or negligible. Move it toward 1.0 and lockdowns lose most of their bite, because the dominant channel goes through markets, which essential demand keeps active. Move it toward 0.2 and the entire epidemic becomes a workplace problem solvable by closing offices. 0.55 keeps both levers meaningful.

---

## Section 5 - The economic model

Every tick, every active worker generates revenue for their company. Revenue per company is `active_workers × PRODUCTIVITY_CONSTANT × demand_index`, where `active_workers` is the count of employed-and-at-work agents from the workplace mask. The two factors that matter are which workers showed up (epidemic and lockdown shape this) and what the demand index looks like (consumer fear and lockdown shape this). The simulation runs both calculations vectorised over all 200 companies in a few NumPy operations.

The **demand index** differs by sector. Essential companies see `ESSENTIAL_DEMAND_BASE × consumer_demand_index` - a flat 0.9 multiplier on the global demand state, independent of lockdown. Non-essential companies see `NON_ESSENTIAL_DEMAND_BASE × consumer_demand_index × max(0, 1 − lockdown_level × 0.22)` - a 0.75 baseline that gets cut by 22% per lockdown level on top of the global demand state. At level 3 lockdown, non-essential demand is multiplied by `max(0, 1 − 0.66) = 0.34`, so non-essential revenue is roughly a third of normal even before any other effect. This is why non-essential firms are the first to go bankrupt under sustained lockdown.

The **consumer demand index** itself is global and feeds both sectors: `cdi = death_suppression × lockdown_factor`, where `death_suppression = max(0.10, 1 − total_deaths × 0.00004)` and `lockdown_factor = max(0.30, 1 − lockdown_level × 0.10)`. Both factors compress: deaths slowly drag the index down toward a 10% floor, and lockdown drops it 10% per level toward a 30% floor. The death term is the closed loop you cannot escape - every death the epidemic produces makes the economy worse, *permanently*, because the dead don't come back to spend. After 10,000 deaths the demand index is held at its 0.10 floor regardless of policy. This is what makes a no-policy run economically catastrophic even though no government order ever cuts demand.

The **poverty trap** is the coupling that makes the whole model interesting. An agent ignores lockdown - both for going to work and for visiting the market - if their wallet drops below `base_consumption × POVERTY_TRAP_MULTIPLIER`. So when revenue drops, companies fire workers, those workers stop earning wages, their wallets drain in a few weeks, and they start breaking lockdown to survive. This pushes them into transmission settings the policy was meant to keep them out of, which spreads the virus into the unemployed population, which suppresses demand further (via deaths), which forces more firings, which traps more agents. The poverty trap is what turns a one-way epidemic-affects-economy relationship into a feedback loop where the economy can spread the epidemic. Every policy decision in the simulation is, at root, a bet about how to break this loop.

---

## Section 6 - The banking system

The banking system is a single central pool tracked by the `Banks` class with one float for total reserves and one for outstanding loans. Companies that are simultaneously *struggling* (active workforce below 50% of payroll) and *cash-negative* request a `BANK_LOAN_AMOUNT` of $50,000 each tick, up to a cap of three concurrent loans per company. The loan is paid out from the bank's reserves and added to the company's cash balance. Each tick, the bank applies interest at the daily rate to every outstanding loan and collects 0.8% of the loan principal back as partial repayment. So a healthy company that takes one loan and holds it pays trivial interest; a sick company that maxes out three loans bleeds cash to interest while its revenue is already broken.

The crisis trigger is `total_reserves < BANK_RESERVE_THRESHOLD` ($2.5M, from a $15M start). Below this, two things change at once: the bank refuses new loans (the credit window closes) and the daily interest rate jumps from 0.0001 (0.01%) to 0.0005 (0.05%). Five times higher. That ratio matters more than the absolute numbers - a company holding $150K of debt now bleeds $75/day in interest instead of $15/day, on top of its revenue collapse. The 5× jump is calibrated to be noticeable on the time-scale of the crisis (days, not months) without being so punitive that it instantly bankrupts every borrower.

The crisis matters because it acts as a **second non-linearity that can outlast the epidemic**. The first non-linearity is the healthcare overflow - when the symptomatic count exceeds 500, mortality doubles. That cliff is acute but transient: once the wave passes, mortality drops back. The bank crisis is different. Once reserves fall below the threshold, they tend to stay there: the only inflow is loan repayments, and during a crisis many borrowers go bankrupt instead of repaying. So the credit door slams shut, struggling companies that would have survived with one more loan tip into bankruptcy, those bankruptcies fire all their workers, those workers fall into the poverty trap, and the unemployment shock outlives the virus by months. A run can show the epidemic curve flat by tick 200 while bankruptcies and unemployment still rise into tick 300+. The banking system is the model's mechanism for making sure the *aftermath* of a badly handled wave is as expensive as the wave itself.

---

## Section 7 - Why the simulation is hard to "win"

Every tool the player has access to costs something elsewhere in the system, and the costs are not independent - they reinforce each other through the poverty trap.

**Lockdown** reduces transmission, but not uniformly. It crashes non-essential demand by up to two-thirds, fires workers in those sectors, drains their wallets, and pushes them into the poverty trap - at which point they ignore the lockdown that was supposed to protect them. Strong lockdown without stimulus is therefore self-defeating: the poorer the population gets, the more compliance erodes, until the only people staying home are the ones who didn't need to. You can buy compliance with stimulus, but stimulus has its own cost.

**Stimulus** raises wallets above the poverty trap threshold, restoring lockdown compliance and keeping demand alive. But every stimulus dollar is added to the national debt, which the model tracks but does not punish during the run - so it is tempting to spend freely. The cost shows up at the end of the run in the score and in the awareness that you traded a public-debt problem for a public-health problem. Stop stimulus mid-crisis and wallets crash within a week; the poverty trap re-engages and the lockdown collapses. Stimulus is therefore a commitment, not a tap you can turn on briefly.

**Doing nothing** seems cheap because it imposes no policy cost. It is in fact the most expensive option in the model's logic, because deaths suppress demand directly through the `DEATH_DEMAND_SUPPRESSION_FACTOR` term. A no-policy run produces a large death toll *and* a large demand collapse - the worst of both outcomes. The economy cannot dodge the epidemic by ignoring it; it can only choose how the cost is split between deaths, debt, and bankruptcies.

The poverty trap is the central mechanic that links the three systems. Without it, the epidemic and the economy would be roughly separable: lockdowns would work as advertised, deaths wouldn't really suppress consumption, and the bank would only matter as a curiosity. With the poverty trap in place, an economic shock leaks back into the epidemic by undermining lockdown compliance, the epidemic leaks back into the economy through firings and demand suppression, and the bank crisis ensures that distress, once it gets going, doesn't unwind cleanly. Every policy is being judged not on its first-order effect but on whether it pulls enough wallets above the poverty line to stop the loop. That is why the simulation has no clean winning strategy - only a least-bad one for any given parameter set.

---

## Section 8 - Limitations and assumptions

The model is intentionally stylised, and several real-world dynamics are absent.

There is **no age stratification**. Every agent has the same daily mortality risk; in reality, most respiratory pandemics show mortality concentrated in older cohorts. Adding age would change the optimal policy mix significantly - protecting the elderly cheaply might dominate a blanket lockdown - but adds a lot of state per agent.

There is **no geographic clustering**. Within a company, mixing is homogeneous; across companies, transmission only happens through the market channel as a mean field. Real outbreaks have spatial structure (households, neighbourhoods, transport networks) that produces super-spreader events and slower, lumpier curves than this model shows.

There is **no testing or contact tracing** as a policy lever. In the model, an asymptomatic infectious agent goes to work for four days and there is nothing the player can do to identify them. A test-and-trace policy would functionally cut the asymptomatic transmission window and could be a decisive lever; its absence is one reason the simulation tilts toward expensive blunt instruments like lockdowns.

There is **no reinfection and no waning immunity**. Recovered agents are permanently immune; vaccinated agents are permanently protected. Real pandemics have variant waves, immune escape, and seasonal returns. The model is a single-wave story by design.

**Workplace mixing is homogeneous within a company.** Every employee is treated as having equal contact with every other employee. In reality, an office has departments, shifts, break rooms - clusters within clusters. The bincount-and-compound-probability formula captures the size effect (big companies have more outbreaks) but not the within-company structure.

**Companies don't change size or merge.** Bankrupt firms vanish and their workers go on the unemployed pool, but no new firms form to absorb the slack. Re-employment by surviving firms is the only path back to work. Long, deep recessions in the model therefore reflect the absence of firm formation as much as anything genuinely modelled.

The parameters are calibrated for **plausible dynamics, not fit to real-world data**. The transmission rate, mortality rate, healthcare capacity, and economic constants were chosen to produce recognisable epidemic and recession curves under realistic policy choices, and to make every policy lever matter. They are not estimates of any specific virus or any specific economy. Treat the simulation as a controlled environment for reasoning about policy trade-offs, not as a forecast.
