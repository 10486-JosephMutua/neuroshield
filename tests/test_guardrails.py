"""Guardrails are code-level guarantees; test them directly."""
from backend import guardrails as g


def _screen():
    return {"overall_signal": "acute_change", "metrics": {
        "median_flight_ms": {"status": "acute_shift", "baseline": {"median": 190.0},
                             "recent": {"mean": 230.0, "change_pct": 21.1}}}}


def test_numbers_match_passes_and_mismatch_fails():
    ok = {"evidence": [{"metric": "median_flight_ms", "baseline_value": 190.0, "recent_value": 230.0,
                        "change_pct": 21.1}], "recommendation": "keep_monitoring", "confidence": "moderate"}
    assert g.check_analysis_against_screen(ok, _screen()) == []
    bad = {**ok, "evidence": [{**ok["evidence"][0], "recent_value": 300.0}]}
    assert any("recent_value" in i["claim"] for i in g.check_analysis_against_screen(bad, _screen()))


def test_policy_ceiling_and_confidence_are_enforced():
    analysis = {"evidence": [], "recommendation": "suggest_routine_checkup", "confidence": "high"}
    problems = " ".join(i["problem"] for i in g.check_analysis_against_screen(analysis, _screen()))
    assert "policy allows at most" in problems and "high confidence" in problems


def test_unknown_metric_is_flagged():
    analysis = {"evidence": [{"metric": "made_up"}], "recommendation": "no_action", "confidence": "low"}
    assert g.check_analysis_against_screen(analysis, _screen())


def test_patient_message_with_diagnostic_wording_is_replaced():
    text, replaced = g.sanitize_patient_message("You may have early dementia.", "keep_monitoring")
    assert replaced and "dementia" not in text.lower()
    text, replaced = g.sanitize_patient_message("Things look steady this week.", "no_action")
    assert not replaced and text == "Things look steady this week."


def test_calm_signals_skip_models():
    assert not g.policy_for("stable").use_llm and g.policy_for("acute_change").use_llm
