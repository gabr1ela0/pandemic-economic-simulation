#!/usr/bin/env python3
"""
Entry point.

Default → opens the browser game-style dashboard.
Batch   → headless CSV run, no window.

Usage
-----
    python main.py                          # visual dashboard
    python main.py --batch --ticks 180      # headless batch run
    python main.py --batch --lockdown 2 --mask --ticks 90
    python main.py --batch --stimulus 100 --vacc 0.5 --ticks 365 --output run1.csv
"""

from __future__ import annotations

import argparse
from config import CONFIG


# ── Batch mode (unchanged from original) ─────────────────────────────────────

BANNER = r"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                         PANDEMIC & ECONOMIC SIMULATION                       ║
║                                                                              ║
║          Agents: {:>6,}   Companies: {:>3}   Beds: {:>4}   Seed: {:>6}         ║
╚══════════════════════════════════════════════════════════════════════════════╝
""".format(
    CONFIG["NUM_AGENTS"],
    CONFIG["NUM_COMPANIES"],
    CONFIG["HEALTHCARE_BED_CAPACITY"],
    CONFIG["RANDOM_SEED"],
)


def batch_mode(args: argparse.Namespace) -> None:
    from entities import Government
    from simulation import SimulationEngine

    gov = Government()
    gov.set_lockdown(args.lockdown)
    gov.set_mask_mandate(args.mask)
    gov.set_stimulus(args.stimulus)
    gov.set_vaccination_rate(args.vacc)

    sim = SimulationEngine(government=gov, seed=args.seed)

    print(BANNER)
    print(
        f"Batch run: {args.ticks} days | "
        f"lockdown={args.lockdown} | mask={'on' if args.mask else 'off'} | "
        f"stimulus={args.stimulus} | vacc={args.vacc}\n"
    )
    df = sim.run(ticks=args.ticks, verbose=not args.quiet)

    out = args.output or CONFIG["OUTPUT_FILE"]
    df.to_csv(out, index=False)
    print(f"\nResults saved → '{out}'  ({len(df)} rows × {len(df.columns)} columns)")

    print("\n── FINAL SUMMARY ─────────────────────────────────────────────")
    last = df.iloc[-1]
    print(f"  Total dead           : {int(last['dead']):,}")
    print(f"  Peak symptomatic     : {int(df['infectious_symptomatic'].max()):,}")
    print(f"  Peak HC overwhelmed  : {'Yes' if df['healthcare_overwhelmed'].any() else 'No'}")
    print(f"  Final unemployment   : {last['unemployment_rate_pct']:.1f}%")
    print(f"  National debt        : ${last['national_debt']:,.0f}")
    print(f"  Companies bankrupt   : {int(last['companies_bankrupt'])}")
    print(f"  Mean agent wallet    : ${last['mean_wallet']:,.2f}")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Pandemic & Economic Agent-Based Simulation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python main.py                              # visual dashboard (default)
  python main.py --batch --ticks 180          # headless batch run
  python main.py --batch --lockdown 2 --mask --ticks 90
  python main.py --batch --stimulus 100 --vacc 0.5 --ticks 365
  python main.py --batch --lockdown 0 --ticks 365 --output no_lockdown.csv
        """,
    )
    parser.add_argument(
        "--batch", action="store_true",
        help="Headless run: no window, just CSV output",
    )
    parser.add_argument(
        "--ticks", type=int, default=CONFIG["NUM_TICKS"],
        help="Number of days for batch mode (default: %(default)s)",
    )
    parser.add_argument("--lockdown", type=int, default=0, choices=[0, 1, 2, 3])
    parser.add_argument("--mask",     action="store_true")
    parser.add_argument("--stimulus", type=float, default=0.0)
    parser.add_argument("--vacc",     type=float, default=0.0)
    parser.add_argument("--seed",     type=int,   default=CONFIG["RANDOM_SEED"])
    parser.add_argument("--output",   type=str,   default=None)
    parser.add_argument("--quiet",    action="store_true")

    args = parser.parse_args()

    if args.batch:
        batch_mode(args)
    else:
        try:
            from dashboard import run
        except ModuleNotFoundError as exc:
            if exc.name == "_tkinter":
                raise SystemExit(
                    "Tkinter is missing in your Python build, so the dashboard cannot start.\n"
                    "Install it (Homebrew): brew install python-tk@3.13\n"
                    "Then run either:\n"
                    "  python main.py            # dashboard mode\n"
                    "  python main.py --batch    # headless mode"
                ) from exc
            raise
        run()


if __name__ == "__main__":
    main()
