"""Graph nodes.

    load_screen ─┬─(calm signal)──────────────► template_summary ─┐
                 └─(something to explain)─► confounder_review      │
                                                  │                │
                                                analyst ◄──────────┼── revise (max N attempts)
                                                  │                │
                                                verify ──pass──► safety_guard ─┤
                                                  └─give up──► fallback_summary ┤
                                                                               ▼
                                                                         build_report ─► END

confounder_review, analyst and verify use agents. Every other node is deterministic code,
and calm signals never reach a model."""
from __future__ import annotations

import json
import time
from typing import Any

from langchain_core.runnables import RunnableConfig

from backend.agents.common import run_json_agent
from backend.agents.schemas import AnalystReport, ConfounderReport, VerifierReport
from backend.config import get_settings
from backend.graph.compact import compact_screen, to_prompt_json
from backend.graph.state import PipelineState
from backend.guardrails import (
    build_template_final,
    check_analysis_against_screen,
    policy_for,
    recommendation_rank,
    sanitize_patient_message,
)
from backend.logging_setup import get_logger, log_step
from backend.mcp_client import ToolBox

log = get_logger("graph")


def _event(node: str, started: float, status: str = "ok", **detail: Any) -> dict[str, Any]:
    """Build one trace event (shown in the UI timeline and in the logs)."""
    return {"node": node, "status": status, "duration_ms": round((time.perf_counter() - started) * 1000), **detail}


