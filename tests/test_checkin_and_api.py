"""Check-in agent (memory MCP tools) and the Flask API, with scripted models."""
import asyncio

import pytest

from backend import storage
from backend.agents.checkin import evaluate_reply, generate_checkin
from backend.app import create_app
from tests.fakes import json_reply, scripted, tool_call


@pytest.fixture(autouse=True)
def _env(mcp_servers, seeded_db):
    yield


def test_checkin_asks_about_a_remembered_plan_then_scores_the_reply():
    plan_id = storage.add_memory("mary_demo", "2026-03-30", "plan", "plant the tomatoes")
    fast = scripted(
        tool_call("memory_recall_recent_plans", {"user_id": "mary_demo", "before_day": "2026-03-31"}),
        json_reply({"message": "Good morning! Did the tomatoes get planted?", "plan_memory_id": plan_id,
                    "asks_for_new_plan": True}),
    )
    out = asyncio.run(generate_checkin("mary_demo", "2026-03-31", {"fast": fast}, fresh=True))
    assert out["plan_memory_id"] == plan_id and "tomatoes" in out["message"]

    fast = scripted(json_reply({"recall_score": 0.8, "reasoning": "mostly right", "new_plan": "water them"}))
    scored = asyncio.run(evaluate_reply("mary_demo", "Yes, planted them by the fence.", "2026-03-31", plan_id,
                                        {"fast": fast}))
    assert scored["recall_score"] == 0.8 and scored["new_plan_memory_id"]
    assert any(s["session_id"] == "mary_demo-2026-03-31-checkin" for s in storage.fetch_sessions("mary_demo"))


def test_checkin_ignores_a_plan_id_the_model_invented():
    fast = scripted(json_reply({"message": "Good morning!", "plan_memory_id": 99999, "asks_for_new_plan": True}))
    out = asyncio.run(generate_checkin("mary_demo", "2026-03-31", {"fast": fast}, fresh=True))
    assert out["plan_memory_id"] is None


def test_api_privacy_wall_analysis_and_errors():
    from tests.test_pipeline_offline import AS_OF, CONFOUNDERS, PASS, _good_analysis, _screen

    models = {"fast": scripted(json_reply(CONFOUNDERS), json_reply(PASS)),
              "analyst": scripted(json_reply(_good_analysis(_screen("arthur_demo"))))}
    client = create_app(lambda: models).test_client()

    assert client.get("/api/health").json["status"] == "ok"
    assert any(u["user_id"] == "arthur_demo" for u in client.get("/api/users").json["users"])

    # privacy wall: text fields are refused with HTTP 400
    bad = client.post("/api/ingest", json={"user_id": "x", "session_id": "s", "day": "2026-03-01",
                                           "median_flight_ms": 200, "typed_text": "hello"})
    assert bad.status_code == 400 and bad.json["error"]["code"] == "invalid_payload"
    ok = client.post("/api/ingest", json={"user_id": "new_user", "session_id": "s1", "day": "2026-03-01",
                                          "median_flight_ms": 200})
    assert ok.status_code == 201

    result = client.post("/api/users/arthur_demo/analyze", json={"as_of": AS_OF})
    assert result.status_code == 200 and result.json["final"]["recommendation"] == "suggest_routine_checkup"
    assert client.get("/api/users/arthur_demo/analysis/latest").json["run_id"] == result.json["run_id"]
    assert "median_flight_ms" in client.get("/api/users/arthur_demo/series?as_of=" + AS_OF).json["series"]

    assert client.post("/api/users/ghost/analyze", json={}).status_code == 404
    assert client.post("/api/users/arthur_demo/analyze", json={"as_of": "not-a-date"}).status_code == 400
    assert client.delete("/api/users/new_user").json["deleted"]["feature_sessions"] == 1
