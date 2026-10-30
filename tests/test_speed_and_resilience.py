"""
Bottleneck fixes: result cache, single-flight, concurrency limit, smaller model input,
analyst fallback, cached check-in, local check-in model and the optional literature search.
"""
import asyncio
import json
import threading
import time
from datetime import date, timedelta

import pytest

from backend import jobs, stats, storage
from backend.agents.checkin import generate_checkin
from backend.graph.compact import compact_screen, to_prompt_json
from backend.graph.pipeline import cache_fingerprint, run_analysis
from backend.mcp_servers import evidence_server
from backend.synthetic import PERSONAS, generate_persona_sessions
from tests.fakes import ExplodingModel, json_reply, scripted
from tests.test_pipeline_offline import AS_OF, CONFOUNDERS, PASS, _good_analysis, _screen


@pytest.fixture(autouse=True)
def _env(mcp_servers, seeded_db):
    yield


def _models(user="arthur_demo", day=AS_OF):
    screen = stats.run_screen(storage.fetch_sessions(user, day), day)
    return {"fast": scripted(json_reply(CONFOUNDERS), json_reply(PASS)),
            "analyst": scripted(json_reply(_good_analysis(screen)))}


def test_compact_screen_is_smaller_but_keeps_what_an_explanation_cites():
    start = date(2026, 1, 1)
    for persona, ceiling in (("grace_demo", 0.6), ("arthur_demo", 0.9)):
        sessions = generate_persona_sessions(PERSONAS[persona], start)
        full = stats.run_screen(sessions, "2026-03-31")
        small = compact_screen(full)
        assert len(to_prompt_json(small)) < ceiling * len(json.dumps(full)), persona
    arthur = stats.run_screen(generate_persona_sessions(PERSONAS["arthur_demo"], start), "2026-03-31")
    pause = compact_screen(arthur)["metrics"]["p90_pause_ms"]
    assert pause["baseline"]["median"] == arthur["metrics"]["p90_pause_ms"]["baseline"]["median"]
    assert pause["recent"]["change_pct"] == arthur["metrics"]["p90_pause_ms"]["recent"]["change_pct"]
    grace = compact_screen(stats.run_screen(generate_persona_sessions(PERSONAS["grace_demo"], start), "2026-03-31"))
    assert set(grace["metrics"]["lexical_diversity"]) == {"label", "domain", "status", "change_pct"}


def test_identical_analysis_is_served_from_cache_and_changes_in_data_invalidate_it(monkeypatch):
    monkeypatch.setenv("NEUROSHIELD_ANALYSIS_CACHE", "true")
    day = "2026-03-27"
    first = asyncio.run(run_analysis("arthur_demo", day, _models(day=day), use_cache=False))  # compute and store
    assert first["cached"] is False and first["fingerprint"]
    boom = ExplodingModel(messages=iter([]))
    second = asyncio.run(run_analysis("arthur_demo", day, {"fast": boom, "analyst": boom}, use_cache=True))
    assert second["cached"] is True and second["run_id"] == first["run_id"]  # no model was touched

    # new data for that person changes the fingerprint, so the cache must not be reused
    before = cache_fingerprint("arthur_demo", day)[1]
    storage.insert_sessions([{**storage.fetch_sessions("arthur_demo")[0], "session_id": "extra-1"}])
    assert cache_fingerprint("arthur_demo", day)[1] != before
    third = asyncio.run(run_analysis("arthur_demo", day, _models(day=day), use_cache=True))
    assert third["cached"] is False and third["run_id"] != first["run_id"]


def test_cache_is_off_unless_requested_and_failed_runs_are_never_cached(monkeypatch):
    monkeypatch.setenv("NEUROSHIELD_ANALYSIS_CACHE", "true")
    day = "2026-03-26"
    screen = stats.run_screen(storage.fetch_sessions("arthur_demo", day), day)
    bad = _good_analysis(screen, confidence="low")
    bad["evidence"][0]["recent_value"] = 9999.0
    models = {"fast": scripted(json_reply(CONFOUNDERS)), "analyst": scripted(json_reply(bad), json_reply(bad))}
    failed = asyncio.run(run_analysis("arthur_demo", day, models, use_cache=True))
    assert failed["final"]["verification_status"] == "failed_verification"
    retry = asyncio.run(run_analysis("arthur_demo", day, _models(day=day), use_cache=True))
    assert retry["cached"] is False and retry["final"]["verification_status"] == "passed"  # the failure was not reused


def test_a_second_request_for_the_same_person_and_day_joins_the_running_job():
    store = jobs.JobStore()
    job, created = store.get_or_create("arthur_demo", AS_OF, False)
    again, created_again = store.get_or_create("arthur_demo", AS_OF, False)
    assert created and not created_again and again["job_id"] == job["job_id"]
    other, created_other = store.get_or_create("arthur_demo", "2026-03-01", False)
    assert created_other and other["job_id"] != job["job_id"]
    store.update(job["job_id"], status="done")
    fresh, created_fresh = store.get_or_create("arthur_demo", AS_OF, False)
    assert created_fresh and fresh["job_id"] != job["job_id"]


