"""
End-to-end pipeline test with the REAL MCP servers and SCRIPTED models.

Proves: MCP tool loading, agent tool-calling, the verify/revise loop, guardrails,
the report tool, usage tracking and persistence — without any network access.
"""
import asyncio
import copy

import pytest

from backend import stats, storage
from backend.graph.pipeline import UnknownUserError, run_analysis
from tests.fakes import ExplodingModel, json_reply, scripted, tool_call

AS_OF = "2026-03-31"  # day 90


def _screen(user_id):
    return stats.run_screen(storage.fetch_sessions(user_id, AS_OF), AS_OF)


def _good_analysis(screen, **overrides):
    evidence = []
    for key in ("p90_pause_ms", "lexical_diversity"):
        m = screen["metrics"][key]
        evidence.append({"metric": key, "observation": "moved away from the personal baseline",
                         "baseline_value": m["baseline"]["median"], "recent_value": m["recent"]["mean"],
                         "change_pct": m["recent"]["change_pct"]})
    analysis = {"headline": "Sustained change across several areas.", "evidence": evidence,
                "confidence": "high", "recommendation": "suggest_routine_checkup",
                "patient_message": "Over recent weeks we noticed a steady change in several patterns. "
                                   "It may be worth mentioning at your next routine check-up.",
                "clinician_summary": "Gradual multi-domain shift versus baseline. This is a screening summary, "
                                     "not a diagnosis.",
                "limitations": ["Baseline is the first four weeks.", "Heuristic thresholds."]}
    return {**analysis, **overrides}


CONFOUNDERS = {"alternative_explanations": [{"name": "new keyboard", "likelihood": "low",
                                             "reasoning": "thinking measures also moved"}],
               "pattern_summary": "Gradual and multi-domain.", "suggested_recheck_days": 14}
PASS = {"verdict": "pass", "issues": []}


@pytest.fixture(autouse=True)
def _env(mcp_servers, seeded_db):
    yield


def test_sustained_drift_passes_through_all_agents():
    screen = _screen("arthur_demo")
    models = {
        # the confounder agent first calls a real MCP tool, then answers
        "fast": scripted(
            tool_call("biomarkers_compare_windows", {"user_id": "arthur_demo", "metric": "p90_pause_ms", "as_of": AS_OF}),
            json_reply(CONFOUNDERS), json_reply(PASS)),
        "analyst": scripted(json_reply(_good_analysis(screen))),
    }
    result = asyncio.run(run_analysis("arthur_demo", AS_OF, models))
    final = result["final"]
    assert final["overall_signal"] == "sustained_multi_domain_drift"
    assert final["recommendation"] == "suggest_routine_checkup"
    assert final["verification_status"] == "passed" and not final["needs_human_review"]
    assert [e["node"] for e in result["trace"]] == [
        "load_screen", "confounder_review", "analyst", "verify", "safety_guard", "build_report"]
    assert result["report"]["subject"]["synthetic_data"] is True
    assert result["report"]["metrics_table"] and result["report"]["limitations"]
    assert storage.get_latest_analysis("arthur_demo")["run_id"] == result["run_id"]


def test_wrong_numbers_trigger_revise_loop_then_pass():
    screen = _screen("arthur_demo")
    bad = copy.deepcopy(_good_analysis(screen))
    bad["evidence"][0]["recent_value"] = 9999.0  # a hallucinated number
    models = {
        "fast": scripted(json_reply(CONFOUNDERS), json_reply(PASS)),  # LLM verifier only runs once numbers are right
        "analyst": scripted(json_reply(bad), json_reply(_good_analysis(screen))),
    }
    result = asyncio.run(run_analysis("arthur_demo", AS_OF, models))
    assert [e["node"] for e in result["trace"]].count("analyst") == 2
    assert result["final"]["verification_status"] == "passed"


def test_persistent_failure_falls_back_to_template_for_human_review():
    screen = _screen("arthur_demo")
    bad = _good_analysis(screen, confidence="low", recommendation="suggest_routine_checkup")
    bad["evidence"][0]["recent_value"] = 9999.0
    models = {"fast": scripted(json_reply(CONFOUNDERS)), "analyst": scripted(json_reply(bad), json_reply(bad))}
    final = asyncio.run(run_analysis("arthur_demo", AS_OF, models))["final"]
    assert final["verification_status"] == "failed_verification" and final["needs_human_review"]


def test_diagnostic_wording_never_reaches_the_patient():
    screen = _screen("arthur_demo")
    risky = _good_analysis(screen, patient_message="You probably have early dementia.")
    models = {"fast": scripted(json_reply(CONFOUNDERS), json_reply(PASS)), "analyst": scripted(json_reply(risky))}
    final = asyncio.run(run_analysis("arthur_demo", AS_OF, models))["final"]
    assert "dementia" not in final["patient_message"].lower()
    assert any("safe template" in n for n in final["guardrail_notes"])


def test_calm_signal_never_calls_a_model():
    boom = ExplodingModel(messages=iter([]))
    result = asyncio.run(run_analysis("mary_demo", AS_OF, {"fast": boom, "analyst": boom}))
    assert result["final"]["verification_status"] == "template"
    assert result["usage"]["calls"] == 0


def test_unknown_user_is_reported():
    with pytest.raises(UnknownUserError):
        asyncio.run(run_analysis("nobody", AS_OF, {"fast": None, "analyst": None}))
