"""Synthetic cohort: four fictional 90-day people, each isolating a case the system must handle.

  arthur_demo  gradual multi-domain decline  -> sustained drift
  mary_demo    healthy and steady            -> stable
  john_demo    healthy, one week of flu      -> not flagged after recovery
  grace_demo   new keyboard on day 50        -> motor metrics shift, the others do not

Generation is deterministic (fixed seeds). Users are stored with is_synthetic=1."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Callable

import numpy as np

from backend import storage
from backend.logging_setup import get_logger
from backend.schemas import METRIC_KEYS, validate_feature_payload

log = get_logger("synthetic")

DEFAULT_DAYS = 90

# (typical value, relative spread BETWEEN days, relative spread BETWEEN sessions)
_BASELINES: dict[str, tuple[float, float, float]] = {
    "median_flight_ms": (190.0, 0.06, 0.04),
    "hold_time_ms": (95.0, 0.05, 0.03),
    "p90_pause_ms": (900.0, 0.10, 0.06),
    "pause_rate": (3.0, 0.15, 0.10),
    "correction_rate": (0.08, 0.12, 0.08),
    "lexical_diversity": (0.62, 0.03, 0.02),
}
_RECALL_BASELINE = 0.90
_RECALL_NOISE = 0.04

Effects = dict[str, float]  # metric -> multiplier applied to its baseline


def _clip(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _effects_healthy(day: int, total: int) -> Effects:
    return {}


def make_declining_effects(scale: float = 1.0, onset: int = 35) -> Callable[[int, int], Effects]:
    """
    Build a gradual-decline pattern. `scale` multiplies every effect (1.0 is the demo "Arthur";
    smaller values are subtler declines, used by the evaluation to find the smallest change detected).
    Memory follows ten days after the other domains.
    """

    def effects(day: int, total: int) -> Effects:
        p = _clip((day - onset) / (total - 1 - onset))
        memory = _clip((day - (onset + 10)) / (total - 1 - (onset + 10)))
        return {
            "median_flight_ms": 1 + 0.40 * scale * p,
            "hold_time_ms": 1 + 0.12 * scale * p,
            "p90_pause_ms": 1 + 0.60 * scale * p,
            "pause_rate": 1 + 0.90 * scale * p,
            "correction_rate": 1 + 0.45 * scale * p,
            "lexical_diversity": 1 - 0.16 * scale * p,
            "recall_score": 1 - 0.22 * scale * memory,
        }

    return effects


_effects_declining = make_declining_effects(1.0)


def _effects_flu(day: int, total: int) -> Effects:
    """A week of illness (days 70-76) that fully recovers afterwards."""
    b = 1.0 if 70 <= day <= 76 else 0.0
    return {
        "median_flight_ms": 1 + 0.25 * b,
        "hold_time_ms": 1 + 0.05 * b,
        "p90_pause_ms": 1 + 0.50 * b,
        "pause_rate": 1 + 0.60 * b,
        "correction_rate": 1 + 0.30 * b,
        "lexical_diversity": 1 - 0.10 * b,
        "recall_score": 1 - 0.12 * b,
    }


def _effects_new_keyboard(day: int, total: int) -> Effects:
    """From day 50 a different keyboard changes mechanical timing only."""
    s = 1.0 if day >= 50 else 0.0
    return {
        "median_flight_ms": 1 + 0.22 * s,
        "hold_time_ms": 1 + 0.28 * s,
        "correction_rate": 1 + 0.08 * s,
    }


@dataclass(frozen=True)
class Persona:
    user_id: str
    display_name: str
    description: str
    seed: int
    effects: Callable[[int, int], Effects]
    expected_at_end: tuple[str, ...]  # acceptable screen outcomes on the last day
    events: tuple[dict, ...] = ()     # ground truth shown in the Time-Travel Lab (1-based day numbers)


PERSONAS: dict[str, Persona] = {
    p.user_id: p
    for p in (
        Persona("arthur_demo", "Arthur (synthetic)",
                "Gradual slowing, shrinking vocabulary and weaker recall over about eight weeks.",
                11, _effects_declining, ("sustained_multi_domain_drift",),
                ({"label": "Gradual change begins", "start_day": 36, "end_day": None},)),
        Persona("mary_demo", "Mary (synthetic)",
                "Healthy and steady throughout.", 22, _effects_healthy, ("stable", "minor_fluctuation")),
        Persona("john_demo", "John (synthetic)",
                "Healthy; a week of flu around day 70 that fully resolves.", 33, _effects_flu, ("stable", "minor_fluctuation"),
                ({"label": "Flu", "start_day": 71, "end_day": 77},)),
        Persona("grace_demo", "Grace (synthetic)",
                "Healthy; switched to a new keyboard on day 50 (mechanical timing changes only).",
                44, _effects_new_keyboard, ("motor_only_change",),
                ({"label": "New keyboard", "start_day": 51, "end_day": None},)),
    )
}


def generate_persona_sessions(
    persona: Persona, start_day: date | None = None, days: int = DEFAULT_DAYS
) -> list[dict]:
    """Produce validated feature payloads for one persona (deterministic)."""
    rng = np.random.default_rng(persona.seed)
    start = start_day or (date.today() - timedelta(days=days - 1))
    sessions: list[dict] = []

    for d in range(days):
        if d > 0 and rng.random() < 0.06:  # a few days with no typing at all
            continue
        current = start + timedelta(days=d)
        effects = persona.effects(d, days)
        day_noise = {m: rng.normal(0, _BASELINES[m][1]) for m in _BASELINES}

        for k in range(int(rng.integers(1, 4))):  # 1-3 typing sessions per day
            payload: dict = {
                "user_id": persona.user_id,
                "session_id": f"{persona.user_id}-{current.isoformat()}-{k}",
                "day": current.isoformat(),
            }
            for metric, (base, _, session_sd) in _BASELINES.items():
                value = base * effects.get(metric, 1.0) * (1 + day_noise[metric]) * (1 + rng.normal(0, session_sd))
                spec_max = 1.0 if metric in ("lexical_diversity", "correction_rate") else 1e9
                payload[metric] = _clip(value, 0.0, spec_max)
            payload["input_mode"] = "keyboard"
            if k == 0:  # one check-in recall score per day
                recall = _RECALL_BASELINE * effects.get("recall_score", 1.0) + rng.normal(0, _RECALL_NOISE)
                payload["recall_score"] = _clip(recall)
            keystrokes = int(rng.integers(400, 2500))
            payload["keystroke_count"] = keystrokes
            payload["word_count"] = int(keystrokes / 5.5)
            sessions.append(validate_feature_payload(payload))  # self-check against the data contract
    return sessions


def seed_demo_users(start_day: date | None = None, days: int = DEFAULT_DAYS,
                    persona_ids: list[str] | None = None) -> dict[str, dict]:
    """(Re)create the synthetic users in the database. Returns a summary per user."""
    summary: dict[str, dict] = {}
    for user_id in persona_ids or list(PERSONAS):
        persona = PERSONAS[user_id]
        storage.delete_user_data(user_id)
        storage.upsert_user(user_id, persona.display_name, persona.user_id, is_synthetic=True)
        sessions = generate_persona_sessions(persona, start_day, days)
        storage.insert_sessions(sessions)
        summary[user_id] = {"display_name": persona.display_name, "description": persona.description,
                            "sessions": len(sessions), "expected_at_end": list(persona.expected_at_end)}
        log.info("Seeded %s with %d sessions", user_id, len(sessions))
    return summary


__all__ = ["PERSONAS", "Persona", "generate_persona_sessions", "seed_demo_users", "METRIC_KEYS"]