def test_only_the_configured_number_of_analyses_use_the_models_at_once(monkeypatch):
    monkeypatch.setenv("NEUROSHIELD_MAX_CONCURRENT_ANALYSES", "1")
    release, inside = threading.Event(), threading.Event()

    def blocking_provider():
        inside.set()
        release.wait(10)  # holds the only slot
        return _models(day="2026-03-30")

    first = jobs.start_analysis_job("arthur_demo", "2026-03-30", blocking_provider)
    assert inside.wait(5)
    second = jobs.start_analysis_job("mary_demo", "2026-03-30", None)
    time.sleep(0.4)
    assert jobs.STORE.get(first)["status"] == "running"
    assert jobs.STORE.get(second)["status"] == "queued"  # waiting, not failing, not hammering the models
    release.set()
    for _ in range(100):
        if jobs.STORE.get(second)["status"] in ("done", "failed"):
            break
        time.sleep(0.1)
    assert jobs.STORE.get(second)["status"] == "done"


def test_a_cached_job_finishes_instantly_and_says_so(monkeypatch):
    monkeypatch.setenv("NEUROSHIELD_ANALYSIS_CACHE", "true")
    asyncio.run(run_analysis("arthur_demo", "2026-03-29", _models(day="2026-03-29"), use_cache=False))
    job_id = jobs.start_analysis_job("arthur_demo", "2026-03-29", lambda: {"fast": ExplodingModel(messages=iter([])),
                                                                             "analyst": ExplodingModel(messages=iter([]))})
    for _ in range(100):
        if jobs.STORE.get(job_id)["status"] in ("done", "failed"):
            break
        time.sleep(0.05)
    job = jobs.STORE.get(job_id)
    assert job["status"] == "done" and job["cached"] is True and len(job["events"]) == 6


def test_if_the_big_model_fails_the_smaller_model_finishes_the_analysis():
    boom = ExplodingModel(messages=iter([]))
    fast = scripted(json_reply(CONFOUNDERS), json_reply(_good_analysis(_screen("arthur_demo"))), json_reply(PASS))
    result = asyncio.run(run_analysis("arthur_demo", AS_OF, {"fast": fast, "analyst": boom}))
    final = result["final"]
    assert final["verification_status"] == "passed" and final["recommendation"] == "suggest_routine_checkup"
    assert any("smaller model" in note for note in final["guardrail_notes"])
    assert [e for e in result["trace"] if e["node"] == "analyst"][0]["fallback"] is True


def test_the_morning_checkin_is_asked_once_a_day_and_then_served_instantly():
    storage.add_memory("mary_demo", "2026-03-30", "plan", "water the plants")
    fast = scripted(json_reply({"message": "Good morning! Did the plants get watered?", "plan_memory_id": None,
                                "asks_for_new_plan": True}))
    first = asyncio.run(generate_checkin("mary_demo", "2026-04-02", {"fast": fast}))
    assert first["cached"] is False
    boom = ExplodingModel(messages=iter([]))
    second = asyncio.run(generate_checkin("mary_demo", "2026-04-02", {"fast": boom}))
    assert second["cached"] is True and second["message"] == first["message"]
    refreshed = asyncio.run(generate_checkin("mary_demo", "2026-04-02", {"fast": scripted(json_reply(
        {"message": "A new question", "plan_memory_id": None, "asks_for_new_plan": True}))}, fresh=True))
    assert refreshed["message"] == "A new question"


def test_checkin_can_run_on_a_local_model_that_needs_no_cloud_key(monkeypatch):
    from backend.llm import get_chat_model
    monkeypatch.setenv("NEBIUS_API_KEY", "")
    monkeypatch.setenv("NEUROSHIELD_CHECKIN_BASE_URL", "http://localhost:11434/v1")
    monkeypatch.setenv("NEUROSHIELD_CHECKIN_MODEL", "nemotron-3-nano:30b")
    local = get_chat_model("checkin")
    assert "localhost:11434" in str(local.openai_api_base) and local.model_name == "nemotron-3-nano:30b"
    monkeypatch.delenv("NEUROSHIELD_CHECKIN_BASE_URL")
    with pytest.raises(Exception, match="NEBIUS_API_KEY"):
        get_chat_model("checkin")  # without a local model the cloud key is required, as before


class StubTavily:
    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    def search(self, **kwargs):
        self.calls.append(kwargs)
        if self.fail:
            raise RuntimeError("quota exceeded")
        return {"results": [{"title": "Typing dynamics and MCI", "url": "https://pubmed.ncbi.nlm.nih.gov/1/", "content": "x" * 500},
                            {"title": "", "url": "https://bad"}]}


def test_background_reading_is_off_without_a_key_restricted_cached_and_fail_safe(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "")
    assert evidence_server.find_with(StubTavily, "keystroke_dynamics")["enabled"] is False

    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")
    stub = StubTavily()
    out = evidence_server.find_with(lambda: stub, "keystroke_dynamics")
    assert out["enabled"] and out["cached"] is False and len(out["results"]) == 1  # the untitled hit is dropped
    assert len(out["results"][0]["snippet"]) == 280
    assert "pubmed.ncbi.nlm.nih.gov" in stub.calls[0]["include_domains"]  # scholarly sources only
    again = evidence_server.find_with(lambda: StubTavily(fail=True), "keystroke_dynamics")
    assert again["cached"] is True  # a week-long cache: the failing client is never even called

    storage.get_evidence_cache  # noqa: B018 - clear for the failure case with a different key
    failing = evidence_server.find_with(lambda: StubTavily(fail=True), "typing_language")
    assert failing == {"enabled": False, "reason": "the literature search is unavailable right now", "results": []}
    with pytest.raises(ValueError):
        evidence_server.find_with(StubTavily, "anything the model makes up")
