"""
dashboard.py  —  Tkinter visual dashboard for the pandemic simulation.

No extra installs needed. Tkinter ships with Python.

Run via:
    python main.py          (launches this automatically)
    python dashboard.py     (direct)
"""

from __future__ import annotations

import threading
import tkinter as tk
from tkinter import ttk, font as tkfont
import math
from typing import Optional

from config import CONFIG
from entities import Government
from simulation import SimulationEngine


# ── Palette ──────────────────────────────────────────────────────────────────
BG       = "#f5f4f0"   # window background
SURFACE  = "#ffffff"   # card / panel background
BORDER   = "#e0ddd6"
TEXT     = "#1a1a1a"
MUTED    = "#888888"
ACCENT   = "#3a5a9b"   # blue

C_SUSC   = "#b0aaa0"
C_EXPO   = "#e8a020"
C_ASYMP  = "#e07040"
C_SYMP   = "#c83030"
C_RECOV  = "#3a9a6a"

COL_OK   = "#2d8a50"
COL_WARN = "#d08020"
COL_BAD  = "#c83030"


# ── Tiny canvas chart ─────────────────────────────────────────────────────────

class LineChart(tk.Canvas):
    """
    A lightweight canvas-based line chart.  No matplotlib dependency.
    Supports multiple series, auto-scaling Y, and a shaded area fill
    for the first series.
    """

    PAD_L = 52
    PAD_R = 12
    PAD_T = 10
    PAD_B = 28

    def __init__(self, parent, title: str, series: list[dict], **kwargs):
        super().__init__(parent, bg=SURFACE, highlightthickness=0, **kwargs)
        self.title   = title
        self.series  = series   # list of {"label": str, "color": str, "data": []}
        self.bind("<Configure>", lambda e: self.redraw())

    def redraw(self):
        self.delete("all")
        w = self.winfo_width()
        h = self.winfo_height()
        if w < 10 or h < 10:
            return

        pl, pr, pt, pb = self.PAD_L, self.PAD_R, self.PAD_T, self.PAD_B
        cw = w - pl - pr
        ch = h - pt - pb

        # Title
        self.create_text(pl, 4, anchor="nw", text=self.title,
                         fill=MUTED, font=("Helvetica", 8, "bold"))

        # Gather all data
        all_data = [v for s in self.series for v in s["data"]]
        n = max(len(s["data"]) for s in self.series) if self.series else 0
        if n == 0 or not all_data:
            self.create_text(w//2, h//2, text="No data yet", fill=MUTED, font=("Helvetica", 9))
            return

        y_min = 0
        y_max = max(all_data) * 1.08 or 1
        x_max = n - 1

        def px(i):
            return pl + (i / max(x_max, 1)) * cw

        def py(v):
            return pt + ch - ((v - y_min) / (y_max - y_min)) * ch

        # Grid lines + Y labels
        n_grid = 4
        for gi in range(n_grid + 1):
            yv   = y_min + (y_max - y_min) * gi / n_grid
            ypos = py(yv)
            self.create_line(pl, ypos, w - pr, ypos, fill=BORDER, dash=(2, 3))
            label = _fmt_num(yv)
            self.create_text(pl - 4, ypos, anchor="e", text=label,
                             fill=MUTED, font=("Helvetica", 7))

        # X labels (day numbers)
        tick_every = max(1, n // 6)
        for i in range(0, n, tick_every):
            self.create_text(px(i), h - pb + 5, anchor="n",
                             text=str(i), fill=MUTED, font=("Helvetica", 7))

        # Axes
        self.create_line(pl, pt, pl, h - pb, fill=BORDER)
        self.create_line(pl, h - pb, w - pr, h - pb, fill=BORDER)

        # Series (draw fill first, then lines on top)
        for si, s in enumerate(self.series):
            data = s["data"]
            color = s["color"]
            if len(data) < 2:
                continue
            pts = [(px(i), py(v)) for i, v in enumerate(data)]

            # Shaded fill for first series only
            if si == 0:
                poly = [pl, h - pb]
                for x, y in pts:
                    poly += [x, y]
                poly += [px(len(data) - 1), h - pb]
                # lighten color
                self.create_polygon(poly, fill=_lighten(color), outline="")

            # Line
            flat = [coord for pt in pts for coord in pt]
            self.create_line(*flat, fill=color, width=2, smooth=True)

    def set_data(self, series_index: int, data: list):
        self.series[series_index]["data"] = data
        self.redraw()

    def set_all(self, data_list: list[list]):
        for i, d in enumerate(data_list):
            self.series[i]["data"] = d
        self.redraw()


def _fmt_num(v: float) -> str:
    if v >= 1_000_000:
        return f"{v/1_000_000:.1f}M"
    if v >= 1_000:
        return f"{v/1_000:.0f}k"
    return f"{v:.0f}"


def _lighten(hex_color: str, alpha: float = 0.15) -> str:
    """Blend a hex color toward white at the given alpha."""
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    r = int(r + (255 - r) * (1 - alpha))
    g = int(g + (255 - g) * (1 - alpha))
    b = int(b + (255 - b) * (1 - alpha))
    return f"#{r:02x}{g:02x}{b:02x}"


# ── KPI tile ──────────────────────────────────────────────────────────────────

class KpiTile(tk.Frame):
    def __init__(self, parent, label: str, **kwargs):
        super().__init__(parent, bg=SURFACE, **kwargs)
        self._label_text = label
        tk.Label(self, text=label.upper(), bg=SURFACE, fg=MUTED,
                 font=("Helvetica", 8, "bold")).pack(anchor="w", padx=12, pady=(10, 0))
        self._val  = tk.Label(self, text="—", bg=SURFACE, fg=TEXT, font=("Helvetica", 22, "bold"))
        self._val.pack(anchor="w", padx=12)
        self._sub  = tk.Label(self, text="", bg=SURFACE, fg=MUTED, font=("Helvetica", 9))
        self._sub.pack(anchor="w", padx=12, pady=(0, 10))

    def update(self, val: str, sub: str = "", status: str = ""):
        color = {"bad": COL_BAD, "warn": COL_WARN, "good": COL_OK}.get(status, TEXT)
        self._val.config(text=val, fg=color)
        self._sub.config(text=sub)


# ── Policy widgets ────────────────────────────────────────────────────────────

class LockdownPicker(tk.Frame):
    LABELS = ["None", "Light", "Moderate", "Full"]
    COLORS = [ACCENT, "#b06a10", "#b04010", COL_BAD]

    def __init__(self, parent, on_change, **kwargs):
        super().__init__(parent, bg=SURFACE, **kwargs)
        self._on_change = on_change
        self._level = 0
        self._btns  = []
        for i, lbl in enumerate(self.LABELS):
            b = tk.Button(self, text=lbl, relief="flat", bd=0,
                          font=("Helvetica", 9, "bold"),
                          cursor="hand2", padx=6, pady=4,
                          command=lambda n=i: self._pick(n))
            b.grid(row=0, column=i, padx=2, pady=0)
            self._btns.append(b)
        self._refresh()

    def _pick(self, n):
        self._level = n
        self._on_change(n)
        self._refresh()

    def _refresh(self):
        for i, b in enumerate(self._btns):
            if i == self._level:
                b.config(bg=self.COLORS[i], fg="white")
            else:
                b.config(bg=BORDER, fg=MUTED)

    def get(self):
        return self._level


# ── Main dashboard window ────────────────────────────────────────────────────

class Dashboard(tk.Tk):

    TICK_MS   = 120   # ms between ticks at 1× speed
    SPEED_MAP = {"0.5×": 240, "1×": 120, "3×": 40, "10×": 8}

    def __init__(self):
        super().__init__()
        self.title("Pandemic Simulation")
        self.configure(bg=BG)
        self.geometry("1180x700")
        self.minsize(900, 580)

        self._gov: Optional[Government]        = None
        self._sim: Optional[SimulationEngine]  = None
        self._running  = False
        self._tick_ms  = self.TICK_MS
        self._after_id = None
        self._lock     = threading.Lock()

        self._build_ui()
        self._new_sim()

    # ── UI construction ───────────────────────────────────────────────────────

    def _build_ui(self):
        # ── Sidebar ──
        sidebar = tk.Frame(self, bg=SURFACE, width=230)
        sidebar.pack(side="left", fill="y")
        sidebar.pack_propagate(False)

        # Separator line
        tk.Frame(self, bg=BORDER, width=1).pack(side="left", fill="y")

        # ── Main area ──
        main = tk.Frame(self, bg=BG)
        main.pack(side="left", fill="both", expand=True)

        self._build_sidebar(sidebar)
        self._build_main(main)

    def _build_sidebar(self, parent):
        pad = dict(padx=16, pady=0)

        # Brand
        tk.Label(parent, text="Pandemic Sim", bg=SURFACE, fg=TEXT,
                 font=("Helvetica", 13, "bold")).pack(anchor="w", padx=16, pady=(16, 0))
        tk.Label(parent, text="10,000 agents · 200 companies", bg=SURFACE, fg=MUTED,
                 font=("Helvetica", 9)).pack(anchor="w", padx=16, pady=(0, 16))

        tk.Frame(parent, bg=BORDER, height=1).pack(fill="x")

        def section(text):
            tk.Label(parent, text=text, bg=SURFACE, fg=MUTED,
                     font=("Helvetica", 8, "bold")).pack(anchor="w", padx=16, pady=(14, 4))

        # ── Lockdown ──
        section("LOCKDOWN LEVEL")
        self._lockdown = LockdownPicker(parent, self._on_lockdown)
        self._lockdown.pack(anchor="w", padx=16, pady=(0, 4))
        self._lock_hint = tk.Label(parent, text="No restrictions. Virus spreads freely.",
                                   bg=SURFACE, fg=MUTED, font=("Helvetica", 8),
                                   wraplength=200, justify="left")
        self._lock_hint.pack(anchor="w", padx=16, pady=(0, 4))

        tk.Frame(parent, bg=BORDER, height=1).pack(fill="x", pady=4)

        # ── Mask ──
        section("MASK MANDATE  (−50% spread)")
        mask_row = tk.Frame(parent, bg=SURFACE)
        mask_row.pack(anchor="w", padx=16)
        self._mask_var = tk.BooleanVar(value=False)
        self._mask_btn = tk.Checkbutton(mask_row, variable=self._mask_var, bg=SURFACE,
                                        activebackground=SURFACE, command=self._on_mask,
                                        relief="flat", cursor="hand2")
        self._mask_btn.pack(side="left")
        tk.Label(mask_row, text="Enable", bg=SURFACE, fg=TEXT,
                 font=("Helvetica", 10)).pack(side="left")

        tk.Frame(parent, bg=BORDER, height=1).pack(fill="x", pady=8)

        # ── Vaccination ──
        section("VACCINATION ROLLOUT")
        self._vacc_var = tk.IntVar(value=0)
        self._vacc_lbl = tk.Label(parent, text="Off", bg=SURFACE, fg=ACCENT,
                                  font=("Helvetica", 10, "bold"))
        self._vacc_lbl.pack(anchor="w", padx=16)
        tk.Scale(parent, from_=0, to=100, orient="horizontal", variable=self._vacc_var,
                 bg=SURFACE, fg=TEXT, troughcolor=BORDER, highlightthickness=0,
                 showvalue=False, command=self._on_vacc,
                 length=196, sliderlength=14, width=8).pack(padx=16)

        tk.Frame(parent, bg=BORDER, height=1).pack(fill="x", pady=4)

        # ── Stimulus ──
        section("DAILY STIMULUS (to poor agents)")
        self._stim_var = tk.IntVar(value=0)
        self._stim_lbl = tk.Label(parent, text="$0", bg=SURFACE, fg=ACCENT,
                                  font=("Helvetica", 10, "bold"))
        self._stim_lbl.pack(anchor="w", padx=16)
        tk.Scale(parent, from_=0, to=300, orient="horizontal", variable=self._stim_var,
                 bg=SURFACE, fg=TEXT, troughcolor=BORDER, highlightthickness=0,
                 showvalue=False, command=self._on_stim,
                 length=196, sliderlength=14, width=8).pack(padx=16)

        tk.Frame(parent, bg=BORDER, height=1).pack(fill="x", pady=8)

        # ── Speed ──
        section("SPEED")
        speed_row = tk.Frame(parent, bg=SURFACE)
        speed_row.pack(anchor="w", padx=16)
        self._speed_btns = {}
        for label in self.SPEED_MAP:
            b = tk.Button(speed_row, text=label, relief="flat", bd=0,
                          font=("Helvetica", 9), cursor="hand2", padx=6, pady=3,
                          command=lambda l=label: self._on_speed(l))
            b.pack(side="left", padx=2)
            self._speed_btns[label] = b
        self._on_speed("1×")

        tk.Frame(parent, bg=BORDER, height=1).pack(fill="x", pady=8)

        # ── Run / Reset ──
        self._run_btn = tk.Button(parent, text="▶  Run", bg=ACCENT, fg="white",
                                  relief="flat", bd=0, font=("Helvetica", 11, "bold"),
                                  cursor="hand2", pady=8, command=self._on_run)
        self._run_btn.pack(fill="x", padx=16, pady=(0, 6))

        tk.Button(parent, text="↺  Reset", bg=BORDER, fg=MUTED,
                  relief="flat", bd=0, font=("Helvetica", 9), cursor="hand2",
                  pady=6, command=self._on_reset).pack(fill="x", padx=16)

        # ── Legend ──
        tk.Frame(parent, bg=BORDER, height=1).pack(fill="x", pady=10)
        section("CHART COLOURS")
        for color, label in [
            (C_SUSC,  "Susceptible"),
            (C_EXPO,  "Exposed (incubating)"),
            (C_ASYMP, "Infectious · no symptoms"),
            (C_SYMP,  "Infectious · symptomatic"),
            (C_RECOV, "Recovered"),
        ]:
            row = tk.Frame(parent, bg=SURFACE)
            row.pack(anchor="w", padx=16, pady=1)
            tk.Label(row, text="■", fg=color, bg=SURFACE,
                     font=("Helvetica", 10)).pack(side="left")
            tk.Label(row, text=label, fg=MUTED, bg=SURFACE,
                     font=("Helvetica", 9)).pack(side="left", padx=4)

    def _build_main(self, parent):
        # ── KPI strip ──
        kpi_bar = tk.Frame(parent, bg=SURFACE)
        kpi_bar.pack(fill="x")
        tk.Frame(parent, bg=BORDER, height=1).pack(fill="x")

        self._kpis = {}
        kpi_defs = [
            ("cases",     "Active Cases"),
            ("dead",      "Deaths"),
            ("hospital",  "Hospital"),
            ("unemp",     "Unemployment"),
            ("bankrupt",  "Bankrupt Firms"),
        ]
        for i, (key, label) in enumerate(kpi_defs):
            tile = KpiTile(kpi_bar, label)
            tile.pack(side="left", fill="both", expand=True)
            if i < len(kpi_defs) - 1:
                tk.Frame(kpi_bar, bg=BORDER, width=1).pack(side="left", fill="y")
            self._kpis[key] = tile

        # ── HC overwhelmed banner ──
        self._hc_banner = tk.Label(parent,
            text="⚕  Hospital overwhelmed — mortality rate doubled",
            bg="#fde8e8", fg=COL_BAD, font=("Helvetica", 10, "bold"), pady=5)
        # Not packed yet — shown on demand

        # ── Charts 2×2 ──
        charts_frame = tk.Frame(parent, bg=BG)
        charts_frame.pack(fill="both", expand=True)
        charts_frame.columnconfigure(0, weight=1)
        charts_frame.columnconfigure(1, weight=1)
        charts_frame.rowconfigure(0, weight=1)
        charts_frame.rowconfigure(1, weight=1)

        self._charts = {}

        # Epidemic
        self._charts["epi"] = LineChart(
            charts_frame, title="WHO'S INFECTED?",
            series=[
                {"label": "Susceptible",  "color": C_SUSC,  "data": []},
                {"label": "Exposed",      "color": C_EXPO,  "data": []},
                {"label": "Asymptomatic", "color": C_ASYMP, "data": []},
                {"label": "Symptomatic",  "color": C_SYMP,  "data": []},
                {"label": "Recovered",    "color": C_RECOV, "data": []},
            ]
        )
        self._charts["epi"].grid(row=0, column=0, sticky="nsew",
                                  padx=(0,1), pady=(0,1))

        # Economy — GDP only (simple, readable)
        self._charts["gdp"] = LineChart(
            charts_frame, title="DAILY GDP",
            series=[{"label": "GDP", "color": ACCENT, "data": []}]
        )
        self._charts["gdp"].grid(row=0, column=1, sticky="nsew",
                                  padx=(1,0), pady=(0,1))

        # Hospital
        self._charts["hc"] = LineChart(
            charts_frame, title="HOSPITAL PRESSURE  (% of 500 beds)",
            series=[{"label": "Occupancy %", "color": C_SYMP, "data": []}]
        )
        self._charts["hc"].grid(row=1, column=0, sticky="nsew",
                                 padx=(0,1), pady=(1,0))

        # Wallets
        self._charts["wallet"] = LineChart(
            charts_frame, title="AGENT WEALTH  (mean wallet $)",
            series=[{"label": "Mean wallet", "color": C_RECOV, "data": []}]
        )
        self._charts["wallet"].grid(row=1, column=1, sticky="nsew",
                                     padx=(1,0), pady=(1,0))

        # ── Status bar ──
        tk.Frame(parent, bg=BORDER, height=1).pack(fill="x")
        status_bar = tk.Frame(parent, bg=SURFACE)
        status_bar.pack(fill="x")
        self._status_lbl = tk.Label(status_bar, text="Ready — press Run to start.",
                                     bg=SURFACE, fg=MUTED, font=("Helvetica", 9),
                                     anchor="w")
        self._status_lbl.pack(side="left", padx=12, pady=6)
        self._day_lbl = tk.Label(status_bar, text="Day 0",
                                  bg=SURFACE, fg=TEXT, font=("Helvetica", 9, "bold"))
        self._day_lbl.pack(side="right", padx=12, pady=6)

    # ── Simulation lifecycle ──────────────────────────────────────────────────

    def _new_sim(self):
        self._gov = Government()
        self._sim = SimulationEngine(government=self._gov,
                                     seed=CONFIG["RANDOM_SEED"])
        self._apply_current_policy()

    def _apply_current_policy(self):
        if self._gov is None:
            return
        self._gov.set_lockdown(self._lockdown.get())
        self._gov.set_mask_mandate(self._mask_var.get())
        self._gov.set_vaccination_rate(self._vacc_var.get() / 100)
        self._gov.set_stimulus(float(self._stim_var.get()))

    def _tick_and_schedule(self):
        """Run one simulation tick then schedule the next."""
        if not self._running:
            return
        with self._lock:
            self._sim.tick()
        self._update_ui()
        # Check for natural end
        last = self._sim.records[-1] if self._sim.records else None
        if last:
            alive = last["infectious_asymptomatic"] + last["infectious_symptomatic"] + last["exposed"]
            if (alive == 0 and self._sim.tick_num > 30) or self._sim.tick_num >= CONFIG["NUM_TICKS"]:
                self._running = False
                self._run_btn.config(text="▶  Run", bg=ACCENT)
                self._set_status("Simulation ended.")
                return
        self._after_id = self.after(self._tick_ms, self._tick_and_schedule)

    # ── UI update ─────────────────────────────────────────────────────────────

    def _update_ui(self):
        records = self._sim.records
        if not records:
            return

        last = records[-1]

        # Charts — slice to last 365 points
        R = records[-365:]

        self._charts["epi"].set_all([
            [r["susceptible"]             for r in R],
            [r["exposed"]                 for r in R],
            [r["infectious_asymptomatic"] for r in R],
            [r["infectious_symptomatic"]  for r in R],
            [r["recovered"]               for r in R],
        ])
        self._charts["gdp"].set_all([[r["gdp"] for r in R]])
        self._charts["hc"].set_all(
            [[r["healthcare_patients"] / max(1, r["healthcare_capacity"]) * 100 for r in R]]
        )
        self._charts["wallet"].set_all([[r["mean_wallet"] for r in R]])

        # KPIs
        active = last["infectious_asymptomatic"] + last["infectious_symptomatic"]
        self._kpis["cases"].update(
            f"{active:,}",
            f"{last['infectious_symptomatic']:,} symptomatic",
            "bad" if active > 1000 else "warn" if active > 200 else ""
        )
        self._kpis["dead"].update(
            f"{last['dead']:,}", "total deaths",
            "bad" if last["dead"] > 200 else "warn" if last["dead"] > 50 else ""
        )
        hc_pct = round(last["healthcare_patients"] / max(1, last["healthcare_capacity"]) * 100)
        self._kpis["hospital"].update(
            f"{hc_pct}%", "of 500 beds used",
            "bad" if last["healthcare_overwhelmed"] else "warn" if hc_pct > 70 else "good"
        )
        self._kpis["unemp"].update(
            f"{last['unemployment_rate_pct']:.1f}%", "of alive population",
            "bad" if last["unemployment_rate_pct"] > 25 else "warn" if last["unemployment_rate_pct"] > 10 else ""
        )
        self._kpis["bankrupt"].update(
            str(last["companies_bankrupt"]), "of 200 companies",
            "bad" if last["companies_bankrupt"] > 30 else "warn" if last["companies_bankrupt"] > 10 else ""
        )

        # Day counter
        self._day_lbl.config(text=f"Day {self._sim.tick_num}")

        # HC banner
        if last["healthcare_overwhelmed"]:
            self._hc_banner.pack(fill="x", before=self._hc_banner.master.winfo_children()[0]
                                  if self._hc_banner.master.winfo_children() else None)
        else:
            self._hc_banner.pack_forget()

        # Status message
        msgs = []
        if last["healthcare_overwhelmed"]:
            msgs.append("Hospital overwhelmed — deaths rising")
        if last["companies_bankrupt"] > 20:
            msgs.append(f"{last['companies_bankrupt']} firms bankrupt")
        if last["unemployment_rate_pct"] > 20:
            msgs.append(f"unemployment {last['unemployment_rate_pct']:.0f}%")
        if last["bank_in_crisis"]:
            msgs.append("banking crisis")
        self._set_status("⚠  " + " · ".join(msgs) if msgs else f"Day {self._sim.tick_num} running…")

    def _set_status(self, msg: str):
        self._status_lbl.config(text=msg)

    # ── Policy callbacks ──────────────────────────────────────────────────────

    LOCK_HINTS = [
        "No restrictions. Virus spreads freely.",
        "Light restrictions. Some workers stay home.",
        "Moderate lockdown. Only essential workers outside.",
        "Full lockdown. Only the poorest break the rules.",
    ]

    def _on_lockdown(self, level: int):
        if self._gov:
            self._gov.set_lockdown(level)
        self._lock_hint.config(text=self.LOCK_HINTS[level])

    def _on_mask(self):
        if self._gov:
            self._gov.set_mask_mandate(self._mask_var.get())

    def _on_vacc(self, val):
        v = int(float(val))
        self._vacc_lbl.config(text="Off" if v == 0 else f"{v}%")
        if self._gov:
            self._gov.set_vaccination_rate(v / 100)

    def _on_stim(self, val):
        v = int(float(val))
        self._stim_lbl.config(text=f"${v}")
        if self._gov:
            self._gov.set_stimulus(float(v))

    def _on_speed(self, label: str):
        self._tick_ms = self.SPEED_MAP[label]
        for lbl, btn in self._speed_btns.items():
            btn.config(bg=ACCENT if lbl == label else BORDER,
                       fg="white" if lbl == label else MUTED)

    def _on_run(self):
        if self._running:
            # Pause
            self._running = False
            if self._after_id:
                self.after_cancel(self._after_id)
            self._run_btn.config(text="▶  Run", bg=ACCENT)
            self._set_status("Paused — change policies and press Run to continue.")
        else:
            # Start / resume
            self._running = True
            self._run_btn.config(text="⏸  Pause", bg="#555555")
            self._tick_and_schedule()

    def _on_reset(self):
        self._running = False
        if self._after_id:
            self.after_cancel(self._after_id)
        self._new_sim()
        self._run_btn.config(text="▶  Run", bg=ACCENT)
        # Clear charts
        for c in self._charts.values():
            for s in c.series:
                s["data"] = []
            c.redraw()
        # Reset KPIs
        for tile in self._kpis.values():
            tile.update("—", "")
        self._day_lbl.config(text="Day 0")
        self._hc_banner.pack_forget()
        self._set_status("Reset — press Run to start a new simulation.")


# ── Entry point ───────────────────────────────────────────────────────────────

def run():
    app = Dashboard()
    app.mainloop()


if __name__ == "__main__":
    run()
