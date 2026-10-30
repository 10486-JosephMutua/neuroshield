"""Report MCP server: assembles the one-page clinician report.

Numbers, thresholds and limitations come from code. The model only supplies the
verified narrative.

Tools: get_limitations, build_clinician_report

Run:  python -m backend.mcp_servers.report_server"""
from __future__ import annotations

from datetime import date

from fastmcp import FastMCP

from backend import stats, storage
from backend.config import get_settings
from backend.mcp_servers.common import logged_tool, serve
from backend.schemas import METRIC_SPECS

SERVER_NAME = "report"
mcp = FastMCP(SERVER_NAME)

DISCLAIMER = (
    "This report is a screening-support summary of typing and check-in patterns compared with "
    "this person's own baseline. It is NOT a diagnosis and must not be used as one."
)

LIMITATIONS = [
    "The personal baseline is the first four weeks of data; changes that began inside that window cannot be detected.",
    "Thresholds are screening heuristics and have not been clinically validated.",
    "Typing patterns are affected by tiredness, illness, medication, mood, device changes and posture.",
    "A single check-in recall score is noisy; only the trend over weeks is informative.",
    "Findings should be interpreted by a qualified clinician alongside a standard cognitive assessment.",
]


@mcp.tool
@logged_tool(SERVER_NAME)
def get_limitations() -> dict:
    """Return the standing disclaimer and limitations that accompany every report."""
    return {"disclaimer": DISCLAIMER, "limitations": LIMITATIONS}


@mcp.tool
@logged_tool(SERVER_NAME)
def build_clinician_report(user_id: str, as_of: str, narrative: dict) -> dict:
    """
    Build the structured clinician report for `user_id` as of `as_of` (YYYY-MM-DD).

    `narrative` carries the verified language-model text:
    {clinician_summary, confidence, recommendation, confounders_considered, references}.
    `references` are background-reading links found by search; they are not part of the analysis.
    """
    as_of_day = date.fromisoformat(as_of).isoformat()
    user = storage.get_user(user_id) or {}
    screen = stats.run_screen(storage.fetch_sessions(user_id, as_of_day), as_of_day)

    rows = []
    for key, metric in screen.get("metrics", {}).items():
        if metric.get("status") == "insufficient_baseline":
            continue
        spec = METRIC_SPECS[key]
        rows.append({
            "metric": spec.label, "unit": spec.unit, "domain": spec.domain,
            "baseline_median": metric["baseline"]["median"],
            "recent_mean": metric["recent"]["mean"],
            "change_pct": metric["recent"]["change_pct"],
            "status": metric["status"],
        })

    return {
        "title": "Cognitive-pattern screening summary",
        "subject": {"user_id": user_id, "display_name": user.get("display_name"),
                    "synthetic_data": bool(user.get("is_synthetic"))},
        "window": {"as_of": as_of_day, "first_day": screen.get("first_day"),
                   "history_days": screen.get("history_days"), "active_days": screen.get("active_days")},
        "overall_signal": screen.get("overall_signal"),
        "metrics_table": rows,
        "narrative": {
            "clinician_summary": narrative.get("clinician_summary", ""),
            "confidence": narrative.get("confidence"),
            "recommendation": narrative.get("recommendation"),
            "confounders_considered": narrative.get("confounders_considered", []),
        },
        "references": narrative.get("references", []),
        "disclaimer": DISCLAIMER,
        "limitations": LIMITATIONS,
    }


if __name__ == "__main__":
    serve(mcp, SERVER_NAME, get_settings().report_port)
