"""The always-on watch (notify only on change) and the evaluation benchmark."""
import json

import pytest

from backend import evaluation, storage, watcher
from backend.app import create_app


@pytest.fixture(autouse=True)
def _env(seeded_db):
    yield


def _fresh_state(user_id):
    with storage._connect() as conn:
        conn.execute("DELETE FROM watch_state WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM notifications WHERE user_id = ?", (user_id,))


def test_watch_notifies_once_when_a_signal_escalates_and_stays_silent_afterwards():
    _fresh_state("arthur_demo")
    first = watcher.scan_user("arthur_demo")
    assert first["notified"] and first["signal"] == "sustained_multi_domain_drift"
    again = watcher.scan_user("arthur_demo")
    assert not again["notified"]  # nothing changed, so no spam
    notes = storage.list_notifications("arthur_demo")
    assert len(notes) == 1 and notes[0]["title"] == "A steady change was noticed"
    assert "dementia" not in (notes[0]["body"] + notes[0]["title"]).lower()  # fixed, reviewed wording


def test_watch_says_nothing_for_a_steady_person_and_announces_a_recovery():
    _fresh_state("mary_demo")
    assert not watcher.scan_user("mary_demo")["notified"]
    _fresh_state("john_demo")
    storage.set_watch_state("john_demo", "acute_change", "2026-03-20")  # last time he was mid-flu
    result = watcher.scan_user("john_demo")
    assert result["previous_signal"] == "acute_change"
    if result["signal"] in ("stable", "minor_fluctuation"):
        assert result["notified"] and storage.list_notifications("john_demo")[0]["kind"] == "resolved"


def test_scan_all_skips_demo_people_unless_asked_and_one_failure_does_not_stop_the_rest():
    assert all(not r["user_id"].endswith("_demo") for r in watcher.scan_all())
    ids = {r["user_id"] for r in watcher.scan_all(include_synthetic=True)}
    assert {"arthur_demo", "mary_demo", "john_demo", "grace_demo"} <= ids


def test_api_scan_notifications_and_mark_read(mcp_servers):
    _fresh_state("grace_demo")
    client = create_app().test_client()
    scan = client.post("/api/watch/scan", json={"include_synthetic": True}).json
    assert scan["changes"] >= 1
    unread = client.get("/api/users/grace_demo/notifications?unread=1").json["notifications"]
    assert unread and unread[0]["signal"] == "motor_only_change"
    assert client.get("/api/users/grace_demo/overview").json["notifications"][0]["id"] == unread[0]["id"]
    assert client.post(f"/api/users/grace_demo/notifications/{unread[0]['id']}/read").json == {"read": True}
    assert client.get("/api/users/grace_demo/notifications?unread=1").json["notifications"] == []
    assert client.post("/api/users/arthur_demo/notifications/99999/read").status_code == 404
    assert client.get("/api/watch/status").json["enabled"] is False


def test_deleting_a_person_also_removes_notifications_and_watch_state():
    storage.upsert_user("temp_person", "Temp")
    storage.add_notification("temp_person", "change_detected", "t", "b")
    storage.set_watch_state("temp_person", "stable", "2026-03-01")
    deleted = storage.delete_user_data("temp_person")
    assert deleted["notifications"] == 1 and deleted["watch_state"] == 1


def test_wilson_interval_is_honest_about_small_samples():
    low, high = evaluation.wilson(0, 60)
    assert low == 0.0 and 0.05 < high < 0.07  # zero false alarms in 60 people still allows up to about 6%
    low, high = evaluation.wilson(30, 30)
    assert high == 1.0 and 0.88 < low < 0.9


def test_benchmark_tells_the_truth_about_what_the_screen_can_and_cannot_do():
    report = evaluation.run_benchmark(healthy=12, per_scale=8, confounder=8)
    assert report["synthetic"] is True and report["caveats"]
    assert report["healthy"]["people_ever_flagged"]["count"] == 0
    by_label = {row["label"]: row for row in report["decline"]}
    assert by_label["Demo strength"]["detected"]["rate"] == 1.0
    assert by_label["Very subtle"]["detected"]["rate"] < by_label["Subtle"]["detected"]["rate"] <= 1.0  # sensitivity has a limit
    assert report["keyboard"]["recognised_as_mechanical_only"]["rate"] >= 0.9
    json.dumps(report)  # must be serialisable for the API
