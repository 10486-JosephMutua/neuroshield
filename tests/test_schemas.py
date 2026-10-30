"""The privacy wall: only contract fields and numbers may pass."""
import pytest

from backend.schemas import PayloadError, validate_feature_payload

GOOD = {"user_id": "arthur_demo", "session_id": "s-1", "day": "2026-03-01",
        "median_flight_ms": 190.5, "lexical_diversity": 0.61, "keystroke_count": 900, "word_count": 160}


def test_valid_payload_is_normalised():
    clean = validate_feature_payload(GOOD)
    assert clean["median_flight_ms"] == 190.5 and clean["recall_score"] is None


@pytest.mark.parametrize("extra", [{"text": "hello world"}, {"typed_text": "secret"}, {"note": "x"}])
def test_unknown_fields_are_rejected(extra):
    with pytest.raises(PayloadError, match="unknown fields"):
        validate_feature_payload({**GOOD, **extra})


def test_text_cannot_hide_in_identifiers():
    with pytest.raises(PayloadError):
        validate_feature_payload({**GOOD, "user_id": "I wrote an email to my lawyer about money"})


@pytest.mark.parametrize("bad", [{"median_flight_ms": -5}, {"lexical_diversity": 4}, {"median_flight_ms": "190"},
                                 {"median_flight_ms": float("nan")}, {"keystroke_count": 1.5}])
def test_out_of_contract_numbers_are_rejected(bad):
    with pytest.raises(PayloadError):
        validate_feature_payload({**GOOD, **bad})


def test_needs_at_least_one_metric_and_a_real_date():
    with pytest.raises(PayloadError, match="at least one metric"):
        validate_feature_payload({"user_id": "u", "session_id": "s", "day": "2026-03-01"})
    with pytest.raises(PayloadError, match="ISO date"):
        validate_feature_payload({**GOOD, "day": "yesterday"})


def test_error_messages_never_echo_values():
    with pytest.raises(PayloadError) as info:
        validate_feature_payload({**GOOD, "user_id": "SUPER-SECRET sentence with spaces"})
    assert "SUPER-SECRET" not in str(info.value)
