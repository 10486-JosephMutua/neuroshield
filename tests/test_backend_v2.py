"""
The v2 backend: runs history, background jobs, per-person consent, onboarding,
plans, export, dry-run validation, device-aware statistics and SPA hosting.
"""
import time
from datetime import date, timedelta

import pytest

from backend import stats, storage
from backend.app import create_app
from backend.synthetic import PERSONAS, generate_persona_sessions
from tests.fakes import json_reply, scripted
from tests.test_pipeline_offline import AS_OF, CONFOUNDERS, PASS, _good_analysis, _screen


@pytest.fixture(autouse=True)
def _env(mcp_servers, seeded_db):
    yield


def _client(models=None, dist=None):
    return create_app((lambda: models) if models else None, frontend_dist=dist).test_client()


def _arthur_models():
    return {"fast": scripted(json_reply(CONFOUNDERS), json_reply(PASS)),
            "analyst": scripted(json_reply(_good_analysis(_screen("arthur_demo"))))}


def test_async_job_reports_progress_and_the_run_can_be_fetched_later():
    client = _client(_arthur_models())
    job_id = client.post("/api/users/arthur_demo/analyze/async", json={"as_of": AS_OF}).json["job_id"]
    job = {}
    for _ in range(100):
        job = client.get(f"/api/jobs/{job_id}").json
        if job["status"] in ("done", "failed"):
            break
        time.sleep(0.1)
    assert job["status"] == "done", job
    assert [e["node"] for e in job["events"]] == ["load_screen", "confounder_review", "analyst", "verify",
                                                  "safety_guard", "build_report"]
    run = client.get(f"/api/runs/{job['run_id']}").json
    assert run["final"]["recommendation"] == "suggest_routine_checkup"
    history = client.get("/api/users/arthur_demo/runs").json["runs"]
    assert history[0]["run_id"] == job["run_id"] and history[0]["overall_signal"] == "sustained_multi_domain_drift"


def test_failed_job_reports_a_friendly_error_not_a_crash():
    broken = {"fast": scripted(), "analyst": scripted()}  # scripted models with nothing left to say
    client = _client(broken)
    job_id = client.post("/api/users/arthur_demo/analyze/async", json={"as_of": AS_OF}).json["job_id"]
    for _ in range(100):
        job = client.get(f"/api/jobs/{job_id}").json
        if job["status"] in ("done", "failed"):
            break
        time.sleep(0.1)
    assert job["status"] == "failed" and job["error"]["code"] and job["error"]["message"]


def test_unknown_job_run_and_endpoint_are_clean_404s():
    client = _client()
    assert client.get("/api/jobs/nope").status_code == 404
    assert client.get("/api/runs/nope").status_code == 404
    missing = client.get("/api/does-not-exist")
    assert missing.status_code == 404 and missing.json["error"]["code"] == "not_found"


def test_screen_endpoint_is_instant_and_model_free():
    client = _client()
    body = client.get(f"/api/users/arthur_demo/screen?as_of={AS_OF}").json
    assert body["overall_signal"] == "sustained_multi_domain_drift" and body["input_mode"] == "keyboard"


def test_overview_bundles_what_the_person_pages_need():
    data = _client().get("/api/users/mary_demo/overview").json
    assert data["screen"]["overall_signal"] in ("stable", "minor_fluctuation")
    assert data["template"]["recommendation"] == "no_action" and data["checkin_available"] is True
    assert data["last_payload"]["median_flight_ms"] > 0 and "text" not in data["last_payload"]


def test_personas_expose_ground_truth_for_the_lab():
    people = {p["user_id"]: p for p in _client().get("/api/demo/personas").json["personas"]}
    assert people["john_demo"]["events"][0]["label"] == "Flu" and people["john_demo"]["seeded"] is True


