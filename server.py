"""
server.py — local web server for the pandemic simulation dashboard.

Serves the HTML dashboard and exposes a JSON API so the browser
can read sim state and send policy commands.

Usage (called automatically from main.py):
    python server.py        # starts on http://localhost:5000
"""

from __future__ import annotations

import json
import os
import threading
import time
import webbrowser
from pathlib import Path
from typing import Optional

from flask import Flask, jsonify, request, send_from_directory, Response

from config import CONFIG
from entities import Government
from simulation import SimulationEngine

# ── App ──────────────────────────────────────────────────────────────────────

app = Flask(__name__, static_folder=str(Path(__file__).parent))

# ── Global simulation state (one sim per server process) ─────────────────────

_sim: Optional[SimulationEngine] = None
_gov: Optional[Government]       = None
_lock = threading.Lock()
_running      = False
_tick_delay   = 0.12   # seconds per tick (matches 1× speed)
_sim_thread: Optional[threading.Thread] = None


def _new_sim() -> None:
    global _sim, _gov
    _gov = Government()
    _sim = SimulationEngine(government=_gov, seed=CONFIG["RANDOM_SEED"])


_new_sim()


# ── Background tick thread ───────────────────────────────────────────────────

def _tick_loop() -> None:
    global _running
    while _running:
        with _lock:
            if _sim and _sim.tick_num < CONFIG["NUM_TICKS"]:
                _sim.tick()
                counts = _sim.agents.state_counts()
                active = counts["infectious_asymptomatic"] + counts["infectious_symptomatic"] + counts["exposed"]
                if active == 0 and _sim.tick_num > 30:
                    _running = False
                    break
            else:
                _running = False
                break
        time.sleep(max(0.005, _tick_delay))


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(str(Path(__file__).parent), "dashboard.html")


@app.route("/state")
def state():
    """Return the latest simulation snapshot as JSON."""
    with _lock:
        if not _sim or not _sim.records:
            return jsonify({"tick": 0, "running": _running, "records": []})

        last = _sim.records[-1]
        # Send last 365 records max (full history for charts)
        records = _sim.records[-365:]
        return jsonify({
            "tick":    _sim.tick_num,
            "running": _running,
            "last":    last,
            "records": records,
            "policy": {
                "lockdown":  _gov.lockdown_level,
                "mask":      _gov.mask_mandate,
                "stimulus":  _gov.stimulus_amount,
                "vacc_rate": _gov.vaccination_rate,
                "debt":      round(_gov.national_debt, 2),
            },
        })


@app.route("/policy", methods=["POST"])
def set_policy():
    """Accept a JSON body with any subset of policy keys and apply them."""
    data = request.get_json(force=True) or {}
    with _lock:
        if _gov is None:
            return jsonify({"ok": False, "error": "No simulation running"})
        if "lockdown" in data:
            _gov.set_lockdown(int(data["lockdown"]))
        if "mask" in data:
            _gov.set_mask_mandate(bool(data["mask"]))
        if "stimulus" in data:
            _gov.set_stimulus(float(data["stimulus"]))
        if "vacc_rate" in data:
            _gov.set_vaccination_rate(float(data["vacc_rate"]))
    return jsonify({"ok": True})


@app.route("/control", methods=["POST"])
def control():
    """Start, pause, reset, or change speed."""
    global _running, _tick_delay, _sim_thread
    data = request.get_json(force=True) or {}
    action = data.get("action", "")

    if action == "start":
        if not _running:
            _running = True
            _sim_thread = threading.Thread(target=_tick_loop, daemon=True)
            _sim_thread.start()

    elif action == "pause":
        _running = False

    elif action == "reset":
        _running = False
        time.sleep(0.15)   # let tick loop exit
        _new_sim()
        # re-apply whatever policy the browser last set
        if "policy" in data:
            p = data["policy"]
            _gov.set_lockdown(p.get("lockdown", 0))
            _gov.set_mask_mandate(p.get("mask", False))
            _gov.set_stimulus(p.get("stimulus", 0.0))
            _gov.set_vaccination_rate(p.get("vacc_rate", 0.0))

    elif action == "speed":
        speeds = {"0.5x": 0.50, "1x": 0.12, "3x": 0.04, "10x": 0.008}
        _tick_delay = speeds.get(data.get("speed", "1x"), 0.12)

    return jsonify({"ok": True, "running": _running})


# ── Entry point ───────────────────────────────────────────────────────────────

def run(open_browser: bool = True, port: int = 5000) -> None:
    if open_browser:
        threading.Timer(0.8, lambda: webbrowser.open(f"http://localhost:{port}")).start()
    app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False, threaded=True)


if __name__ == "__main__":
    run()
