"""Builds, compiles and runs the LangGraph pipeline.

run_analysis is the entry point used by Flask and the CLI. It opens the MCP toolbox,
builds the agents, runs the graph with a usage tracker attached, saves the result and
returns what the UI needs."""
from __future__ import annotations

import hashlib
import uuid
from typing import Any, Callable

from langgraph.graph import END, START, StateGraph

from backend import storage
from backend.agents.factory import build_analysis_agents
from backend.graph.nodes import PipelineNodes
from backend.graph.state import PipelineState
from backend.config import get_settings
from backend.llm import UsageTracker, get_chat_model
from backend.logging_setup import get_logger, log_step
from backend.mcp_client import ToolBox, open_toolbox

log = get_logger("pipeline")

# Bump when prompts, policy or the pipeline change, so old cached analyses are not reused.
PIPELINE_VERSION = "2"


class UnknownUserError(LookupError):
    """Raised when asked to analyse a user that has no stored data."""


def build_graph(toolbox: ToolBox, models: dict[str, Any]):
    """Wire the nodes and edges, and compile the graph."""
    nodes = PipelineNodes(toolbox, build_analysis_agents(toolbox, models), models["fast"])

    graph = StateGraph(PipelineState)
    graph.add_node("load_screen", nodes.load_screen)
    graph.add_node("template_summary", nodes.template_summary)
    graph.add_node("confounder_review", nodes.confounder_review)
    graph.add_node("analyst", nodes.analyst)
    graph.add_node("verify", nodes.verify)
    graph.add_node("safety_guard", nodes.safety_guard)
    graph.add_node("fallback_summary", nodes.fallback_summary)
    graph.add_node("build_report", nodes.build_report)

    graph.add_edge(START, "load_screen")
    graph.add_conditional_edges("load_screen", nodes.route_after_screen,
                                {"confounder_review": "confounder_review", "template_summary": "template_summary"})
    graph.add_edge("confounder_review", "analyst")
    graph.add_edge("analyst", "verify")
    graph.add_conditional_edges("verify", nodes.route_after_verify,
                                {"safety_guard": "safety_guard", "analyst": "analyst",
                                 "fallback_summary": "fallback_summary"})
    for terminal in ("template_summary", "safety_guard", "fallback_summary"):
        graph.add_edge(terminal, "build_report")
    graph.add_edge("build_report", END)
    return graph.compile()


def graph_diagram(toolbox: ToolBox, models: dict[str, Any]) -> str:
    """Mermaid source of the compiled graph (handy for the README and the UI)."""
    return build_graph(toolbox, models).get_graph().draw_mermaid()


def cache_fingerprint(user_id: str, as_of: str | None) -> tuple[str, str]:
    """(resolved as_of day, fingerprint). Same person + day + data + models + pipeline => same answer."""
    day = as_of or storage.latest_day(user_id) or ""
    settings = get_settings()
    raw = f"{PIPELINE_VERSION}|{settings.model_analyst}|{settings.model_fast}|{day}|{storage.data_fingerprint(user_id, day)}"
    return day, hashlib.sha256(raw.encode()).hexdigest()[:20]


@log_step("analysis pipeline")
async def run_analysis(user_id: str, as_of: str | None = None, models: dict[str, Any] | None = None,
                       on_event: Callable[[dict[str, Any]], None] | None = None,
                       use_cache: bool = False) -> dict[str, Any]:
    """
    Run the full analysis for one user and return the result.

    `as_of` (YYYY-MM-DD) analyses the user as they were on that day, which is how
    the demo "time-travels" through a synthetic 90-day history.
    `models` may inject {"analyst": ..., "fast": ...} (used by the offline tests).
    `on_event` is called with each trace event the moment a node finishes, which is how
    background jobs report live progress.
    `use_cache=True` returns a stored run instead of calling the models again when the same
    person, day, data and models have already been analysed successfully.
    """
    if storage.latest_day(user_id) is None:
        raise UnknownUserError(f"no data stored for user '{user_id}'")

    day, fingerprint = cache_fingerprint(user_id, as_of)
    if use_cache and get_settings().analysis_cache:
        hit = storage.find_run_by_fingerprint(user_id, day, fingerprint)
        if hit:
            log.info("Cache hit for user=%s as_of=%s (run %s): no model calls needed", user_id, day, hit["run_id"])
            for event in hit.get("trace", []):
                if on_event:
                    on_event(event)
            return {**hit, "cached": True}

    run_id = uuid.uuid4().hex[:12]
    tracker = UsageTracker()
    models = models or {"analyst": get_chat_model("analyst"), "fast": get_chat_model("fast")}
    log.info("Run %s: analysing user=%s as_of=%s", run_id, user_id, as_of)

    async with open_toolbox() as toolbox:
        graph = build_graph(toolbox, models)
        state: dict[str, Any] = {}
        seen = 0
        # stream_mode="values" yields the full state after every step, so we can
        # report each newly finished node while still ending with the final state.
        async for state in graph.astream(
            {"user_id": user_id, "as_of": as_of, "trace": []},
            config={"callbacks": [tracker], "recursion_limit": 40},
            stream_mode="values",
        ):
            events = state.get("trace", [])
            for event in events[seen:]:
                if on_event:
                    on_event(event)
            seen = len(events)

    result = {
        "run_id": run_id,
        "user_id": user_id,
        "as_of": state["as_of"],
        "screen": state["screen"],
        "final": state["final"],
        "report": state["report"],
        "trace": state["trace"],
        "usage": tracker.summary(),
        "fingerprint": fingerprint,
        "cached": False,
    }
    storage.save_analysis(run_id, user_id, state["as_of"], result)
    log.info("Run %s complete: signal=%s recommendation=%s verification=%s cost=$%.5f", run_id,
             state["final"]["overall_signal"], state["final"]["recommendation"],
             state["final"]["verification_status"], result["usage"]["total_cost_usd"])
    return result
