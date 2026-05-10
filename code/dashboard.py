"""
dashboard.py  —  Polished Tkinter dashboard for the pandemic simulation.

Requires a Python build with Tkinter support (`_tkinter`).

Run via:
    python main.py
    python dashboard.py
"""

from __future__ import annotations

import threading
import tkinter as tk
from typing import Callable, Optional

import numpy as np

from config import CONFIG
from agents import HealthState
from entities import Government
from simulation import SimulationEngine


#  Polished Dark Palette 
BG = "#0f1419"
SURFACE = "#1a2230"
BORDER = "#2a3445"
TEXT = "#ffffff"
TEXT_DIM = "#A9A9A9"
ACCENT = "#5ec9f5"
GREEN = "#66bb6a"
YELLOW = "#ffca28"
RED = "#e53935"

# Chart colors
C_GRAY = "#9e9e9e"
C_YELLOW = "#ffca28"
C_ORANGE = "#ffa726"
C_RED = "#ef5350"
C_GREEN = "#66bb6a"


class LineChart(tk.Canvas):
    """Simple line chart with a soft halo line for readability."""

    def __init__(self, parent, title: str, series: list[dict], **kwargs):
        super().__init__(
            parent,
            bg=SURFACE,
            highlightthickness=1,
            highlightbackground=BORDER,
            **kwargs,
        )
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

        self.create_text(
            10,
            10,
            anchor="nw",
            text=self.title,
            fill=ACCENT,
            font=("Arial", 11, "bold"),
        )

        all_data = [v for s in self.series for v in s["data"]]
        n = max((len(s["data"]) for s in self.series), default=0)

        if n == 0 or not all_data:
            self.create_text(w // 2, h // 2, text="No data", fill=TEXT_DIM, font=("Arial", 11))
            return

        y_max = max(all_data) * 1.1 or 1
        x_max = max(1, n - 1)

        def px(i):
            return pad_l + (i / x_max) * cw

        def py(v):
            return pad_t + ch - (v / y_max) * ch

        for i in range(5):
            yv = y_max * i / 4
            ypos = py(yv)
            self.create_line(pad_l, ypos, w - pad_r, ypos, fill="#2e3b50", dash=(2, 4))
            self.create_text(
                pad_l - 5,
                ypos,
                anchor="e",
                text=self._fmt(yv),
                fill=TEXT_DIM,
                font=("Arial", 9),
            )

        step = max(1, n // 5)
        for i in range(0, n, step):
            self.create_text(px(i), h - pad_b + 12, text=str(i), fill=TEXT_DIM, font=("Arial", 9))

        for s in self.series:
            data = s["data"]
            if len(data) < 2:
                continue
            pts = []
            for i, v in enumerate(data):
                pts.extend([px(i), py(v)])
            self.create_line(*pts, fill=s["color"], width=5, stipple="gray50", smooth=True)
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


class Sparkline(tk.Canvas):
    def __init__(self, parent, color: str = ACCENT):
        super().__init__(
            parent,
            width=150,
            height=24,
            bg=SURFACE,
            highlightthickness=0,
            bd=0,
        )
        self._color = color

    def set_data(self, values: list[float]) -> None:
        self.delete("all")
        if len(values) < 2:
            return
        w = max(1, self.winfo_width())
        h = max(1, self.winfo_height())
        pad = 2
        lo = min(values)
        hi = max(values)
        if hi == lo:
            self.create_line(pad, h / 2, w - pad, h / 2, fill=self._color, width=2, smooth=True)
            return

        x_max = max(1, len(values) - 1)
        pts = []
        for i, val in enumerate(values):
            x = pad + (i / x_max) * (w - pad * 2)
            y = h - pad - ((val - lo) / (hi - lo)) * (h - pad * 2)
            pts.extend([x, y])
        self.create_line(*pts, fill=self._color, width=2, smooth=True)


class KpiTile(tk.Frame):
    def __init__(self, parent, label: str):
        super().__init__(parent, bg=SURFACE, padx=10, pady=8)
        self.configure(highlightbackground=BORDER, highlightthickness=1)
        tk.Label(self, text=label, bg=SURFACE, fg=ACCENT, font=("Arial", 9, "bold")).pack(anchor="w")
        self._val = tk.Label(self, text="—", bg=SURFACE, fg=TEXT, font=("Arial", 22, "bold"))
        self._val.pack(anchor="w")
        self._sub = tk.Label(self, text="", bg=SURFACE, fg=TEXT_DIM, font=("Arial", 9))
        self._sub.pack(anchor="w")
        self._spark = Sparkline(self)
        self._spark.pack(fill="x", pady=(5, 0))

        self._target = 0.0
        self._current = 0.0
        self._anim_id = None
        self._fmt = "{:,.0f}"
        self._status = ""
        self._sub_text = ""

    def _status_color(self) -> str:
        return {"bad": RED, "warn": YELLOW, "good": GREEN}.get(self._status, TEXT)

    def _render_value(self) -> None:
        if "f" in self._fmt or "%" in self._fmt:
            shown = self._fmt.format(self._current)
        else:
            shown = self._fmt.format(int(self._current))
        self._val.config(text=shown, fg=self._status_color())
        self._sub.config(text=self._sub_text)

    def update(self, val: str, sub: str = "", status: str = ""):
        if self._anim_id:
            self.after_cancel(self._anim_id)
            self._anim_id = None
        self._status = status
        self._sub_text = sub
        self._val.config(text=val, fg=self._status_color())
        self._sub.config(text=sub)

    def update_animated(self, target_val: float, fmt: str, sub: str, status: str) -> None:
        if self._anim_id:
            self.after_cancel(self._anim_id)
            self._anim_id = None
        self._target = float(target_val)
        self._fmt = fmt
        self._status = status
        self._sub_text = sub

        def _step():
            self._current += (self._target - self._current) * 0.30
            if abs(self._target - self._current) < 0.5:
                self._current = self._target
                self._render_value()
                self._anim_id = None
                return
            self._render_value()
            self._anim_id = self.after(18, _step)

        _step()

    def set_sparkline(self, values: list[float]) -> None:
        self._spark.set_data(values)


class LockdownPicker(tk.Frame):
    LABELS = ["None", "Light", "Mod", "Full"]

    def __init__(self, parent, on_change):
        super().__init__(parent, bg=SURFACE)
        self._on_change = on_change
        self._level = 0
        self._btns = []

        for i, lbl in enumerate(self.LABELS):
            b = tk.Button(
                self,
                text=lbl,
                width=4,
                relief="flat",
                font=("Arial", 11, "bold"),
                pady=5,
                padx=4,
                command=lambda n=i: self._pick(n),
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
                b.unbind("<Enter>")
                b.unbind("<Leave>")
            else:
                b.config(bg="#334156", fg=TEXT_DIM)
                b.bind("<Enter>", lambda e, btn=b: btn.config(bg="#425472"))
                b.bind("<Leave>", lambda e, btn=b: btn.config(bg="#334156"))

    def get(self):
        return self._level


class ScoreHud(tk.Frame):
    def __init__(self, parent):
        super().__init__(parent, bg=SURFACE, height=50)
        self.pack_propagate(False)
        self.configure(highlightbackground=BORDER, highlightthickness=1)
        self._score = tk.Label(
            self,
            text="CRISIS SCORE  00000",
            bg=SURFACE,
            fg=TEXT,
            font=("Arial", 18, "bold"),
            anchor="w",
        )
        self._score.pack(side="left", fill="both", expand=True, padx=14)

    def update_score(self, score: int) -> None:
        self._score.config(text=f"CRISIS SCORE  {score:05d}")


class EventLog(tk.Frame):
    def __init__(self, parent):
        super().__init__(parent, bg=SURFACE, height=110)
        self.pack_propagate(False)
        self.configure(highlightbackground=BORDER, highlightthickness=1)
        tk.Label(self, text="EVENT LOG", bg=SURFACE, fg=ACCENT, font=("Arial", 10, "bold")).pack(
            anchor="w",
            padx=10,
            pady=(6, 2),
        )

        holder = tk.Frame(self, bg=SURFACE)
        holder.pack(fill="both", expand=True, padx=6, pady=(0, 6))
        self._txt = tk.Text(
            holder,
            bg=SURFACE,
            fg=TEXT_DIM,
            insertbackground=TEXT,
            relief="flat",
            wrap="word",
            state="disabled",
            height=4,
        )
        sb = tk.Scrollbar(holder, orient="vertical", command=self._txt.yview)
        self._txt.configure(yscrollcommand=sb.set)
        self._txt.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")

    def clear(self) -> None:
        self._txt.config(state="normal")
        self._txt.delete("1.0", "end")
        self._txt.config(state="disabled")

    def add(self, day: int, msg: str, color: str) -> None:
        self._txt.config(state="normal")
        tag = f"evt-{day}-{self._txt.index('end')}"
        self._txt.insert("end", f"[Day {day:>3}] ", tag)
        self._txt.tag_config(tag, foreground=color, font=("Arial", 9, "bold"))
        self._txt.insert("end", f"{msg}\n", "msg")
        self._txt.tag_config("msg", foreground=TEXT_DIM, font=("Arial", 9))
        self._txt.see("end")
        self._txt.config(state="disabled")


class AgentView(tk.Canvas):
    """Canvas to visualize agents: size by wealth, color by health, position by company cluster."""

    def __init__(self, parent, **kwargs):
        super().__init__(
            parent,
            bg=SURFACE,
            highlightthickness=1,
            highlightbackground=BORDER,
            **kwargs,
        )
        self.title = "AGENTS"
        self.agents_data = None
        self.company_positions = {}
        self._rng = np.random.default_rng()
        self._precompute_positions()
        self.bind("<Configure>", lambda e: self.redraw())

    def _precompute_positions(self):
        """Arrange companies in a grid for spatial clustering."""
        cols = 15
        rows = (CONFIG["NUM_COMPANIES"] + cols - 1) // cols
        spacing_x = 50
        spacing_y = 50
        for cid in range(CONFIG["NUM_COMPANIES"]):
            row = cid // cols
            col = cid % cols
            self.company_positions[cid] = (col * spacing_x + 100, row * spacing_y + 100)

    def set_agents(self, agents, subsample_size: int = 1000):
        """Subsample agents and prepare data for drawing."""
        n = agents.n
        if subsample_size >= n:
            indices = np.arange(n)
        else:
            indices = self._rng.choice(n, subsample_size, replace=False)

        self.agents_data = []
        for i in indices:
            health = agents.health_state[i]
            wallet = agents.wallet[i]
            company = agents.company_id[i]

            # Map health state to color
            color_map = {
                HealthState.SUSCEPTIBLE: C_GRAY,
                HealthState.EXPOSED: C_YELLOW,
                HealthState.INFECTIOUS_ASYMPTOMATIC: C_ORANGE,
                HealthState.INFECTIOUS_SYMPTOMATIC: C_RED,
                HealthState.RECOVERED: C_GREEN,
                HealthState.DEAD: "#000000",
            }
            color = color_map.get(health, C_GRAY)

            # Size: radius 2-10 based on wallet
            min_wallet, max_wallet = 150.0, 2000.0
            wallet_norm = (wallet - min_wallet) / (max_wallet - min_wallet)
            wallet_norm = max(0.0, min(1.0, wallet_norm))
            radius = 2 + 8 * wallet_norm
            radius = max(2, min(10, radius))

            # Position: company center + random offset
            cx, cy = self.company_positions.get(int(company), (200, 200))
            offset_x = self._rng.uniform(-20, 20)
            offset_y = self._rng.uniform(-20, 20)
            x, y = cx + offset_x, cy + offset_y
            self.agents_data.append((x, y, radius, color))

        self.redraw()

    def redraw(self):
        self.delete("all")
        w = self.winfo_width()
        h = self.winfo_height()
        if w < 50 or h < 50 or not self.agents_data:
            return

        # Draw title
        self.create_text(
            10, 10, anchor="nw", text=self.title, fill=ACCENT, font=("Arial", 11, "bold")
        )

        # Draw agents as circles
        for x, y, r, color in self.agents_data:
            self.create_oval(x - r, y - r, x + r, y + r, fill=color, outline=color)


class Dashboard(tk.Tk):
    SPEEDS = {"0.25x": 400, "0.5x": 200, "1x": 100, "2x": 50, "5x": 20}

    def __init__(self):
        super().__init__()
        self.title("Outbreak Command")
        self.configure(bg=BG)
        self.geometry("1280x760")
        self.minsize(900, 600)

        self._gov = None
        self._sim = None
        self._running = False
        self._tick_ms = 100
        self._after_id = None
        self._lock = threading.Lock()
        self._warning_pulse_id = None
        self._warning_on = False
        self._speed_selected = "1x"
        self._fired_events: set[str] = set()
        self._peak_unemp = 0.0
        self._peak_active = 0
        self._game_over_modal = None

        self._build_ui()
        self._new_sim()

    def _build_ui(self):
        sidebar = tk.Frame(self, bg=SURFACE, width=320)
        sidebar.pack(side="left", fill="y")
        sidebar.pack_propagate(False)

        main = tk.Frame(self, bg=BG)
        main.pack(side="left", fill="both", expand=True)

        self._build_sidebar(sidebar)
        self._build_main(main)

    def _build_sidebar(self, parent):
        def divider():
            tk.Frame(parent, bg="#2a3445", height=2).pack(fill="x", pady=10)

        def section(symbol: str, title: str, value: str) -> tk.Label:
            row = tk.Frame(parent, bg=SURFACE)
            row.pack(fill="x", padx=16)
            tk.Label(
                row,
                text=f"{symbol} {title}",
                bg=SURFACE,
                fg=ACCENT,
                font=("Arial", 11, "bold"),
            ).pack(side="left")
            chip = tk.Label(
                row,
                text=value,
                bg=BORDER,
                fg=TEXT,
                font=("Arial", 9, "bold"),
                padx=6,
                pady=2,
            )
            chip.pack(side="right")
            return chip

        tk.Label(parent, text="OUTBREAK", bg=SURFACE, fg=ACCENT, font=("Arial", 18, "bold")).pack(
            pady=(16, 0)
        )
        tk.Label(parent, text="Command Center", bg=SURFACE, fg=TEXT_DIM, font=("Arial", 10)).pack()
        divider()

        self._lock_chip = section("▌", "LOCKDOWN", "Lv 0")
        self._lockdown = LockdownPicker(parent, self._on_lockdown)
        self._lockdown.pack(padx=15, pady=6, anchor="w")

        divider()
        self._mask_chip = section("▌", "MASK MANDATE", "Off")
        mask_frame = tk.Frame(parent, bg=SURFACE)
        mask_frame.pack(fill="x", padx=16)
        self._mask_var = tk.BooleanVar()
        self._mask_chk = tk.Checkbutton(
            mask_frame,
            text="Enable mandate",
            variable=self._mask_var,
            bg=SURFACE,
            fg=TEXT,
            selectcolor=SURFACE,
            activebackground=SURFACE,
            activeforeground=TEXT,
            font=("Arial", 10),
            command=self._on_mask,
        )
        self._mask_chk.pack(anchor="w")

        divider()
        self._vacc_chip = section("▌", "VACCINATION", "0%")
        self._vacc_var = tk.IntVar(value=0)
        self._vacc_lbl = tk.Label(parent, text="0%", bg=SURFACE, fg=GREEN, font=("Arial", 11, "bold"))
        self._vacc_lbl.pack(anchor="w", padx=16)
        tk.Scale(
            parent,
            from_=0,
            to=100,
            orient="horizontal",
            variable=self._vacc_var,
            bg=SURFACE,
            fg=TEXT,
            troughcolor="#2d3a4f",
            activebackground=ACCENT,
            highlightthickness=0,
            showvalue=False,
            command=self._on_vacc,
            length=280,
        ).pack(padx=16)

        divider()
        self._stim_chip = section("$", "STIMULUS", "$0")
        self._stim_var = tk.IntVar(value=0)
        self._stim_lbl = tk.Label(parent, text="$0", bg=SURFACE, fg=GREEN, font=("Arial", 11, "bold"))
        self._stim_lbl.pack(anchor="w", padx=16)
        tk.Scale(
            parent,
            from_=0,
            to=200,
            orient="horizontal",
            variable=self._stim_var,
            bg=SURFACE,
            fg=TEXT,
            troughcolor="#2d3a4f",
            activebackground=ACCENT,
            highlightthickness=0,
            showvalue=False,
            command=self._on_stim,
            length=280,
        ).pack(padx=16)

        divider()
        self._speed_chip = section("»", "SPEED", "1x")
        speed_frame = tk.Frame(parent, bg=SURFACE)
        speed_frame.pack(padx=16, pady=6, anchor="w")
        self._speed_btns = {}
        for lbl in self.SPEEDS:
            b = tk.Button(
                speed_frame,
                text=lbl,
                width=3,
                relief="flat",
                font=("Arial", 9),
                pady=3,
                command=lambda l=lbl: self._on_speed(l),
            )
            b.pack(side="left", padx=2)
            self._speed_btns[lbl] = b
        self._on_speed("1x")

        divider()
        self._run_btn = tk.Button(
            parent,
            text="▶ RUN",
            bg=GREEN,
            fg="#000",
            relief="flat",
            font=("Arial", 12, "bold"),
            pady=8,
            command=self._on_run,
        )
        self._run_btn.pack(fill="x", padx=16, pady=3)
        self._make_hoverable(self._run_btn, GREEN, "#8dd28f", should_hover=lambda: not self._running)

        self._step_btn = tk.Button(
            parent,
            text="⏭ NEXT DAY",
            bg=YELLOW,
            fg="#000",
            relief="flat",
            font=("Arial", 12, "bold"),
            pady=6,
            command=self._on_step,
        )
        self._step_btn.pack(fill="x", padx=16, pady=3)
        self._make_hoverable(self._step_btn, YELLOW, "#ffd95a")

        self._reset_btn = tk.Button(
            parent,
            text="↺ RESET",
            bg="#334156",
            fg="#000000",
            relief="flat",
            font=("Arial", 12, "bold"),
            pady=5,
            command=self._on_reset,
        )
        self._reset_btn.pack(fill="x", padx=16, pady=3)
        self._make_hoverable(self._reset_btn, "#334156", "#435776")

        divider()
        section("■", "LEGEND", "")
        for color, name in [
            (C_GRAY, "Susceptible"),
            (C_YELLOW, "Exposed"),
            (C_ORANGE, "Asympt"),
            (C_RED, "Sympt"),
            (C_GREEN, "Recovered"),
        ]:
            row = tk.Frame(parent, bg=SURFACE)
            row.pack(anchor="w", padx=16, pady=1)
            tk.Label(row, text="■", bg=SURFACE, fg=color, font=("Arial", 10)).pack(side="left")
            tk.Label(row, text=name, bg=SURFACE, fg=TEXT_DIM, font=("Arial", 9)).pack(side="left", padx=4)

    def _build_main(self, parent):
        kpi_frame = tk.Frame(parent, bg=BG)
        kpi_frame.pack(fill="x", padx=8, pady=8)

        self._kpis = {}
        for key, label in [
            ("cases", "ACTIVE"),
            ("dead", "DEATHS"),
            ("hosp", "HOSPITAL"),
            ("unemp", "UNEMP"),
            ("bank", "BANKRUPT"),
        ]:
            tile = KpiTile(kpi_frame, label)
            tile.pack(side="left", fill="both", expand=True, padx=2)
            self._kpis[key] = tile

        self._score_hud = ScoreHud(parent)
        self._score_hud.pack(fill="x", padx=8, pady=(0, 6))

        self._warning = tk.Label(
            parent,
            text="▲ HOSPITAL OVERWHELMED",
            bg="#b71c1c",
            fg="#fff",
            font=("Arial", 11, "bold"),
            pady=5,
        )

        self._charts_container = tk.Frame(parent, bg=BG)
        self._charts_container.pack(fill="both", expand=True, padx=8, pady=4)
        self._charts_container.columnconfigure(0, weight=1)
        self._charts_container.columnconfigure(1, weight=1)
        self._charts_container.rowconfigure(0, weight=1)
        self._charts_container.rowconfigure(1, weight=1)

        self._charts = {}
        self._charts["epi"] = LineChart(
            self._charts_container,
            "INFECTIONS",
            [
                {"label": "Sus", "color": C_GRAY, "data": []},
                {"label": "Exp", "color": C_YELLOW, "data": []},
                {"label": "Asy", "color": C_ORANGE, "data": []},
                {"label": "Sym", "color": C_RED, "data": []},
                {"label": "Rec", "color": C_GREEN, "data": []},
            ],
        )
        self._charts["epi"].grid(row=0, column=0, sticky="nsew", padx=2, pady=2)

        self._charts["gdp"] = LineChart(
            self._charts_container,
            "GDP",
            [{"label": "GDP", "color": ACCENT, "data": []}],
        )
        self._charts["gdp"].grid(row=0, column=1, sticky="nsew", padx=2, pady=2)

        self._charts["hosp"] = LineChart(
            self._charts_container,
            "HOSPITAL %",
            [{"label": "%", "color": C_RED, "data": []}],
        )
        self._charts["hosp"].grid(row=1, column=0, sticky="nsew", padx=2, pady=2)

        self._agent_view = AgentView(self._charts_container)
        self._agent_view.grid(row=1, column=1, sticky="nsew", padx=2, pady=2)

        self._event_log = EventLog(parent)
        self._event_log.pack(fill="x", padx=8, pady=(4, 6))

        status = tk.Frame(parent, bg=SURFACE)
        status.pack(fill="x")
        self._status = tk.Label(status, text="Ready", bg=SURFACE, fg=TEXT_DIM, font=("Arial", 10), anchor="w")
        self._status.pack(side="left", padx=10, pady=8)
        self._day = tk.Label(status, text="DAY 0", bg=SURFACE, fg=ACCENT, font=("Arial", 12, "bold"))
        self._day.pack(side="right", padx=10, pady=8)

    def _new_sim(self):
        self._gov = Government()
        self._sim = SimulationEngine(government=self._gov, seed=CONFIG["RANDOM_SEED"])
        self._fired_events.clear()
        self._peak_unemp = 0.0
        self._peak_active = 0
        if hasattr(self, "_event_log"):
            self._event_log.clear()

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
                self._show_game_over()
                return
        self._after_id = self.after(self._tick_ms, self._tick_loop)

    def _update_ui(self):
        if not self._sim.records:
            return
        r = self._sim.records[-1]
        prev = self._sim.records[-2] if len(self._sim.records) > 1 else None
        R = self._sim.records[-365:]

        self._charts["epi"].set_all(
            [
                [x["susceptible"] for x in R],
                [x["exposed"] for x in R],
                [x["infectious_asymptomatic"] for x in R],
                [x["infectious_symptomatic"] for x in R],
                [x["recovered"] for x in R],
            ]
        )
        self._charts["gdp"].set_all([[x["gdp"] for x in R]])
        self._charts["hosp"].set_all(
            [[x["healthcare_patients"] / max(1, x["healthcare_capacity"]) * 100 for x in R]]
        )
        self._agent_view.set_agents(self._sim.agents)

        active = r["infectious_asymptomatic"] + r["infectious_symptomatic"]
        self._peak_active = max(self._peak_active, int(active + r["exposed"]))
        self._peak_unemp = max(self._peak_unemp, float(r["unemployment_rate_pct"]) / 100.0)

        self._kpis["cases"].update_animated(
            float(active),
            "{:,.0f}",
            f"{r['infectious_symptomatic']:,} sympt",
            "bad" if active > 1000 else "warn" if active > 200 else "",
        )
        self._kpis["dead"].update_animated(
            float(r["dead"]),
            "{:,.0f}",
            "",
            "bad" if r["dead"] > 200 else "warn" if r["dead"] > 50 else "",
        )
        hc = round(r["healthcare_patients"] / max(1, r["healthcare_capacity"]) * 100)
        self._kpis["hosp"].update(
            f"{hc}%",
            f"{r['healthcare_patients']}/{r['healthcare_capacity']}",
            "bad" if r["healthcare_overwhelmed"] else "warn" if hc > 70 else "good",
        )
        self._kpis["unemp"].update_animated(
            float(r["unemployment_rate_pct"]),
            "{:.1f}%",
            "",
            "bad" if r["unemployment_rate_pct"] > 25 else "warn" if r["unemployment_rate_pct"] > 10 else "",
        )
        self._kpis["bank"].update_animated(
            float(r["companies_bankrupt"]),
            "{:,.0f}",
            f"of {CONFIG['NUM_COMPANIES']}",
            "bad" if r["companies_bankrupt"] > 30 else "warn" if r["companies_bankrupt"] > 10 else "",
        )

        tail = self._sim.records[-30:]
        self._kpis["cases"].set_sparkline(
            [x["infectious_asymptomatic"] + x["infectious_symptomatic"] for x in tail]
        )
        self._kpis["dead"].set_sparkline([x["dead"] for x in tail])
        self._kpis["hosp"].set_sparkline(
            [x["healthcare_patients"] / max(1, x["healthcare_capacity"]) * 100 for x in tail]
        )
        self._kpis["unemp"].set_sparkline([x["unemployment_rate_pct"] for x in tail])
        self._kpis["bank"].set_sparkline([x["companies_bankrupt"] for x in tail])

        score = int(
            r["dead"] * 10
            + self._peak_unemp * 50
            + r["companies_bankrupt"] * 40
            + r["national_debt"] / 10_000
        )
        self._score_hud.update_score(score)

        self._day.config(text=f"DAY {self._sim.tick_num}")
        if r["healthcare_overwhelmed"]:
            self._show_warning()
        else:
            self._hide_warning()

        self._maybe_fire_events(r, prev)

        if self._running:
            self._status.config(text=f"Day {self._sim.tick_num} running...")

    def _make_hoverable(
        self,
        btn: tk.Button,
        base_bg: str,
        hover_bg: str,
        should_hover: Optional[Callable[[], bool]] = None,
    ) -> None:
        def on_enter(_):
            if should_hover is None or should_hover():
                btn.config(bg=hover_bg)

        def on_leave(_):
            if should_hover is None or should_hover():
                btn.config(bg=base_bg)

        btn.bind("<Enter>", on_enter)
        btn.bind("<Leave>", on_leave)

    def _show_warning(self):
        if not self._warning.winfo_ismapped():
            self._warning.pack(fill="x", padx=8, pady=(0, 4), before=self._charts_container)
        if self._warning_pulse_id is None:
            self._pulse_warning()

    def _hide_warning(self):
        if self._warning_pulse_id is not None:
            self.after_cancel(self._warning_pulse_id)
            self._warning_pulse_id = None
        self._warning.config(bg="#b71c1c")
        self._warning.pack_forget()
        self._warning_on = False

    def _pulse_warning(self):
        self._warning_on = not self._warning_on
        self._warning.config(bg="#e53935" if self._warning_on else "#b71c1c")
        self._warning_pulse_id = self.after(500, self._pulse_warning)

    def _fire_event(self, key: str, msg: str, color: str) -> None:
        if key in self._fired_events:
            return
        self._fired_events.add(key)
        self._event_log.add(self._sim.tick_num, msg, color)
        self._toast(msg, color)

    def _maybe_fire_events(self, r: dict, prev: Optional[dict]) -> None:
        active = r["exposed"] + r["infectious_asymptomatic"] + r["infectious_symptomatic"]
        prev_over = bool(prev["healthcare_overwhelmed"]) if prev else False
        prev_crisis = bool(prev["bank_in_crisis"]) if prev else False

        if r["dead"] > 0:
            self._fire_event("first_death", "First fatality reported.", RED)
        if r["healthcare_overwhelmed"] and not prev_over:
            self._fire_event("hospital_overwhelmed", "Hospital capacity exceeded.", RED)
        if r["companies_bankrupt"] > 0:
            self._fire_event("first_bankrupt", "First company bankruptcy registered.", C_ORANGE)
        if self._peak_active > 200 and active < 0.8 * self._peak_active:
            self._fire_event("first_wave_peak", "First wave appears to have peaked.", ACCENT)
        if r["bank_in_crisis"] and not prev_crisis:
            self._fire_event("bank_crisis", "Banking reserves entered crisis zone.", RED)
        if r.get("rehires_today", 0) > 0:
            self._fire_event("first_rehire", "First rehires are back in the labor market.", GREEN)

    def _toast(self, msg: str, color: str) -> None:
        toast = tk.Toplevel(self, bg=color)
        toast.overrideredirect(True)
        toast.attributes("-topmost", True)

        width, height = 360, 46
        self.update_idletasks()
        target_x = self.winfo_rootx() + self.winfo_width() - width - 18
        y = self.winfo_rooty() + self.winfo_height() - height - 60
        start_x = target_x + width + 20  # starts off-screen to the right
        toast.geometry(f"{width}x{height}+{start_x}+{y}")

        tk.Label(toast, text=msg, bg=color, fg="#ffffff", font=("Arial", 10, "bold")).pack(
            fill="both",
            expand=True,
            padx=12,
            pady=8,
        )

        steps = 12

        def slide(i: int = 0):
            if not toast.winfo_exists():
                return
            x = int(start_x - (start_x - target_x) * (i / steps))
            toast.geometry(f"{width}x{height}+{x}+{y}")
            if i < steps:
                toast.after(20, slide, i + 1)
            else:
                toast.after(2000, toast.destroy)

        slide()

    def _show_game_over(self) -> None:
        if self._game_over_modal and self._game_over_modal.winfo_exists():
            return
        if not self._sim.records:
            return

        r = self._sim.records[-1]
        score = int(
            r["dead"] * 10
            + self._peak_unemp * 50
            + r["companies_bankrupt"] * 40
            + r["national_debt"] / 10_000
        )

        win = tk.Toplevel(self, bg=SURFACE)
        win.title("Outbreak Complete")
        win.geometry("520x360")
        win.resizable(False, False)
        win.transient(self)
        win.grab_set()
        self._game_over_modal = win
        win.protocol("WM_DELETE_WINDOW", self._close_game_over)

        self.update_idletasks()
        x = self.winfo_rootx() + (self.winfo_width() - 520) // 2
        y = self.winfo_rooty() + (self.winfo_height() - 360) // 2
        win.geometry(f"+{x}+{y}")

        tk.Label(win, text="OUTBREAK COMPLETE", bg=SURFACE, fg=ACCENT, font=("Arial", 18, "bold")).pack(
            pady=(18, 8)
        )
        tk.Label(win, text=f"Final Score: {score:05d}", bg=SURFACE, fg=TEXT, font=("Arial", 24, "bold")).pack()
        tk.Frame(win, bg=SURFACE, height=8).pack()

        stats = tk.Frame(win, bg=SURFACE)
        stats.pack(fill="x", padx=24)
        rows = [
            ("Total deaths", f"{r['dead']:,}"),
            ("Peak unemployment", f"{self._peak_unemp * 100:.1f}%"),
            ("Companies bankrupt", f"{r['companies_bankrupt']}"),
            ("Final national debt", f"${r['national_debt']:,.0f}"),
            ("Days survived", f"{self._sim.tick_num}"),
        ]
        for k, v in rows:
            row = tk.Frame(stats, bg=SURFACE)
            row.pack(fill="x", pady=3)
            tk.Label(row, text=k, bg=SURFACE, fg=TEXT_DIM, font=("Arial", 15)).pack(side="left")
            tk.Label(row, text=v, bg=SURFACE, fg=TEXT, font=("Arial", 15, "bold")).pack(side="right")

        btns = tk.Frame(win, bg=SURFACE)
        btns.pack(fill="x", padx=24, pady=(20, 0))
        replay = tk.Button(
            btns,
            text="↺ REPLAY",
            bg=GREEN,
            fg="#000000",
            relief="flat",
            font=("Arial", 12, "bold"),
            padx=16,
            pady=6,
            command=self._replay_from_modal,
        )
        replay.pack(side="left")
        close = tk.Button(
            btns,
            text="CLOSE",
            bg="#334156",
            fg="#000000",
            relief="flat",
            font=("Arial", 12, "bold"),
            padx=16,
            pady=6,
            command=self._close_game_over,
        )
        close.pack(side="right")

    def _replay_from_modal(self):
        self._on_reset()
        self._close_game_over()

    def _close_game_over(self):
        if self._game_over_modal and self._game_over_modal.winfo_exists():
            self._game_over_modal.destroy()
        self._game_over_modal = None

    def _on_lockdown(self, level):
        self._lock_chip.config(text=f"Lv {level}")
        if self._gov:
            self._gov.set_lockdown(level)

    def _on_mask(self):
        self._mask_chip.config(text="On" if self._mask_var.get() else "Off")
        if self._gov:
            self._gov.set_mask_mandate(self._mask_var.get())

    def _on_vacc(self, val):
        v = int(float(val))
        self._vacc_lbl.config(text=f"{v}%")
        self._vacc_chip.config(text=f"{v}%")
        if self._gov:
            self._gov.set_vaccination_rate(v / 100)

    def _on_stim(self, val):
        v = int(float(val))
        self._stim_lbl.config(text=f"${v}")
        self._stim_chip.config(text=f"${v}")
        if self._gov:
            self._gov.set_stimulus(float(v))

    def _on_speed(self, label):
        self._speed_selected = label
        self._tick_ms = self.SPEEDS[label]
        self._speed_chip.config(text=label)
        for l, b in self._speed_btns.items():
            selected = l == label
            base = ACCENT if selected else "#334156"
            b.config(bg=base, fg="#000" if selected else TEXT_DIM)
            if selected:
                b.unbind("<Enter>")
                b.unbind("<Leave>")
            else:
                self._make_hoverable(
                    b,
                    "#334156",
                    "#425472",
                    should_hover=lambda key=l: key != self._speed_selected,
                )

    def _on_run(self):
        if self._running:
            self._running = False
            if self._after_id:
                self.after_cancel(self._after_id)
            self._run_btn.config(text="▶ RUN", bg=GREEN)
            self._status.config(text="Paused")
        else:
            self._running = True
            self._run_btn.config(text="⏸ PAUSE", bg="#566173")
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
        self._close_game_over()
        self._new_sim()
        self._run_btn.config(text="▶ RUN", bg=GREEN)
        for c in self._charts.values():
            for s in c.series:
                s["data"] = []
            c.redraw()
        self._agent_view.agents_data = None
        self._agent_view.redraw()
        for k in self._kpis.values():
            k.update("—", "")
            k.set_sparkline([])
        self._score_hud.update_score(0)
        self._day.config(text="DAY 0")
        self._hide_warning()
        self._status.config(text="Reset")
        self._lockdown._pick(0)
        self._mask_var.set(False)
        self._on_mask()
        self._vacc_var.set(0)
        self._on_vacc("0")
        self._stim_var.set(0)
        self._on_stim("0")
        self._on_speed("1x")


def run():
    Dashboard().mainloop()


if __name__ == "__main__":
    run()