class PipelineNodes:
    """Holds the dependencies (tools, agents, models) every node needs."""

    def __init__(self, toolbox: ToolBox, agents: dict[str, Any], repair_model: Any):
        self.toolbox = toolbox
        self.agents = agents
        self.repair_model = repair_model
        self.max_attempts = get_settings().max_verify_attempts


    @log_step("node: load_screen")
    async def load_screen(self, state: PipelineState) -> dict[str, Any]:
        """Ask the biomarker MCP server for the deterministic screen."""
        started = time.perf_counter()
        screen = await self.toolbox.call("biomarkers", "run_statistical_screen",
                                         user_id=state["user_id"], as_of=state.get("as_of"))
        log.info("Screen for %s: overall=%s sustained=%s acute=%s", state["user_id"],
                 screen.get("overall_signal"), screen.get("sustained_domains"), screen.get("acute_domains"))
        return {"screen": screen, "as_of": screen.get("as_of"), "attempts": 0,
                "trace": [_event("load_screen", started, overall_signal=screen.get("overall_signal"))]}

    def route_after_screen(self, state: PipelineState) -> str:
        """Calm signals use a template (no model cost, no risk); the rest get the agents."""
        use_llm = policy_for(state["screen"].get("overall_signal", "")).use_llm
        route = "confounder_review" if use_llm else "template_summary"
        log.info("Routing after screen -> %s", route)
        return route

    @log_step("node: template_summary")
    async def template_summary(self, state: PipelineState) -> dict[str, Any]:
        started = time.perf_counter()
        final = build_template_final(state["screen"], status="template")
        return {"final": final, "trace": [_event("template_summary", started, note="no model call needed")]}

    @log_step("node: confounder_review")
    async def confounder_review(self, state: PipelineState, config: RunnableConfig) -> dict[str, Any]:
        """Agent: list everyday explanations that could mimic the pattern."""
        started = time.perf_counter()
        request = to_prompt_json({"SCREEN": compact_screen(state["screen"])})
        report = await run_json_agent(self.agents["confounder"], request, ConfounderReport, config,
                                      self.repair_model, "confounder")
        return {"confounders": report.model_dump(),
                "trace": [_event("confounder_review", started, explanations=len(report.alternative_explanations))]}

    @log_step("node: analyst")
    async def analyst(self, state: PipelineState, config: RunnableConfig) -> dict[str, Any]:
        """Agent: interpret the screen for the person and the clinician."""
        started = time.perf_counter()
        policy = policy_for(state["screen"].get("overall_signal", ""))
        request = to_prompt_json({
            "SCREEN": compact_screen(state["screen"]),
            "CONFOUNDER_REVIEW": state.get("confounders", {}),
            "POLICY": {"max_recommendation": policy.max_recommendation, "headline": policy.headline},
            "FEEDBACK": state.get("feedback") or None,
        })
        fallback_used = bool(state.get("analyst_fallback"))
        try:
            if fallback_used:
                raise RuntimeError("fallback already engaged for this run")
            report = await run_json_agent(self.agents["analyst"], request, AnalystReport, config,
                                          self.repair_model, "analyst")
        except Exception as exc:  # noqa: BLE001 - rate limit, timeout or an unusable answer from the big model
            if "analyst_fallback" not in self.agents:
                raise
            log.warning("Analyst model failed (%s: %s); falling back to the smaller model", type(exc).__name__, exc)
            fallback_used = True
            report = await run_json_agent(self.agents["analyst_fallback"], request, AnalystReport, config,
                                          self.repair_model, "analyst-fallback")
        attempts = state.get("attempts", 0) + 1
        return {"analysis": report.model_dump(), "attempts": attempts, "analyst_fallback": fallback_used,
                "trace": [_event("analyst", started, attempt=attempts, recommendation=report.recommendation,
                                 **({"fallback": True} if fallback_used else {}))]}

    @log_step("node: verify")
    async def verify(self, state: PipelineState, config: RunnableConfig) -> dict[str, Any]:
        """Code checks the numbers and policy first; the verifier agent then checks the wording."""
        started = time.perf_counter()
        screen, analysis = state["screen"], state["analysis"]
        issues = check_analysis_against_screen(analysis, screen)

        if issues:
            log.warning("Deterministic verification found %d issue(s); skipping the LLM verifier", len(issues))
            verdict = "revise"
        else:
            request = to_prompt_json({"SCREEN": compact_screen(screen), "ANALYSIS": analysis,
                                      "DETERMINISTIC_ISSUES": []})
            judged = await run_json_agent(self.agents["verifier"], request, VerifierReport, config,
                                          self.repair_model, "verifier")
            issues = [i.model_dump() for i in judged.issues]
            verdict = "pass" if judged.verdict == "pass" and not issues else "revise"

        feedback = "\n".join(f"- {i['claim']}: {i['problem']}" for i in issues)
        return {"verification": {"verdict": verdict, "issues": issues}, "feedback": feedback,
                "trace": [_event("verify", started, verdict=verdict, issues=len(issues))]}

    def route_after_verify(self, state: PipelineState) -> str:
        if state["verification"]["verdict"] == "pass":
            return "safety_guard"
        if state.get("attempts", 0) < self.max_attempts:
            log.info("Verification failed; sending feedback to the analyst (attempt %d/%d)",
                     state.get("attempts", 0), self.max_attempts)
            return "analyst"
        log.warning("Verification still failing after %d attempts; falling back to template", self.max_attempts)
        return "fallback_summary"

    @log_step("node: safety_guard")
    async def safety_guard(self, state: PipelineState) -> dict[str, Any]:
        """Final code-level safety net on the approved analysis."""
        started = time.perf_counter()
        screen, analysis = state["screen"], state["analysis"]
        policy = policy_for(screen.get("overall_signal", ""))
        notes: list[str] = []

        recommendation = analysis["recommendation"]
        if recommendation_rank(recommendation) > recommendation_rank(policy.max_recommendation):
            notes.append(f"recommendation lowered from {recommendation} to {policy.max_recommendation}")
            recommendation = policy.max_recommendation

        patient_message, replaced = sanitize_patient_message(analysis["patient_message"], recommendation)
        if replaced:
            notes.append("patient message replaced with a safe template (diagnostic wording or empty)")

        if state.get("analyst_fallback"):
            notes.append("the main analysis model was unavailable; a smaller model wrote this analysis")
        confounders = state.get("confounders", {})
        final = {
            "overall_signal": screen.get("overall_signal"),
            "recommendation": recommendation,
            "confidence": analysis["confidence"],
            "headline": analysis["headline"],
            "patient_message": patient_message,
            "clinician_summary": analysis["clinician_summary"],
            "evidence": analysis["evidence"],
            "limitations": analysis["limitations"],
            "confounders": confounders.get("alternative_explanations", []),
            "confounder_pattern_summary": confounders.get("pattern_summary", ""),
            "verification_status": "passed",
            "needs_human_review": False,
            "guardrail_notes": notes,
        }
        return {"final": final, "trace": [_event("safety_guard", started, adjustments=len(notes))]}

    @log_step("node: fallback_summary")
    async def fallback_summary(self, state: PipelineState) -> dict[str, Any]:
        """Verification never passed: show a safe template and flag for human review."""
        started = time.perf_counter()
        final = build_template_final(state["screen"], status="failed_verification", needs_human_review=True)
        final["guardrail_notes"] = ["analyst output failed verification; template used"]
        return {"final": final, "trace": [_event("fallback_summary", started, status="degraded")]}

    @log_step("node: build_report")
    async def build_report(self, state: PipelineState) -> dict[str, Any]:
        """Ask the report MCP server to assemble the structured clinician report."""
        started = time.perf_counter()
        final = state["final"]
        narrative = {
            "clinician_summary": final["clinician_summary"],
            "confidence": final["confidence"],
            "recommendation": final["recommendation"],
            "confounders_considered": [c["name"] for c in final.get("confounders", [])
                                       if c.get("likelihood") in ("medium", "high")],
        }
        narrative["references"] = await self._background_reading()
        report = await self.toolbox.call("report", "build_clinician_report", user_id=state["user_id"],
                                         as_of=state["as_of"], narrative=narrative)
        return {"report": report, "trace": [_event("build_report", started)]}

    async def _background_reading(self) -> list[dict[str, str]]:
        """Optional literature links (Tavily). Any failure just means the report has no references."""
        try:
            found = await self.toolbox.call("evidence", "find_background_reading", topic="keystroke_dynamics")
            return found.get("results", []) if isinstance(found, dict) and found.get("enabled") else []
        except Exception as exc:  # noqa: BLE001
            log.warning("Background reading unavailable: %s", exc)
            return []
