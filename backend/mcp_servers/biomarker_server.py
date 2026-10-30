"""Biomarker MCP server.

Exposes the statistics engine as tools, so every number an agent receives comes from
backend/stats.py.

Tools: list_metrics, get_data_coverage, run_statistical_screen,
       get_metric_weekly_series, compare_windows

Run:  python -m backend.mcp_servers.biomarker_server"""
from __future__ import annotations

from datetime import date, timedelta

from fastmcp import FastMCP

from backend import stats, storage
from backend.config import get_settings
from backend.mcp_servers.common import logged_tool, serve
from backend.schemas import METRIC_SPECS, metric_catalogue

SERVER_NAME = "biomarkers"
mcp = FastMCP(SERVER_NAME)


def _resolve_as_of(user_id: str, as_of: str | None) -> str:
    """Default `as_of` to the user's most recent day of data."""
    if as_of:
        return date.fromisoformat(as_of).isoformat()
    latest = storage.latest_day(user_id)
    if latest is None:
        raise ValueError(f"no data stored for user '{user_id}'")
    return latest


def _require_metric(metric: str) -> None:
    if metric not in METRIC_SPECS:
        raise ValueError(f"unknown metric '{metric}'. Valid: {sorted(METRIC_SPECS)}")


@mcp.tool
@logged_tool(SERVER_NAME)
def list_metrics() -> dict:
    """List every tracked metric with its unit, domain and which direction is worse."""
    return {"metrics": metric_catalogue()}


@mcp.tool
@logged_tool(SERVER_NAME)
def get_data_coverage(user_id: str, as_of: str | None = None) -> dict:
    """How much history exists for a user (first day, last day, active days, sessions)."""
    as_of_day = _resolve_as_of(user_id, as_of)
    sessions = storage.fetch_sessions(user_id, as_of_day)
    days = sorted({s["day"] for s in sessions})
    return {
        "user_id": user_id,
        "as_of": as_of_day,
        "first_day": days[0] if days else None,
        "last_day": days[-1] if days else None,
        "active_days": len(days),
        "sessions": len(sessions),
    }


@mcp.tool
@logged_tool(SERVER_NAME)
def run_statistical_screen(user_id: str, as_of: str | None = None) -> dict:
    """
    Run the deterministic screen for a user: per-metric baseline, recent shift,
    weekly trend and change-point status, plus an overall triage signal.
    `as_of` (YYYY-MM-DD) lets you evaluate the user as they were on an earlier day.
    """
    as_of_day = _resolve_as_of(user_id, as_of)
    return stats.run_screen(storage.fetch_sessions(user_id, as_of_day), as_of_day)


@mcp.tool
@logged_tool(SERVER_NAME)
def get_metric_weekly_series(user_id: str, metric: str, as_of: str | None = None, weeks: int = 12) -> dict:
    """Weekly means of one metric for the last `weeks` weeks (oldest first)."""
    _require_metric(metric)
    weeks = max(2, min(int(weeks), 26))
    as_of_day = _resolve_as_of(user_id, as_of)
    daily = stats.daily_means(storage.fetch_sessions(user_id, as_of_day), metric)
    series = stats.weekly_means(daily, date.fromisoformat(as_of_day), weeks)
    return {
        "user_id": user_id, "metric": metric, "unit": METRIC_SPECS[metric].unit, "as_of": as_of_day,
        "weekly": [{"week_ending": w["week_ending"], "mean": round(w["mean"], 3), "n_days": w["n_days"]}
                   for w in series],
    }


@mcp.tool
@logged_tool(SERVER_NAME)
def compare_windows(user_id: str, metric: str, as_of: str | None = None, recent_days: int = 14) -> dict:
    """Compare a metric's mean in the last `recent_days` days against the user's baseline window."""
    _require_metric(metric)
    recent_days = max(3, min(int(recent_days), 60))
    settings = get_settings()
    as_of_day = date.fromisoformat(_resolve_as_of(user_id, as_of))
    sessions = storage.fetch_sessions(user_id, as_of_day.isoformat())
    if not sessions:
        raise ValueError(f"no data stored for user '{user_id}'")
    first_day = date.fromisoformat(sessions[0]["day"])
    daily = stats.daily_means(sessions, metric)
    baseline = stats.window_summary(daily, first_day, first_day + timedelta(days=settings.baseline_days - 1))
    recent = stats.window_summary(daily, as_of_day - timedelta(days=recent_days - 1), as_of_day)
    change_pct = None
    if baseline["mean"] and recent["mean"] is not None:
        change_pct = round((recent["mean"] - baseline["mean"]) / abs(baseline["mean"]) * 100, 1)
    return {"user_id": user_id, "metric": metric, "unit": METRIC_SPECS[metric].unit,
            "baseline_window": baseline, "recent_window": recent, "change_pct": change_pct}


if __name__ == "__main__":
    serve(mcp, SERVER_NAME, get_settings().biomarker_port)
