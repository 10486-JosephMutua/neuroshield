"""Deterministic statistics engine. Nothing here calls a model.

Per metric and user:

1. Sessions are collapsed into daily means.
2. Baseline = median and MAD of the first `baseline_days` days. MAD is scaled by 1.4826
   so it matches a standard deviation for normal data but ignores outliers.
3. Worse-direction z-score: the robust z multiplied by the metric's direction, so a
   positive value always means worse than the person's own baseline.
4. Recent shift = mean worse-z over the last `recent_days` days.
5. Weekly trend = Mann-Kendall test and Theil-Sen slope over the last 10 weekly means.
6. CUSUM change-point detector over the daily worse-z series: whether a drift is active
   and when it began.
7. A metric is `sustained_shift` when the recent shift is large, CUSUM is active and the
   excursion began at least 21 days ago. The same signals with a younger onset are
   `acute_shift`.
8. Metrics roll up into four domains (motor, hesitation, linguistic, memory), and the
   domains roll up into one overall signal.

Limitations: the baseline is the first four weeks, so a decline that starts inside that
window is invisible. The thresholds are screening heuristics, not validated clinical
cut-offs."""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import date, timedelta
from typing import Any

import numpy as np

from backend.config import get_settings
from backend.logging_setup import get_logger
from backend.schemas import DOMAINS, METRIC_KEYS, METRIC_SPECS

log = get_logger("stats")

# Screening thresholds. These are heuristics, not validated clinical cut-offs.
MAD_SCALE = 1.4826            # makes MAD comparable to a standard deviation
MAD_FLOOR_FRACTION = 0.03     # never let the spread fall below 3% of the median
SHIFT_Z = 1.5                 # recent shift needed to count as "shifted"
CUSUM_K = 0.5                 # CUSUM slack (ignore drifts smaller than 0.5 z)
CUSUM_H = 5.0                 # CUSUM alarm threshold
CUSUM_CAP = 10.0              # ceiling on the CUSUM statistic (lets an alarm clear after recovery)
CUSUM_Z_CLIP = (-3.0, 4.0)    # winsorise daily z so one extreme day cannot dominate
SUSTAINED_MIN_AGE_DAYS = 21   # a shift older than this is "sustained"
TREND_WEEKS = 10              # weekly buckets used for the trend test
MIN_TREND_WEEKS = 6           # minimum weekly buckets to run the trend test
MIN_BASELINE_POINTS = 10      # minimum baseline days required per metric
PROGRESSION_Z = 0.75          # second-half vs first-half rise => "gradual"

COGNITIVE_DOMAINS = frozenset({"hesitation", "linguistic", "memory"})

# Timing metrics depend on the input device, so they are compared like-for-like.
DEVICE_DEPENDENT_DOMAINS = frozenset({"motor", "hesitation"})


def dominant_input_mode(sessions: list[dict[str, Any]]) -> tuple[str, int]:
    """
    The input mode used in most sessions (keyboard wins ties) and how many
    sessions used a different mode. Sessions with no mode count as keyboard.
    """
    modes = Counter((s.get("input_mode") or "keyboard") for s in sessions if s.get("median_flight_ms") is not None
                    or s.get("p90_pause_ms") is not None or s.get("hold_time_ms") is not None)
    if not modes:
        return "keyboard", 0
    dominant = max(modes, key=lambda m: (modes[m], m == "keyboard"))
    return dominant, sum(n for m, n in modes.items() if m != dominant)


def _r(value: float | None, digits: int = 3) -> float | None:
    """Round for compact, LLM-friendly output (None passes through)."""
    return None if value is None else round(float(value), digits)


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def daily_means(sessions: list[dict[str, Any]], metric: str) -> dict[date, float]:
    """Mean of a metric per calendar day (days without data are absent)."""
    buckets: dict[date, list[float]] = defaultdict(list)
    for session in sessions:
        value = session.get(metric)
        if value is not None:
            buckets[date.fromisoformat(session["day"])].append(float(value))
    return {day: float(np.mean(vals)) for day, vals in sorted(buckets.items())}


