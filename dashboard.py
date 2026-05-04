"""
dashboard.py  —  Clean Tkinter dashboard for the pandemic simulation.

No extra installs needed. Tkinter ships with Python.

Run via:
    python main.py
    python dashboard.py
"""

from __future__ import annotations

import threading
import tkinter as tk
from typing import Optional

from config import CONFIG
from entities import Government
from simulation import SimulationEngine


# ── Simple Dark Palette ───────────────────────────────────────────────────────
BG        = "#1e1e1e"
SURFACE   = "#2d2d2d"
BORDER    = "#444444"
TEXT      = "#ffffff"
TEXT_DIM  = "#888888"
ACCENT    = "#4fc3f7"
GREEN     = "#66bb6a"
YELLOW    = "#ffca28"
RED       = "#ef5350"

# Chart colors
C_GRAY    = "#9e9e9e"
C_YELLOW  = "#ffca28"
C_ORANGE  = "#ffa726"
C_RED     = "#ef5350"
C_GREEN   = "#66bb6a"


class LineChart(tk.Canvas):
    """Simple line chart without overlapping text."""

    def __init__(self, parent, title: str, series: list[dict], **kwargs):
        super().__init__(parent, bg=SURFACE, highlightthickness=1, highlightbackground=BORDER, **kwargs)
        self.title = title
        self.series = series
        self.bind("<Configure>", lambda e: self.redraw())

    def redraw(self):
        self.delete("all")
        w = self.winfo_width()
        h = self.winfo_height()
        if w < 50 or h < 50:
            return

        pad_l, pad_r, pad_t, pad_b = 55, 15, 30, 30
        cw = w - pad_l - pad_r
        ch = h - pad_t - pad_b

        # Title only (no legend in chart area)
        self.create_text(10, 10, anchor="nw", text=self.title, fill=ACCENT, font=("Arial", 11, "bold"))

        # Get data
        all_data = [v for s in self.series for v in s["data"]]
        n = max((len(s["data"]) for s in self.series), default=0)

        if n == 0 or not all_data:
            self.create_text(w // 2, h // 2, text="No data", fill=TEXT_DIM, font=("Arial", 11))
            return

        y_max = max(all_data) * 1.1 or 1
        x_max = max(1, n - 1)

        def px(i): return pad_l + (i / x_max) * cw
        def py(v): return pad_t + ch - (v / y_max) * ch

        # Y axis labels (4 lines)
        for i in range(5):
            yv = y_max * i / 4
            ypos = py(yv)
            self.create_line(pad_l, ypos, w - pad_r, ypos, fill="#3a3a3a", dash=(2, 4))
            self.create_text(pad_l - 5, ypos, anchor="e", text=self._fmt(yv), fill=TEXT_DIM, font=("Arial", 9))

        # X axis labels
        step = max(1, n // 5)
        for i in range(0, n, step):
            self.create_text(px(i), h - pad_b + 12, text=str(i), fill=TEXT_DIM, font=("Arial", 9))

        # Draw lines
        for s in self.series:
            data = s["data"]
            if len(data) < 2:
                continue
            pts = []
            for i, v in enumerate(data):
                pts.extend([px(i), py(v)])
            self.create_line(*pts, fill=s["color"], width=2, smooth=True)

    def _fmt(self, v):
        if v >= 1_000_000:
            return f"{v/1e6:.1f}M"
        if v >= 1_000:
            return f"{v/1e3:.0f}k"
        return f"{v:.0f}"

    def set_all(self, data_list):
        for i, d in enumerate(data_list):
            if i < len(self.series):
                self.series[i]["data"] = d
        self.redraw()


class KpiTile(tk.Frame):
    def __init__(self, parent, label: str):
        super().__init__(parent, bg=SURFACE, padx=10, pady=8)
        self.configure(highlightbackground=BORDER, highlightthickness=1)

        tk.Label(self, text=label, bg=SURFACE, fg=ACCENT, font=("Arial", 9, "bold")).pack(anchor="w")
        self._val = tk.Label(self, text="—", bg=SURFACE, fg=TEXT, font=("Arial", 22, "bold"))
        self._val.pack(anchor="w")
        self._sub = tk.Label(self, text="", bg=SURFACE, fg=TEXT_DIM, font=("Arial", 9))
        self._sub.pack(anchor="w")

    def update(self, val: str, sub: str = "", status: str = ""):
        color = {"bad": RED, "warn": YELLOW, "good": GREEN}.get(status, TEXT)
        self._val.config(text=val, fg=color)
        self._sub.config(text=sub)


class LockdownPicker(tk.Frame):
    LABELS = ["None", "Light", "Mod", "Full"]

    def __init__(self, parent, on_change):
        super().__init__(parent, bg=SURFACE)
        self._on_change = on_change
        self._level = 0
        self._btns = []

        for i, lbl in enumerate(self.LABELS):
            b = tk.Button(
                self, text=lbl, width=5, relief="flat",
                font=("Arial", 10, "bold"), pady=5,
                command=lambda n=i: self._pick(n)
            )
            b.pack(side="left", padx=2)
            self._btns.append(b)
        self._refresh()

    def _pick(self, n):
        self._level = n
        self._on_change(n)
        self._refresh()

    def _refresh(self):
        colors = [GREEN, YELLOW, C_ORANGE, RED]
        for i, b in enumerate(self._btns):
            if i == self._level:
                b.config(bg=colors[i], fg="#000000")
            else:
                b.config(bg="#444444", fg=TEXT_DIM)

    def get(self):
        return self._level


class Dashboard(tk.Tk):
    SPEEDS = {"0.25x": 400, "0.5x": 200, "1x": 100, "2x": 50, "5x": 20}

    def __init__(self):
        super().__init__()
        self.title("Outbreak Command")
        self.configure(bg=BG)
        self.geometry("1200x750")
        self.minsize(900, 600)

        self._gov = None
        self._sim = None
        self._running = False
        self._tick_ms = 100
        self._after_id = None
        self._lock = threading.Lock()

        self._build_ui()
        self._new_sim()

    def _build_ui(self):
        # Sidebar
        sidebar = tk.Frame(self, bg=SURFACE, width=220)
        sidebar.pack(side="left", fill="y")
        sidebar.pack_propagate(False)

        # Main
        main = tk.Frame(self, bg=BG)
        main.pack(side="left", fill="both", expand=True)

        self._build_sidebar(sidebar)
        self._build_main(main)

    def _build_sidebar(self, parent):
        # Title
        tk.Label(parent, text="OUTBREAK", bg=SURFACE, fg=ACCENT, font=("Arial", 16, "bold")).pack(pady=(15, 0))
        tk.Label(parent, text="Command Center", bg=SURFACE, fg=TEXT_DIM, font=("Arial", 10)).pack()
        tk.Frame(parent, bg=BORDER, height=1).pack(fill="x", pady=10)

        # Lockdown
        tk.Label(parent, text="LOCKDOWN", bg=SURFACE, fg=ACCENT, font=("Arial", 10, "bold")).pack(anchor="w", padx=10)
        self._lockdown = LockdownPicker(parent, self._on_lockdown)
        self._lockdown.pack(padx=10, pady=5, anchor="w")

        # Mask
        tk.Frame(parent, bg=BORDER, height=1).pack(fill="x", pady=8)
        mask_frame = tk.Frame(parent, bg=SURFACE)
        mask_frame.pack(fill="x", padx=10)
        self._mask_var = tk.BooleanVar()
        tk.Checkbutton(
            mask_frame, text="Mask Mandate", variable=self._mask_var,
            bg=SURFACE, fg=TEXT, selectcolor=SURFACE, activebackground=SURFACE,
            font=("Arial", 10), command=self._on_mask
        ).pack(anchor="w")

        # Vaccination
        tk.Frame(parent, bg=BORDER, height=1).pack(fill="x", pady=8)
        tk.Label(parent, text="VACCINATION", bg=SURFACE, fg=ACCENT, font=("Arial", 10, "bold")).pack(anchor="w", padx=10)
        self._vacc_var = tk.IntVar(value=0)
        self._vacc_lbl = tk.Label(parent, text="0%", bg=SURFACE, fg=GREEN, font=("Arial", 11, "bold"))
        self._vacc_lbl.pack(anchor="w", padx=10)
        tk.Scale(
            parent, from_=0, to=100, orient="horizontal", variable=self._vacc_var,
            bg=SURFACE, fg=TEXT, troughcolor="#444", highlightthickness=0,
            showvalue=False, command=self._on_vacc, length=190
        ).pack(padx=10)

        # Stimulus
        tk.Frame(parent, bg=BORDER, height=1).pack(fill="x", pady=8)
        tk.Label(parent, text="STIMULUS", bg=SURFACE, fg=ACCENT, font=("Arial", 10, "bold")).pack(anchor="w", padx=10)
        self._stim_var = tk.IntVar(value=0)
        self._stim_lbl = tk.Label(parent, text="$0", bg=SURFACE, fg=GREEN, font=("Arial", 11, "bold"))
        self._stim_lbl.pack(anchor="w", padx=10)
        tk.Scale(
            parent, from_=0, to=200, orient="horizontal", variable=self._stim_var,
            bg=SURFACE, fg=TEXT, troughcolor="#444", highlightthickness=0,
            showvalue=False, command=self._on_stim, length=190
        ).pack(padx=10)

        # Speed
        tk.Frame(parent, bg=BORDER, height=1).pack(fill="x", pady=8)
        tk.Label(parent, text="SPEED", bg=SURFACE, fg=ACCENT, font=("Arial", 10, "bold")).pack(anchor="w", padx=10)
        speed_frame = tk.Frame(parent, bg=SURFACE)
        speed_frame.pack(padx=10, pady=5, anchor="w")
        self._speed_btns = {}
        for lbl in self.SPEEDS:
            b = tk.Button(
                speed_frame, text=lbl, width=4, relief="flat",
                font=("Arial", 9), pady=3,
                command=lambda l=lbl: self._on_speed(l)
            )
            b.pack(side="left", padx=1)
            self._speed_btns[lbl] = b
        self._on_speed("1x")

        # Buttons
        tk.Frame(parent, bg=BORDER, height=1).pack(fill="x", pady=8)

        self._run_btn = tk.Button(
            parent, text="▶ RUN", bg=GREEN, fg="#000", relief="flat",
            font=("Arial", 12, "bold"), pady=8, command=self._on_run
        )
        self._run_btn.pack(fill="x", padx=10, pady=3)

        tk.Button(
            parent, text="⏭ NEXT DAY", bg=YELLOW, fg="#000", relief="flat",
            font=("Arial", 10, "bold"), pady=6, command=self._on_step
        ).pack(fill="x", padx=10, pady=3)

        tk.Button(
            parent, text="↺ RESET", bg="#444", fg=TEXT, relief="flat",
            font=("Arial", 10), pady=5, command=self._on_reset
        ).pack(fill="x", padx=10, pady=3)

        # Legend
        tk.Frame(parent, bg=BORDER, height=1).pack(fill="x", pady=8)
        tk.Label(parent, text="LEGEND", bg=SURFACE, fg=ACCENT, font=("Arial", 10, "bold")).pack(anchor="w", padx=10)
        for color, name in [(C_GRAY, "Susceptible"), (C_YELLOW, "Exposed"), (C_ORANGE, "Asympt"), (C_RED, "Sympt"), (C_GREEN, "Recovered")]:
            row = tk.Frame(parent, bg=SURFACE)
            row.pack(anchor="w", padx=10, pady=1)
            tk.Label(row, text="■", bg=SURFACE, fg=color, font=("Arial", 10)).pack(side="left")
            tk.Label(row, text=name, bg=SURFACE, fg=TEXT_DIM, font=("Arial", 9)).pack(side="left", padx=4)

    def _build_main(self, parent):
        # KPI bar
        kpi_frame = tk.Frame(parent, bg=BG)
        kpi_frame.pack(fill="x", padx=8, pady=8)

        self._kpis = {}
        for key, label in [("cases", "ACTIVE"), ("dead", "DEATHS"), ("hosp", "HOSPITAL"), ("unemp", "UNEMP"), ("bank", "BANKRUPT")]:
            tile = KpiTile(kpi_frame, label)
            tile.pack(side="left", fill="both", expand=True, padx=2)
            self._kpis[key] = tile

        # Warning banner
        self._warning = tk.Label(parent, text="⚠ HOSPITAL OVERWHELMED", bg="#b71c1c", fg="#fff", font=("Arial", 11, "bold"), pady=5)

        # Charts
        charts = tk.Frame(parent, bg=BG)
        charts.pack(fill="both", expand=True, padx=8, pady=4)
        charts.columnconfigure(0, weight=1)
        charts.columnconfigure(1, weight=1)
        charts.rowconfigure(0, weight=1)
        charts.rowconfigure(1, weight=1)

        self._charts = {}
        self._charts["epi"] = LineChart(charts, "INFECTIONS", [
            {"label": "Sus", "color": C_GRAY, "data": []},
            {"label": "Exp", "color": C_YELLOW, "data": []},
            {"label": "Asy", "color": C_ORANGE, "data": []},
            {"label": "Sym", "color": C_RED, "data": []},
            {"label": "Rec", "color": C_GREEN, "data": []},
        ])
        self._charts["epi"].grid(row=0, column=0, sticky="nsew", padx=2, pady=2)

        self._charts["gdp"] = LineChart(charts, "GDP", [{"label": "GDP", "color": ACCENT, "data": []}])
        self._charts["gdp"].grid(row=0, column=1, sticky="nsew", padx=2, pady=2)

        self._charts["hosp"] = LineChart(charts, "HOSPITAL %", [{"label": "%", "color": C_RED, "data": []}])
        self._charts["hosp"].grid(row=1, column=0, sticky="nsew", padx=2, pady=2)

        self._charts["wealth"] = LineChart(charts, "WEALTH", [
            {"label": "Mean", "color": ACCENT, "data": []},
            {"label": "Median", "color": C_GREEN, "data": []},
        ])
        self._charts["wealth"].grid(row=1, column=1, sticky="nsew", padx=2, pady=2)

        # Status bar
        status = tk.Frame(parent, bg=SURFACE)
        status.pack(fill="x")
        self._status = tk.Label(status, text="Ready", bg=SURFACE, fg=TEXT_DIM, font=("Arial", 10), anchor="w")
        self._status.pack(side="left", padx=10, pady=8)
        self._day = tk.Label(status, text="DAY 0", bg=SURFACE, fg=ACCENT, font=("Arial", 12, "bold"))
        self._day.pack(side="right", padx=10, pady=8)

    def _new_sim(self):
        self._gov = Government()
        self._sim = SimulationEngine(government=self._gov, seed=CONFIG["RANDOM_SEED"])

    def _tick_once(self):
        with self._lock:
            self._sim.tick()
        self._update_ui()

    def _tick_loop(self):
        if not self._running:
            return
        self._tick_once()
        r = self._sim.records[-1] if self._sim.records else None
        if r:
            active = r["exposed"] + r["infectious_asymptomatic"] + r["infectious_symptomatic"]
            if (active == 0 and self._sim.tick_num > 30) or self._sim.tick_num >= CONFIG["NUM_TICKS"]:
                self._running = False
                self._run_btn.config(text="▶ RUN", bg=GREEN)
                self._status.config(text="Simulation complete")
                return
        self._after_id = self.after(self._tick_ms, self._tick_loop)

    def _update_ui(self):
        if not self._sim.records:
            return
        r = self._sim.records[-1]
        R = self._sim.records[-365:]

        # Charts
        self._charts["epi"].set_all([
            [x["susceptible"] for x in R],
            [x["exposed"] for x in R],
            [x["infectious_asymptomatic"] for x in R],
            [x["infectious_symptomatic"] for x in R],
            [x["recovered"] for x in R],
        ])
        self._charts["gdp"].set_all([[x["gdp"] for x in R]])
        self._charts["hosp"].set_all([[x["healthcare_patients"] / max(1, x["healthcare_capacity"]) * 100 for x in R]])
        self._charts["wealth"].set_all([[x["mean_wallet"] for x in R], [x["median_wallet"] for x in R]])

        # KPIs
        active = r["infectious_asymptomatic"] + r["infectious_symptomatic"]
        self._kpis["cases"].update(f"{active:,}", f"{r['infectious_symptomatic']:,} sympt", "bad" if active > 1000 else "warn" if active > 200 else "")
        self._kpis["dead"].update(f"{r['dead']:,}", "", "bad" if r["dead"] > 200 else "warn" if r["dead"] > 50 else "")
        hc = round(r["healthcare_patients"] / max(1, r["healthcare_capacity"]) * 100)
        self._kpis["hosp"].update(f"{hc}%", f"{r['healthcare_patients']}/{r['healthcare_capacity']}", "bad" if r["healthcare_overwhelmed"] else "warn" if hc > 70 else "good")
        self._kpis["unemp"].update(f"{r['unemployment_rate_pct']:.1f}%", "", "bad" if r["unemployment_rate_pct"] > 25 else "warn" if r["unemployment_rate_pct"] > 10 else "")
        self._kpis["bank"].update(str(r["companies_bankrupt"]), "of 200", "bad" if r["companies_bankrupt"] > 30 else "warn" if r["companies_bankrupt"] > 10 else "")

        self._day.config(text=f"DAY {self._sim.tick_num}")

        if r["healthcare_overwhelmed"]:
            self._warning.pack(fill="x", before=self._warning.master.winfo_children()[1])
        else:
            self._warning.pack_forget()

        if self._running:
            self._status.config(text=f"Day {self._sim.tick_num} running...")

    def _on_lockdown(self, level):
        if self._gov:
            self._gov.set_lockdown(level)

    def _on_mask(self):
        if self._gov:
            self._gov.set_mask_mandate(self._mask_var.get())

    def _on_vacc(self, val):
        v = int(float(val))
        self._vacc_lbl.config(text=f"{v}%" if v else "Off")
        if self._gov:
            self._gov.set_vaccination_rate(v / 100)

    def _on_stim(self, val):
        v = int(float(val))
        self._stim_lbl.config(text=f"${v}")
        if self._gov:
            self._gov.set_stimulus(float(v))

    def _on_speed(self, label):
        self._tick_ms = self.SPEEDS[label]
        for l, b in self._speed_btns.items():
            b.config(bg=ACCENT if l == label else "#444", fg="#000" if l == label else TEXT_DIM)

    def _on_run(self):
        if self._running:
            self._running = False
            if self._after_id:
                self.after_cancel(self._after_id)
            self._run_btn.config(text="▶ RUN", bg=GREEN)
            self._status.config(text="Paused")
        else:
            self._running = True
            self._run_btn.config(text="⏸ PAUSE", bg="#666")
            self._tick_loop()

    def _on_step(self):
        if self._running:
            self._running = False
            if self._after_id:
                self.after_cancel(self._after_id)
            self._run_btn.config(text="▶ RUN", bg=GREEN)
        self._tick_once()
        self._status.config(text=f"Day {self._sim.tick_num}")

    def _on_reset(self):
        self._running = False
        if self._after_id:
            self.after_cancel(self._after_id)
        self._new_sim()
        self._run_btn.config(text="▶ RUN", bg=GREEN)
        for c in self._charts.values():
            for s in c.series:
                s["data"] = []
            c.redraw()
        for k in self._kpis.values():
            k.update("—", "")
        self._day.config(text="DAY 0")
        self._warning.pack_forget()
        self._status.config(text="Reset")


def run():
    Dashboard().mainloop()


if __name__ == "__main__":
    run()