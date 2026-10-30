"""Flask API. In production it also serves the built React app.

Views are synchronous while the pipeline and MCP client are async, so views that need
them call asyncio.run. The slow analysis runs as a background job (backend/jobs.py)
that the UI polls.

Run:  python run_all.py       starts the MCP servers and this app together
      python -m backend.app   MCP servers must already be running"""
from __future__ import annotations

import asyncio
import socket
import time
from datetime import date
from pathlib import Path
from typing import Any, Callable

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from backend import jobs, stats, storage, watcher
from backend.agents.checkin import evaluate_reply, generate_checkin
from backend.config import PROJECT_ROOT, get_settings
from backend.errors import describe_error
from backend.graph.pipeline import UnknownUserError, run_analysis
from backend.guardrails import SAFE_PATIENT_MESSAGES, policy_for
from backend.logging_setup import configure_logging, get_logger
from backend.schemas import (ALLOWED_FIELDS, METRIC_KEYS, metric_catalogue, validate_feature_payload)
from backend.synthetic import PERSONAS, seed_demo_users

log = get_logger("api")

ModelsProvider = Callable[[], dict[str, Any]]
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"


def _port_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex((host, port)) == 0


def create_app(models_provider: ModelsProvider | None = None, frontend_dist: Path | None = None) -> Flask:
    """
    Application factory.

    `models_provider` returns {"analyst": ..., "fast": ...}; tests inject scripted
    fakes here, production leaves it None so real Token Factory models are built.
    `frontend_dist` points at the built React app (defaults to frontend/dist).
    """
    configure_logging("flask")
    storage.init_db()
    app = Flask(__name__)
    CORS(app)  # lets the Vite dev server (another origin) call the API
    dist = frontend_dist or FRONTEND_DIST
    watch = watcher.Watcher(models_provider)
    if get_settings().watcher_enabled:
        watch.start()  # always-on: re-screens everyone on a schedule and notifies only on a change

    def models() -> dict[str, Any] | None:
        return models_provider() if models_provider else None

    @app.before_request
    def _start_timer():
        request.environ["ns_started"] = time.perf_counter()

    @app.after_request
    def _log_request(response):
        started = request.environ.get("ns_started", time.perf_counter())
        if request.path.startswith("/api/"):
            log.info("%s %s -> %d (%.0f ms)", request.method, request.path, response.status_code,
                     (time.perf_counter() - started) * 1000)
        return response

    def _error(status: int, code: str, message: str):
        return jsonify({"error": {"code": code, "message": message}}), status

    @app.errorhandler(HTTPException)
    def _http_error(exc: HTTPException):
        return _error(exc.code or 500, (exc.name or "error").lower().replace(" ", "_"), exc.description or exc.name)

    @app.errorhandler(Exception)
    def _any_error(exc: Exception):
        status, code, message = describe_error(exc)
        return _error(status, code, message)

    def _json_body() -> dict[str, Any]:
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            raise ValueError("request body must be a JSON object")
        return body

    def _optional_day(value: Any) -> str | None:
        if value in (None, ""):
            return None
        return date.fromisoformat(str(value)).isoformat()

    def _require_user(user_id: str) -> dict[str, Any]:
        user = storage.get_user(user_id)
        if user is None:
            raise UnknownUserError(f"no user '{user_id}'")
        return user

    def _screen(user_id: str, as_of: str | None) -> dict[str, Any]:
        return stats.run_screen(storage.fetch_sessions(user_id, as_of), as_of)

    @app.get("/api/health")
    def health():
        settings = get_settings()
        mcp = {name: _port_open(settings.mcp_host, port) for name, port in settings.mcp_ports.items()}
        return jsonify({"status": "ok", "model_key_configured": bool(settings.nebius_api_key),
                        "models": {"analyst": settings.model_analyst, "fast": settings.model_fast},
                        "mcp_servers": settings.mcp_servers, "mcp_reachable": mcp,
                        "checkin_enabled": settings.checkin_consent,
                        "checkin_runs_locally": settings.checkin_is_local,
                        "checkin_model": settings.checkin_model if settings.checkin_is_local else settings.model_fast,
                        "evidence_enabled": bool(settings.tavily_api_key),
                        "watcher_enabled": settings.watcher_enabled,
                        "max_concurrent_analyses": settings.max_concurrent_analyses})

    @app.get("/api/privacy/contract")
    def privacy_contract():
        """What may leave the device. The UI's Privacy Inspector renders this."""
        return jsonify({"allowed_fields": sorted(ALLOWED_FIELDS), "metrics": metric_catalogue(),
                        "guarantee": "Only these numeric fields and identifiers are accepted; any other field "
                                     "is rejected and typed text is never transmitted."})

    @app.get("/api/users")
    def users():
        return jsonify({"users": storage.list_users()})

    @app.post("/api/users")
    def create_user():
        body = _json_body()
        user = storage.create_user(str(body.get("display_name", "")), bool(body.get("checkin_consent", True)))
        return jsonify({"user": user}), 201

    @app.get("/api/users/<user_id>")
    def get_user(user_id: str):
        return jsonify({"user": _require_user(user_id)})

    @app.put("/api/users/<user_id>/settings")
    def update_settings(user_id: str):
        _require_user(user_id)
        body = _json_body()
        if "checkin_consent" not in body or not isinstance(body["checkin_consent"], bool):
            raise ValueError("'checkin_consent' (true or false) is required")
        storage.set_checkin_consent(user_id, body["checkin_consent"])
        return jsonify({"user": storage.get_user(user_id)})

    @app.delete("/api/users/<user_id>")
    def delete_user(user_id: str):
        _require_user(user_id)
        return jsonify({"deleted": storage.delete_user_data(user_id)})

    @app.get("/api/users/<user_id>/export")
    def export_user(user_id: str):
        _require_user(user_id)
        response = jsonify(storage.export_user(user_id))
        response.headers["Content-Disposition"] = f'attachment; filename="neuroshield-{user_id}.json"'
        return response

    @app.get("/api/demo/personas")
    def personas():
        existing = {u["user_id"] for u in storage.list_users()}
        return jsonify({"personas": [
            {"user_id": p.user_id, "display_name": p.display_name, "description": p.description,
             "events": list(p.events), "expected_at_end": list(p.expected_at_end),
             "seeded": p.user_id in existing}
            for p in PERSONAS.values()]})

    @app.post("/api/demo/seed")
    def seed():
        body = request.get_json(silent=True) or {}
        days = int(body.get("days", 90))
        if not 45 <= days <= 365:
            raise ValueError("days must be between 45 and 365")
        summary = seed_demo_users(days=days, persona_ids=body.get("personas") or None)
        return jsonify({"seeded": summary, "personas": {k: v.description for k, v in PERSONAS.items()}})

    @app.get("/api/watch/status")
    def watch_status():
        return jsonify(watch.status())

    @app.post("/api/watch/scan")
    def watch_scan():
        """Run the watch right now (the same step the schedule runs). Handy for demos."""
        body = request.get_json(silent=True) or {}
        results = watcher.scan_all(models_provider, include_synthetic=bool(body.get("include_synthetic")),
                                   auto_analyze=bool(body.get("auto_analyze")))
        return jsonify({"results": results, "changes": sum(1 for r in results if r["notified"])})

    @app.get("/api/users/<user_id>/notifications")
    def notifications(user_id: str):
        _require_user(user_id)
        return jsonify({"notifications": storage.list_notifications(user_id, unread_only=request.args.get("unread") == "1")})

    @app.post("/api/users/<user_id>/notifications/<int:notification_id>/read")
    def read_notification(user_id: str, notification_id: int):
        _require_user(user_id)
        if not storage.mark_notification_read(user_id, notification_id):
            raise LookupError(f"no notification {notification_id}")
        return jsonify({"read": True})

    @app.get("/api/evaluation")
    def evaluation():
        path = PROJECT_ROOT / "data" / "evaluation.json"
        if not path.exists():
            raise LookupError("No evaluation has been run yet. Run `python scripts/run_evaluation.py`.")
        return app.response_class(path.read_text(), mimetype="application/json")

    @app.post("/api/ingest/validate")
    def ingest_validate():
        """Dry run of the privacy wall: validates a payload and stores NOTHING."""
        clean = validate_feature_payload(_json_body())
        return jsonify({"accepted": True, "stored": False, "normalised": clean})

    @app.post("/api/ingest")
    def ingest():
        """Accept one payload or {"sessions": [...]}; every item passes the privacy wall."""
        body = _json_body()
        items = body["sessions"] if isinstance(body.get("sessions"), list) else [body]
        if not 1 <= len(items) <= 500:
            raise ValueError("send between 1 and 500 sessions per request")
        clean = [validate_feature_payload(item) for item in items]
        for user_id in {c["user_id"] for c in clean}:
            if storage.get_user(user_id) is None:
                storage.upsert_user(user_id, user_id)
        return jsonify({"stored": storage.insert_sessions(clean)}), 201

    @app.get("/api/users/<user_id>/series")
    def series(user_id: str):
        """Daily means per metric (for charts), optionally cut off at ?as_of=."""
        _require_user(user_id)
        as_of = _optional_day(request.args.get("as_of"))
        sessions = storage.fetch_sessions(user_id, as_of)
        data = {m: [{"day": d.isoformat(), "value": round(v, 4)} for d, v in stats.daily_means(sessions, m).items()]
                for m in METRIC_KEYS}
        first = sessions[0]["day"] if sessions else None
        return jsonify({"user_id": user_id, "as_of": as_of, "first_day": first, "series": data})

    @app.get("/api/users/<user_id>/screen")
    def screen(user_id: str):
        """The deterministic screen only (no model calls): instant and free, ideal for sliders."""
        _require_user(user_id)
        return jsonify(_screen(user_id, _optional_day(request.args.get("as_of"))))

    @app.get("/api/users/<user_id>/overview")
    def overview(user_id: str):
        """Everything the person-facing pages need in one call."""
        user = _require_user(user_id)
        as_of = _optional_day(request.args.get("as_of"))
        screen_result = _screen(user_id, as_of)
        signal = screen_result.get("overall_signal", "insufficient_data")
        policy = policy_for(signal)
        latest = storage.get_latest_analysis(user_id)
        latest_final = None
        if latest:
            latest_final = {**latest["final"], "run_id": latest["run_id"], "as_of": latest["as_of"],
                            "is_current": latest["as_of"] == screen_result.get("as_of")}
        settings = get_settings()
        last = storage.last_session(user_id)
        return jsonify({
            "user": user,
            "screen": screen_result,
            "min_history_days": settings.min_history_days,
            "template": {"headline": policy.headline,
                         "recommendation": policy.default_recommendation,
                         "patient_message": SAFE_PATIENT_MESSAGES[policy.default_recommendation]},
            "latest_analysis": latest_final,
            "plans": [{"memory_id": m["id"], "day": m["day"], "plan": m["text"]}
                      for m in storage.get_memories(user_id, "plan", limit=10)],
            "last_payload": ({k: v for k, v in last.items() if k in ALLOWED_FIELDS and v is not None}
                             if last else None),
            "checkin_available": settings.checkin_consent and user["checkin_consent"],
            "notifications": storage.list_notifications(user_id, unread_only=True, limit=5),
        })

    @app.post("/api/users/<user_id>/analyze")
    def analyze(user_id: str):
        """Synchronous analysis (kept for scripts and tests). The UI uses /analyze/async."""
        _require_user(user_id)
        body = request.get_json(silent=True) or {}
        result = asyncio.run(run_analysis(user_id, _optional_day(body.get("as_of")), models(),
                                          use_cache=not body.get("force")))
        return jsonify(result)

    @app.post("/api/users/<user_id>/analyze/async")
    def analyze_async(user_id: str):
        _require_user(user_id)
        body = request.get_json(silent=True) or {}
        job_id = jobs.start_analysis_job(user_id, _optional_day(body.get("as_of")), models,
                                         force=bool(body.get("force")))
        return jsonify({"job_id": job_id}), 202

    @app.get("/api/jobs/<job_id>")
    def job_status(job_id: str):
        job = jobs.STORE.get(job_id)
        if job is None:
            raise LookupError(f"no job '{job_id}'")
        return jsonify(job)

    @app.get("/api/users/<user_id>/analysis/latest")
    def latest_analysis(user_id: str):
        _require_user(user_id)
        result = storage.get_latest_analysis(user_id)
        if result is None:
            raise LookupError(f"no analysis stored yet for '{user_id}'")
        return jsonify(result)

    @app.get("/api/users/<user_id>/runs")
    def list_runs(user_id: str):
        _require_user(user_id)
        return jsonify({"runs": storage.list_runs(user_id, limit=min(int(request.args.get("limit", 20)), 100))})

    @app.get("/api/runs/<run_id>")
    def get_run(run_id: str):
        result = storage.get_run(run_id)
        if result is None:
            raise LookupError(f"no run '{run_id}'")
        return jsonify(result)

    @app.get("/api/users/<user_id>/plans")
    def plans(user_id: str):
        _require_user(user_id)
        return jsonify({"plans": [{"memory_id": m["id"], "day": m["day"], "plan": m["text"]}
                                  for m in storage.get_memories(user_id, "plan", limit=50)]})

    @app.delete("/api/users/<user_id>/plans/<int:memory_id>")
    def delete_plan(user_id: str, memory_id: int):
        _require_user(user_id)
        if not storage.delete_memory(user_id, memory_id):
            raise LookupError(f"no remembered item {memory_id}")
        return jsonify({"deleted": True})

    @app.post("/api/users/<user_id>/checkin")
    def checkin(user_id: str):
        _require_user(user_id)
        body = request.get_json(silent=True) or {}
        fast = (models() or {}).get("fast")
        result = asyncio.run(generate_checkin(user_id, _optional_day(body.get("today")),
                                              {"fast": fast} if fast else None))
        return jsonify(result)

    @app.post("/api/users/<user_id>/checkin/reply")
    def checkin_reply(user_id: str):
        _require_user(user_id)
        body = _json_body()
        text = str(body.get("reply", "")).strip()
        if not text:
            raise ValueError("'reply' is required")
        fast = (models() or {}).get("fast")
        result = asyncio.run(evaluate_reply(user_id, text, _optional_day(body.get("today")),
                                            body.get("plan_memory_id"), {"fast": fast} if fast else None))
        return jsonify(result)

    @app.get("/", defaults={"path": ""})
    @app.get("/<path:path>")
    def spa(path: str):
        if path.startswith("api/"):
            return _error(404, "not_found", f"no such endpoint: /{path}")
        if not (dist / "index.html").exists():
            return _error(404, "frontend_not_built",
                          "The web app is not built. Run `npm install && npm run build` in frontend/, "
                          "or use the Vite dev server (npm run dev).")
        target = dist / path
        if path and target.is_file():
            return send_from_directory(dist, path)
        return send_from_directory(dist, "index.html")  # client-side routes

    return app


if __name__ == "__main__":
    settings = get_settings()
    create_app().run(host=settings.flask_host, port=settings.flask_port, debug=False, threaded=True)
