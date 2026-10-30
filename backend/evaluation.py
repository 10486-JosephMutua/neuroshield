"""Evaluation benchmark for the deterministic screen.

Simulates hundreds of fictional people (backend/synthetic.py) and measures:

1. False alarms: how often healthy people are flagged with a sustained change.
2. Detection: how often a gradual decline is caught, by strength, and the delay after onset.
3. Confounders: whether a week of flu or a new keyboard is kept apart from a real decline.

The data is synthetic and comes from the same family of models the thresholds were
tuned on, so the figures are optimistic and say nothing about real patients.

Run:  python scripts/run_evaluation.py   (writes data/evaluation.json, served at /api/evaluation)"""
from __future__ import annotations

import math
import statistics
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

from backend import stats
from backend.logging_setup import get_logger
from backend.synthetic import (Persona, _effects_flu, _effects_healthy, _effects_new_keyboard,
                               generate_persona_sessions, make_declining_effects)

log = get_logger("evaluation")

START = date(2026, 1, 1)
DAYS = 90
ONSET_DAY = 36  # first day (1-based) on which the simulated decline is present
FLAGGED = {"sustained_multi_domain_drift", "single_domain_drift", "motor_only_change"}
DECLINE_SCALES = ((0.25, "Very subtle"), (0.5, "Subtle"), (0.75, "Moderate"), (1.0, "Demo strength"))


def wilson(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% Wilson score interval for a proportion (honest about small samples)."""
    if n == 0:
        return 0.0, 0.0
    p = successes / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def _rate(successes: int, n: int) -> dict[str, Any]:
    low, high = wilson(successes, n)
    return {"count": successes, "of": n, "rate": round(successes / n, 4) if n else 0.0,
            "ci95": [round(low, 4), round(high, 4)]}


def _screen_at(sessions: list[dict], day_number: int) -> dict[str, Any]:
    as_of = (START + timedelta(days=day_number - 1)).isoformat()
    return stats.run_screen([s for s in sessions if s["day"] <= as_of], as_of)


def _person(seed: int, effects: Callable[[int, int], dict]) -> list[dict]:
    persona = Persona("bench", "bench", "", seed, effects, ())
    return generate_persona_sessions(persona, START, DAYS)


def healthy_false_alarms(people: int) -> dict[str, Any]:
    checkpoints = (50, 60, 70, 80, 90)
    ever_flagged = flagged_checks = 0
    for i in range(people):
        sessions = _person(10_000 + i, _effects_healthy)
        results = [_screen_at(sessions, d)["overall_signal"] in FLAGGED for d in checkpoints]
        ever_flagged += any(results)
        flagged_checks += sum(results)
    return {"people": people, "checkpoint_days": list(checkpoints),
            "people_ever_flagged": _rate(ever_flagged, people),
            "checkpoints_flagged": _rate(flagged_checks, people * len(checkpoints))}


def decline_detection(people: int) -> list[dict[str, Any]]:
    checkpoints = list(range(42, DAYS + 1, 3))
    rows = []
    for scale, label in DECLINE_SCALES:
        effects = make_declining_effects(scale, onset=ONSET_DAY - 1)
        detected, delays = 0, []
        for i in range(people):
            sessions = _person(20_000 + i, effects)
            hit = next((d for d in checkpoints if _screen_at(sessions, d)["overall_signal"] == "sustained_multi_domain_drift"), None)
            if hit is not None:
                detected += 1
                delays.append(hit - ONSET_DAY)
        rows.append({"scale": scale, "label": label, "people": people, "detected": _rate(detected, people),
                     "median_delay_days": statistics.median(delays) if delays else None,
                     "p90_delay_days": (sorted(delays)[min(len(delays) - 1, int(0.9 * len(delays)))] if delays else None)})
    return rows


def flu_handling(people: int) -> dict[str, Any]:
    during = acute = after = 0
    for i in range(people):
        sessions = _person(30_000 + i, _effects_flu)
        mid = _screen_at(sessions, 74)["overall_signal"]
        during += mid == "sustained_multi_domain_drift"
        acute += mid == "acute_change"
        after += _screen_at(sessions, 90)["overall_signal"] in FLAGGED
    return {"people": people, "mid_illness_day": 74, "recovered_day": 90,
            "mistaken_for_decline_during_illness": _rate(during, people),
            "recognised_as_acute_during_illness": _rate(acute, people),
            "flagged_after_recovery": _rate(after, people)}


def keyboard_handling(people: int) -> dict[str, Any]:
    motor_only = wrongly_cognitive = 0
    for i in range(people):
        signal = _screen_at(_person(40_000 + i, _effects_new_keyboard), 90)["overall_signal"]
        motor_only += signal == "motor_only_change"
        wrongly_cognitive += signal == "sustained_multi_domain_drift"
    return {"people": people, "day": 90, "recognised_as_mechanical_only": _rate(motor_only, people),
            "mistaken_for_cognitive_change": _rate(wrongly_cognitive, people)}


def run_benchmark(healthy: int = 60, per_scale: int = 30, confounder: int = 30) -> dict[str, Any]:
    """Run the whole benchmark (about half a minute) and return a JSON-friendly report."""
    started = time.perf_counter()
    log.info("Benchmark started: healthy=%d per_scale=%d confounder=%d", healthy, per_scale, confounder)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "synthetic": True,
        "parameters": {"days": DAYS, "decline_onset_day": ONSET_DAY, "healthy_people": healthy,
                       "people_per_decline_strength": per_scale, "people_per_confounder": confounder,
                       "flagged_signals": sorted(FLAGGED), "baseline_days": 28,
                       "thresholds": {"shift_z": stats.SHIFT_Z, "cusum_k": stats.CUSUM_K, "cusum_h": stats.CUSUM_H,
                                      "sustained_min_age_days": stats.SUSTAINED_MIN_AGE_DAYS}},
        "healthy": healthy_false_alarms(healthy),
        "decline": decline_detection(per_scale),
        "flu": flu_handling(confounder),
        "keyboard": keyboard_handling(confounder),
        "caveats": [
            "All people are simulated. The simulator and the thresholds were developed together, so these results are optimistic.",
            "Real typing is messier than this simulation; real-world accuracy has not been measured.",
            "Detection is of a sustained change from a person's own baseline, not of any disease.",
            "Confidence intervals are 95% Wilson intervals and reflect only the number of simulated people.",
        ],
    }
    report["seconds"] = round(time.perf_counter() - started, 1)
    log.info("Benchmark finished in %.1fs", report["seconds"])
    return report
