"""The statistics engine must classify each synthetic persona correctly."""
from datetime import date, timedelta

import pytest

from backend import stats
from backend.synthetic import PERSONAS, Persona, _effects_healthy, generate_persona_sessions

START = date(2026, 1, 1)


def _screen(persona_id: str, day_index: int):
    sessions = generate_persona_sessions(PERSONAS[persona_id], START)
    as_of = (START + timedelta(days=day_index)).isoformat()
    return stats.run_screen([s for s in sessions if s["day"] <= as_of], as_of)


def test_generator_is_deterministic():
    a = generate_persona_sessions(PERSONAS["arthur_demo"], START)
    b = generate_persona_sessions(PERSONAS["arthur_demo"], START)
    assert a == b


@pytest.mark.parametrize("persona_id", list(PERSONAS))
def test_each_persona_ends_as_expected(persona_id):
    assert _screen(persona_id, 89)["overall_signal"] in PERSONAS[persona_id].expected_at_end


def test_gradual_decline_spans_domains_and_is_gradual():
    screen = _screen("arthur_demo", 89)
    assert {"hesitation", "linguistic", "memory"} <= set(screen["sustained_domains"])
    assert screen["metrics"]["p90_pause_ms"]["pattern"] == "gradual_drift"


def test_flu_is_acute_while_ill_and_not_flagged_after_recovery():
    assert _screen("john_demo", 74)["overall_signal"] == "acute_change"
    assert _screen("john_demo", 89)["overall_signal"] in ("stable", "minor_fluctuation")


def test_new_keyboard_is_motor_only_step_change():
    screen = _screen("grace_demo", 89)
    assert screen["overall_signal"] == "motor_only_change"
    assert screen["metrics"]["hold_time_ms"]["pattern"] == "step_change"
    assert screen["domains"]["linguistic"]["status"] == "stable"


def test_short_history_is_insufficient():
    assert _screen("arthur_demo", 20)["overall_signal"] == "insufficient_data"


def test_no_false_alarms_on_healthy_people():
    for seed in range(40):
        persona = Persona("t", "t", "", seed, _effects_healthy, ("stable",))
        sessions = generate_persona_sessions(persona, START)
        assert stats.run_screen(sessions)["overall_signal"] in ("stable", "minor_fluctuation"), seed


def test_mann_kendall_detects_trend_and_ignores_noise():
    assert stats.mann_kendall([1, 2, 3, 4, 5, 6, 7, 8])["p_value"] < 0.01
    assert stats.mann_kendall([5, 1, 4, 2, 5, 1, 4, 2])["p_value"] > 0.3