def robust_baseline(values: list[float]) -> tuple[float, float]:
    """Return (median, scaled MAD) with a floor so the spread is never ~zero."""
    arr = np.asarray(values, dtype=float)
    median = float(np.median(arr))
    mad = float(np.median(np.abs(arr - median))) * MAD_SCALE
    return median, max(mad, abs(median) * MAD_FLOOR_FRACTION, 1e-6)


def mann_kendall(values: list[float]) -> dict[str, float] | None:
    """
    Mann-Kendall monotonic-trend test (normal approximation, with tie correction).

    Returns tau (-1..1), the z statistic and a two-sided p-value, or None when
    there are too few points.
    """
    y = np.asarray(values, dtype=float)
    n = len(y)
    if n < 3:
        return None
    s = 0.0
    for i in range(n - 1):
        s += float(np.sum(np.sign(y[i + 1:] - y[i])))
    _, counts = np.unique(np.round(y, 10), return_counts=True)
    tie_term = sum(c * (c - 1) * (2 * c + 5) for c in counts if c > 1)
    variance = (n * (n - 1) * (2 * n + 5) - tie_term) / 18.0
    if variance <= 0 or s == 0:
        z = 0.0
    else:
        z = (s - 1) / math.sqrt(variance) if s > 0 else (s + 1) / math.sqrt(variance)
    return {
        "tau": s / (n * (n - 1) / 2.0),
        "z": z,
        "p_value": 2.0 * (1.0 - _norm_cdf(abs(z))),
    }


def theil_sen_slope(values: list[float]) -> float | None:
    """Median of all pairwise slopes (units per index step); robust to outliers."""
    n = len(values)
    if n < 2:
        return None
    slopes = [(values[j] - values[i]) / (j - i) for i in range(n - 1) for j in range(i + 1, n)]
    return float(np.median(slopes))


def cusum_state(series: list[tuple[date, float]]) -> dict[str, Any]:
    """
    One-sided CUSUM on a worse-direction z-series (chronological).

    S_t = min(cap, max(0, S_{t-1} + z_t - k)). The alarm is ACTIVE when the
    final S exceeds h; `onset` is the day the current excursion (continuous run
    of S > 0) began.

    Two safeguards keep the detector honest after a temporary illness: daily z
    values are winsorised, and S is capped. Without them a one-week flu would
    leave the alarm "active" for weeks after full recovery.
    """
    s_value = 0.0
    peak = 0.0
    onset: date | None = None
    for day, z in series:
        previous = s_value
        z = min(max(z, CUSUM_Z_CLIP[0]), CUSUM_Z_CLIP[1])
        s_value = min(CUSUM_CAP, max(0.0, previous + z - CUSUM_K))
        if s_value > 0 and previous == 0:
            onset = day
        if s_value == 0:
            onset = None
        peak = max(peak, s_value)
    active = s_value > CUSUM_H
    return {"active": active, "value": s_value, "peak": peak, "onset": onset if active else None}


def weekly_means(daily: dict[date, float], as_of: date, weeks: int) -> list[dict[str, Any]]:
    """Weekly means for the last `weeks` weeks ending at `as_of` (oldest first)."""
    result = []
    for w in range(weeks - 1, -1, -1):
        end = as_of - timedelta(days=7 * w)
        start = end - timedelta(days=6)
        vals = [v for d, v in daily.items() if start <= d <= end]
        if vals:
            result.append({"week_ending": end.isoformat(), "mean": float(np.mean(vals)), "n_days": len(vals)})
    return result


def window_summary(daily: dict[date, float], start: date, end: date) -> dict[str, Any]:
    """Mean and day-count of a metric between two dates (inclusive)."""
    vals = [v for d, v in daily.items() if start <= d <= end]
    return {
        "start": start.isoformat(), "end": end.isoformat(),
        "n_days": len(vals), "mean": _r(float(np.mean(vals))) if vals else None,
    }