def test_onboarding_consent_and_gating_of_the_checkin():
    client = _client(models={"fast": scripted(), "analyst": scripted()})
    user = client.post("/api/users", json={"display_name": "  Wanjiru  Test ", "checkin_consent": False}).json["user"]
    assert user["display_name"] == "Wanjiru Test" and user["is_synthetic"] is False
    assert client.post("/api/users", json={"display_name": "   "}).status_code == 400

    blocked = client.post(f"/api/users/{user['user_id']}/checkin", json={})
    assert blocked.status_code == 403 and blocked.json["error"]["code"] == "consent_required"
    updated = client.put(f"/api/users/{user['user_id']}/settings", json={"checkin_consent": True}).json["user"]
    assert updated["checkin_consent"] is True
    assert client.put(f"/api/users/{user['user_id']}/settings", json={"checkin_consent": "yes"}).status_code == 400
    client.delete(f"/api/users/{user['user_id']}")


def test_dry_run_validation_stores_nothing():
    client = _client()
    before = len(storage.fetch_sessions("mary_demo"))
    ok = client.post("/api/ingest/validate", json={"user_id": "mary_demo", "session_id": "dry", "day": "2026-03-01",
                                                   "median_flight_ms": 180})
    assert ok.json == {"accepted": True, "stored": False, "normalised": ok.json["normalised"]}
    bad = client.post("/api/ingest/validate", json={"user_id": "mary_demo", "session_id": "dry", "day": "2026-03-01",
                                                    "median_flight_ms": 180, "text": "hello"})
    assert bad.status_code == 400 and "text" in bad.json["error"]["message"]
    assert len(storage.fetch_sessions("mary_demo")) == before


def test_plans_can_be_listed_and_deleted_only_by_their_owner():
    client = _client()
    storage.add_memory("mary_demo", "2026-03-20", "plan", "call my sister")
    plan = client.get("/api/users/mary_demo/plans").json["plans"][0]
    assert client.delete(f"/api/users/arthur_demo/plans/{plan['memory_id']}").status_code == 404  # not their plan
    assert client.delete(f"/api/users/mary_demo/plans/{plan['memory_id']}").json == {"deleted": True}


def test_export_returns_everything_stored_as_a_download():
    response = _client().get("/api/users/john_demo/export")
    assert "attachment" in response.headers["Content-Disposition"]
    body = response.json
    assert body["user"]["user_id"] == "john_demo" and len(body["feature_sessions"]) > 100


def test_touch_sessions_are_never_mixed_into_keyboard_baselines():
    start = date(2026, 1, 1)
    sessions = generate_persona_sessions(PERSONAS["mary_demo"], start)
    # Add a burst of touch sessions with very different (slower) timing on the last days.
    extra = []
    for i in range(12):
        day = (start + timedelta(days=78 + i)).isoformat()
        extra.append({**sessions[0], "session_id": f"touch-{i}", "day": day, "input_mode": "touch",
                      "median_flight_ms": 420.0, "hold_time_ms": 200.0, "p90_pause_ms": 2500.0})
    mixed = stats.run_screen(sessions + extra)
    assert mixed["input_mode"] == "keyboard" and mixed["sessions_excluded_other_device"] == 12
    assert mixed["overall_signal"] in ("stable", "minor_fluctuation")  # the slow phone typing did not raise a flag


def test_spa_is_served_with_client_side_route_fallback(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html>app</html>")
    (tmp_path / "assets" / "a.js").write_text("console.log(1)")
    client = _client(dist=tmp_path)
    assert client.get("/lab").data == b"<html>app</html>"
    assert client.get("/runs/abc123").data == b"<html>app</html>"
    assert client.get("/assets/a.js").data == b"console.log(1)"
    assert client.get("/api/nope").status_code == 404


def test_spa_missing_build_gives_a_helpful_message(tmp_path):
    response = _client(dist=tmp_path / "empty").get("/")
    assert response.status_code == 404 and "npm run build" in response.json["error"]["message"]
