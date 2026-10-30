"""Builds the pipeline agents with `create_agent` and wires each one to its MCP tools.

confounder  Nano   biomarker tools (read-only)
analyst     Ultra  biomarker tools (read-only); Nano takes over if Ultra fails
verifier    Nano   no tools; checks the analysis against the screen it is given"""
from __future__ import annotations

from typing import Any

from backend.agents import prompts
from backend.agents.common import build_agent
from backend.logging_setup import get_logger
from backend.mcp_client import ToolBox

log = get_logger("agents.factory")

# The full screen is handed to the agents directly, so they do not need to re-run it.
_DRILL_DOWN_TOOLS_EXCLUDED = ("run_statistical_screen",)


def build_analysis_agents(toolbox: ToolBox, models: dict[str, Any]) -> dict[str, Any]:
    """Create the three agents used by the analysis pipeline."""
    drill_down = toolbox.for_server("biomarkers", exclude=_DRILL_DOWN_TOOLS_EXCLUDED)
    agents = {
        "confounder": build_agent(models["fast"], drill_down, prompts.CONFOUNDER_PROMPT, "confounder_reviewer"),
        "analyst": build_agent(models["analyst"], drill_down, prompts.ANALYST_PROMPT, "analyst"),
        # If the big model is rate-limited or times out, the smaller one finishes the job instead of failing it.
        "analyst_fallback": build_agent(models["fast"], drill_down, prompts.ANALYST_PROMPT, "analyst_fallback"),
        "verifier": build_agent(models["fast"], [], prompts.VERIFIER_PROMPT, "verifier"),
    }
    log.info("Built analysis agents: %s (drill-down tools: %s)", sorted(agents), [t.name for t in drill_down])
    return agents