def analyze_metric(
    metric: str,
    daily: dict[date, float],
    first_day: date,
    as_of: date,
    baseline_days: int,
    recent_days: int,
) -> dict[str, Any]:
    """Run the full screen for ONE metric. Returns a JSON-friendly dict."""
    spec = METRIC_SPECS[metric]
    daily = {d: v for d, v in daily.items() if d <= as_of}

    baseline_end = first_day + timedelta(days=baseline_days - 1)
    baseline_values = [v for d, v in daily.items() if d <= baseline_end]
    if len(baseline_values) < MIN_BASELINE_POINTS:
        return {"metric": metric, "domain": spec.domain, "status": "insufficient_baseline",
                "baseline_points": len(baseline_values)}

    median, mad = robust_baseline(baseline_values)
    worse_z = [(d, spec.direction * (v - median) / mad) for d, v in daily.items()]

    recent_start = as_of - timedelta(days=recent_days - 1)
    recent_native = [v for d, v in daily.items() if d >= recent_start]
    recent_z = [z for d, z in worse_z if d >= recent_start]
    recent_mean = float(np.mean(recent_native)) if len(recent_native) >= 3 else None
    recent_shift = float(np.mean(recent_z)) if len(recent_z) >= 3 else None

    weekly = weekly_means(daily, as_of, TREND_WEEKS)
    weekly_values = [w["mean"] for w in weekly]
    mk = mann_kendall(weekly_values) if len(weekly_values) >= MIN_TREND_WEEKS else None
    slope = theil_sen_slope(weekly_values) if mk else None

    cusum = cusum_state(worse_z)
    onset_age = (as_of - cusum["onset"]).days if cusum["onset"] else None

    c_shift = recent_shift is not None and recent_shift >= SHIFT_Z
    c_trend = bool(mk and mk["p_value"] < 0.05 and slope is not None and slope * spec.direction > 0)
    c_cusum = bool(cusum["active"])

    if c_shift and c_cusum and onset_age is not None and onset_age >= SUSTAINED_MIN_AGE_DAYS:
        status = "sustained_shift"
    elif c_shift and c_cusum:
        status = "acute_shift"
    elif c_shift or c_trend or c_cusum:
        status = "watch"
    else:
        status = "stable"

    pattern = None
    if status == "sustained_shift" and cusum["onset"] is not None:
        post = [z for d, z in worse_z if d >= cusum["onset"]]
        if len(post) >= 14:
            half = len(post) // 2
            progression = float(np.mean(post[half:]) - np.mean(post[:half]))
            pattern = "gradual_drift" if progression >= PROGRESSION_Z else "step_change"

    change_pct = None
    if recent_mean is not None and median != 0:
        change_pct = (recent_mean - median) / abs(median) * 100.0

    return {
        "metric": metric,
        "label": spec.label,
        "unit": spec.unit,
        "domain": spec.domain,
        "status": status,
        "pattern": pattern,
        "n_days": len(daily),
        "baseline": {"median": _r(median), "spread": _r(mad), "days": baseline_days},
        "recent": {"mean": _r(recent_mean), "days": recent_days, "change_pct": _r(change_pct, 1),
                   "shift_z": _r(recent_shift, 2)},
        "trend": {
            "weeks": len(weekly_values),
            "slope_per_week": _r(slope),
            "tau": _r(mk["tau"], 2) if mk else None,
            "p_value": _r(mk["p_value"], 4) if mk else None,
        },
        "cusum": {
            "active": c_cusum, "value": _r(cusum["value"], 2),
            "onset": cusum["onset"].isoformat() if cusum["onset"] else None,
            "onset_age_days": onset_age,
        },
        "criteria": {"shifted": c_shift, "trend_worsening": c_trend, "cusum_active": c_cusum},
    }


