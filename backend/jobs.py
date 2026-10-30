"""Background analysis jobs.

A full analysis can take many seconds, so the UI starts a job and polls it:

    POST /api/users/<id>/analyze/async  -> 202 {job_id}
    GET  /api/jobs/<job_id>             -> {status, events[], run_id?, cached?, error?}

Single flight: a second request for the same person and day joins the running job.
Cache: an identical, still-valid analysis is returned immediately (see pipeline.py).
Concurrency: only N analyses call the models at once; the rest wait as "queued".

Jobs live in memory. The result is persisted by the pipeline."""
from __future__ import annotations

import asyncio
import threading
import time
import uuid
from collections import OrderedDict
from typing import Any, Callable

from backend.config import get_settings
from backend.errors import describe_error
from backend.graph.pipeline import run_analysis
from backend.logging_setup import get_logger

log = get_logger("jobs")

MAX_JOBS_KEPT = 200

# What the user sees while the pipeline works; used by the UI stepper.
PIPELINE_STEPS = ("load_screen", "confounder_review", "analyst", "verify", "safety_guard", "build_report")

_slots: threading.BoundedSemaphore | None = None
_slots_size = 0
_slots_lock = threading.Lock()


def _concurrency_slots() -> threading.BoundedSemaphore:
    """The shared limiter, rebuilt if the configured size changes (handy in tests)."""
    global _slots, _slots_size
    size = get_settings().max_concurrent_analyses
    with _slots_lock:
        if _slots is None or size != _slots_size:
            _slots, _slots_size = threading.BoundedSemaphore(size), size
        return _slots


class JobStore:
    """Thread-safe, size-bounded registry of jobs."""

    def __init__(self) -> None:
        self._jobs: "OrderedDict[str, dict[str, Any]]" = OrderedDict()
        self._lock = threading.Lock()

    def get_or_create(self, user_id: str, as_of: str | None, force: bool) -> tuple[dict[str, Any], bool]:
        """Return (job, created). An active job for the same person and day is joined, not duplicated."""
        with self._lock:
            for job in self._jobs.values():
                if (job["user_id"], job["as_of"]) == (user_id, as_of) and job["status"] in ("queued", "running"):
                    return dict(job), False
            job = {"job_id": uuid.uuid4().hex[:12], "user_id": user_id, "as_of": as_of, "status": "queued",
                   "events": [], "run_id": None, "cached": False, "error": None, "force": force,
                   "created_at": time.time(), "steps": list(PIPELINE_STEPS)}
            self._jobs[job["job_id"]] = job
            while len(self._jobs) > MAX_JOBS_KEPT:
                self._jobs.popitem(last=False)
            return dict(job), True

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job, events=list(job["events"])) if job else None

    def update(self, job_id: str, **changes: Any) -> None:
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id].update(changes)

    def add_event(self, job_id: str, event: dict[str, Any]) -> None:
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id]["events"].append(event)


STORE = JobStore()


def start_analysis_job(user_id: str, as_of: str | None,
                       models_provider: Callable[[], dict[str, Any] | None] | None = None,
                       force: bool = False) -> str:
    """Start (or join) an analysis and return its job id immediately."""
    job, created = STORE.get_or_create(user_id, as_of, force)
    job_id = job["job_id"]
    if not created:
        log.info("Joined existing job %s for user=%s as_of=%s", job_id, user_id, as_of)
        return job_id

    def worker() -> None:
        slots = _concurrency_slots()
        with slots:  # waits here while other analyses hold every slot; status stays "queued"
            STORE.update(job_id, status="running")
            log.info("Job %s started (user=%s as_of=%s force=%s)", job_id, user_id, as_of, force)
            try:
                models = models_provider() if models_provider else None
                result = asyncio.run(run_analysis(user_id, as_of, models, on_event=lambda e: STORE.add_event(job_id, e),
                                                  use_cache=not force))
                STORE.update(job_id, status="done", run_id=result["run_id"], cached=bool(result.get("cached")))
                log.info("Job %s finished (run_id=%s cached=%s)", job_id, result["run_id"], result.get("cached"))
            except Exception as exc:  # noqa: BLE001 - reported to the client, never raised in the thread
                status, code, message = describe_error(exc)
                STORE.update(job_id, status="failed", error={"code": code, "message": message, "http_status": status})
                log.error("Job %s failed: %s", job_id, code)

    threading.Thread(target=worker, name=f"job-{job_id}", daemon=True).start()
    return job_id
