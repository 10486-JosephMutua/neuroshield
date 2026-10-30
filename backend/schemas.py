"""Data contract: what may leave the user's device.

Only numeric features and three strictly validated identifiers (user_id, session_id,
day) are accepted. Unknown fields are rejected, the identifiers must match regular
expressions that cannot hold a sentence, and every metric is range-checked.

Also holds the metric catalogue: units, which direction is worse, and the domain of
each metric."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import date
from typing import Any

@dataclass(frozen=True)
class MetricSpec:
    key: str
    label: str
    unit: str
    worse_when: str  # "higher" or "lower"
    domain: str      # "motor" | "hesitation" | "linguistic" | "memory"
    minimum: float
    maximum: float
    description: str

    @property
    def direction(self) -> int:
        """+1 if a HIGHER value is worse, -1 if a LOWER value is worse."""
        return 1 if self.worse_when == "higher" else -1


METRIC_SPECS: dict[str, MetricSpec] = {
    spec.key: spec
    for spec in (
        MetricSpec("median_flight_ms", "Median flight time", "ms", "higher", "motor", 20, 2000,
                   "Median time between releasing one key and pressing the next."),
        MetricSpec("hold_time_ms", "Median key hold time", "ms", "higher", "motor", 10, 1000,
                   "Median time a key is held down."),
        MetricSpec("p90_pause_ms", "90th-percentile inter-key pause", "ms", "higher", "hesitation", 50, 20000,
                   "Length of the longer pauses between keystrokes (word-finding hesitation)."),
        MetricSpec("pause_rate", "Long pauses per 100 keystrokes", "per 100 keys", "higher", "hesitation", 0, 100,
                   "How often typing stops for more than two seconds."),
        MetricSpec("correction_rate", "Correction rate", "fraction", "higher", "hesitation", 0, 1,
                   "Share of keystrokes that are backspace/delete."),
        MetricSpec("lexical_diversity", "Lexical diversity", "0-1", "lower", "linguistic", 0, 1,
                   "Moving-average type/token ratio, computed ON the device."),
        MetricSpec("recall_score", "Delayed-recall score", "0-1", "lower", "memory", 0, 1,
                   "Score from the daily check-in question about yesterday's plan."),
    )
}
METRIC_KEYS: tuple[str, ...] = tuple(METRIC_SPECS)
DOMAINS: tuple[str, ...] = ("motor", "hesitation", "linguistic", "memory")

# Typing on a physical keyboard and on a touch screen produce different timing, so each
# session says which it was and the statistics never mix the two (see backend/stats.py).
INPUT_MODES: tuple[str, ...] = ("keyboard", "touch")

# Fields a client may send. Anything else is rejected.
_COUNT_FIELDS = ("keystroke_count", "word_count")
ALLOWED_FIELDS: frozenset[str] = frozenset(
    ("user_id", "session_id", "day", "input_mode", *METRIC_KEYS, *_COUNT_FIELDS)
)

_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class PayloadError(ValueError):
    """Raised when a payload violates the data contract."""


def _validate_id(name: str, value: Any) -> str:
    if not isinstance(value, str) or not _ID_PATTERN.match(value):
        raise PayloadError(f"'{name}' must match {_ID_PATTERN.pattern}")
    return value


def validate_feature_payload(raw: Any) -> dict[str, Any]:
    """
    Validate and normalise one feature payload.

    Returns a clean dict containing only contract fields. Error messages name
    the offending FIELD but never echo its VALUE (values could be text).
    """
    if not isinstance(raw, dict):
        raise PayloadError("payload must be a JSON object")

    unknown = sorted(set(raw) - ALLOWED_FIELDS)
    if unknown:
        raise PayloadError(f"unknown fields rejected by privacy wall: {unknown}")

    clean: dict[str, Any] = {
        "user_id": _validate_id("user_id", raw.get("user_id")),
        "session_id": _validate_id("session_id", raw.get("session_id")),
    }

    day_raw = raw.get("day")
    try:
        clean["day"] = date.fromisoformat(day_raw).isoformat() if isinstance(day_raw, str) else None
    except ValueError:
        clean["day"] = None
    if clean["day"] is None:
        raise PayloadError("'day' must be an ISO date (YYYY-MM-DD)")

    mode = raw.get("input_mode")
    if mode is not None and mode not in INPUT_MODES:
        raise PayloadError(f"'input_mode' must be one of {list(INPUT_MODES)}")
    clean["input_mode"] = mode

    metrics_present = 0
    for key, spec in METRIC_SPECS.items():
        if raw.get(key) is None:
            clean[key] = None
            continue
        value = raw[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise PayloadError(f"'{key}' must be a finite number")
        if not spec.minimum <= value <= spec.maximum:
            raise PayloadError(f"'{key}' outside allowed range [{spec.minimum}, {spec.maximum}]")
        clean[key] = float(value)
        metrics_present += 1

    if metrics_present == 0:
        raise PayloadError("payload must contain at least one metric")

    for key in _COUNT_FIELDS:
        value = raw.get(key)
        if value is None:
            clean[key] = None
        elif isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100_000:
            raise PayloadError(f"'{key}' must be an integer between 0 and 100000")
        else:
            clean[key] = value

    return clean


def metric_catalogue() -> list[dict[str, Any]]:
    """JSON-friendly description of every metric (served to agents and the UI)."""
    return [
        {
            "key": s.key, "label": s.label, "unit": s.unit, "domain": s.domain,
            "worse_when": s.worse_when, "description": s.description,
        }
        for s in METRIC_SPECS.values()
    ]
