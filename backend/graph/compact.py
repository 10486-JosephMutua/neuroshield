"""Shrinks the statistical screen before it is sent to a model.

Stable metrics keep only their label and size of change. Shifted metrics keep every
number an explanation could cite. Internal parameters are dropped. This cuts tokens and
latency; verification still runs against the full screen."""
from __future__ import annotations

import json
from typing import Any

_TOP_LEVEL = ("as_of", "history_days", "active_days", "input_mode", "overall_signal", "sustained_domains",
              "acute_domains")


def _compact_metric(m: dict[str, Any]) -> dict[str, Any]:
    if m.get("status") in ("stable", "insufficient_baseline"):
        recent = m.get("recent") or {}
        return {"label": m.get("label"), "domain": m.get("domain"), "status": m.get("status"),
                "change_pct": recent.get("change_pct")}
    return {
        "label": m.get("label"), "unit": m.get("unit"), "domain": m.get("domain"), "status": m["status"],
        "pattern": m.get("pattern"),
        "baseline": {"median": m["baseline"]["median"]},
        "recent": {"mean": m["recent"]["mean"], "change_pct": m["recent"]["change_pct"],
                   "shift_z": m["recent"]["shift_z"]},
        "trend": {"slope_per_week": m["trend"]["slope_per_week"], "p_value": m["trend"]["p_value"]},
        "cusum": {"onset": m["cusum"]["onset"], "onset_age_days": m["cusum"]["onset_age_days"]},
    }


def compact_screen(screen: dict[str, Any]) -> dict[str, Any]:
    """A model-sized view of the screen with the same field names the prompts describe."""
    out = {k: screen[k] for k in _TOP_LEVEL if k in screen}
    out["domains"] = {d: v["status"] for d, v in screen.get("domains", {}).items()}
    out["metrics"] = {k: _compact_metric(m) for k, m in screen.get("metrics", {}).items()}
    return out


def to_prompt_json(payload: dict[str, Any]) -> str:
    """Serialise without spaces: pure waste when a model is billed per token."""
    return json.dumps(payload, separators=(",", ":"))