def run_screen(sessions: list[dict[str, Any]], as_of: str | None = None) -> dict[str, Any]:
    """
    Screen every metric for one user and roll the results up into one signal.

    `overall_signal` is one of:
      insufficient_data | stable | minor_fluctuation | acute_change |
      motor_only_change | single_domain_drift | sustained_multi_domain_drift
    """
    settings = get_settings()
    if not sessions:
        return {"overall_signal": "insufficient_data", "reason": "no data", "metrics": {}, "domains": {}}

    days = sorted({date.fromisoformat(s["day"]) for s in sessions})
    first_day = days[0]
    input_mode, mixed_out = dominant_input_mode(sessions)
    # Motor and hesitation metrics use only sessions from the dominant input device.
    timing_sessions = [s for s in sessions if (s.get("input_mode") or "keyboard") == input_mode
                       or s.get("median_flight_ms") is None and s.get("p90_pause_ms") is None
                       and s.get("hold_time_ms") is None]
    as_of_date = date.fromisoformat(as_of) if as_of else days[-1]
    history_days = (as_of_date - first_day).days + 1

    base = {
        "as_of": as_of_date.isoformat(),
        "first_day": first_day.isoformat(),
        "history_days": history_days,
        "active_days": len([d for d in days if d <= as_of_date]),
        "input_mode": input_mode,
        "sessions_excluded_other_device": mixed_out,
        "parameters": {
            "baseline_days": settings.baseline_days, "recent_days": settings.recent_days,
            "shift_z": SHIFT_Z, "cusum_k": CUSUM_K, "cusum_h": CUSUM_H,
            "sustained_min_age_days": SUSTAINED_MIN_AGE_DAYS,
        },
    }

    if history_days < settings.min_history_days:
        log.info("Screen: insufficient history (%d < %d days)", history_days, settings.min_history_days)
        return {**base, "overall_signal": "insufficient_data",
                "reason": f"needs at least {settings.min_history_days} days of history",
                "metrics": {}, "domains": {}, "sustained_domains": [], "acute_domains": []}

    metrics: dict[str, Any] = {}
    for metric in METRIC_KEYS:
        source = timing_sessions if METRIC_SPECS[metric].domain in DEVICE_DEPENDENT_DOMAINS else sessions
        daily = daily_means(source, metric)
        if not daily:
            continue
        metrics[metric] = analyze_metric(metric, daily, first_day, as_of_date,
                                         settings.baseline_days, settings.recent_days)

    domains: dict[str, Any] = {}
    for domain in DOMAINS:
        members = [m for m in metrics.values() if m["domain"] == domain and m["status"] != "insufficient_baseline"]
        if not members:
            continue
        statuses = {m["status"] for m in members}
        if "sustained_shift" in statuses:
            domain_status = "sustained_shift"
        elif "acute_shift" in statuses:
            domain_status = "acute_shift"
        elif "watch" in statuses:
            domain_status = "watch"
        else:
            domain_status = "stable"
        domains[domain] = {"status": domain_status, "metrics": [m["metric"] for m in members]}

    sustained = sorted(d for d, v in domains.items() if v["status"] == "sustained_shift")
    acute = sorted(d for d, v in domains.items() if v["status"] == "acute_shift")
    watching = [d for d, v in domains.items() if v["status"] == "watch"]

    if len(set(sustained) & COGNITIVE_DOMAINS) >= 2:
        overall = "sustained_multi_domain_drift"
    elif sustained and set(sustained) == {"motor"}:
        overall = "motor_only_change"
    elif sustained:
        overall = "single_domain_drift"
    elif acute:
        overall = "acute_change"
    elif watching:
        overall = "minor_fluctuation"
    else:
        overall = "stable"

    log.info("Screen complete: as_of=%s overall=%s sustained=%s acute=%s",
             base["as_of"], overall, sustained, acute)
    return {**base, "overall_signal": overall, "sustained_domains": sustained, "acute_domains": acute,
            "domains": domains, "metrics": metrics}
