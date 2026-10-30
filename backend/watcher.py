"""Always-on Watch: a background loop that re-screens each person on a schedule and
notifies only when something changed.

  - a signal becomes more serious          -> notification
  - a raised signal returns to steady      -> "back to steady" notification
  - nothing changed                        -> no notification and no model call

Optional: NEUROSHIELD_WATCHER_AUTO_ANALYZE also starts the full analysis when a sustained
change appears (at most once a day per person). Tomorrow's check-in can be generated
ahead of time. Notification text is fixed wording, never written by a model."""
from __future__ import annotations

import asyncio
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from backend import jobs, stats, storage
from backend.agents.checkin import generate_checkin
from backend.config import get_settings
from backend.guardrails import SAFE_PATIENT_MESSAGES
from backend.logging_setup import get_logger

log = get_logger("watcher")

SEVERITY = {"insufficient_data": 0, "stable": 0, "minor_fluctuation": 0, "acute_change": 1,
            "motor_only_change": 1, "single_domain_drift": 2, "sustained_multi_domain_drift": 3}

TITLES = {
    "sustained_multi_domain_drift": "A steady change was noticed",
    "single_domain_drift": "A change in one area was noticed",
    "motor_only_change": "Your typing mechanics changed",
    "acute_change": "A recent short-lived change",
}
BODIES = {
    "sustained_multi_domain_drift": SAFE_PATIENT_MESSAGES["suggest_routine_checkup"],
    "single_domain_drift": SAFE_PATIENT_MESSAGES["keep_monitoring"],
    "motor_only_change": ("The way you press keys has changed while the rest looks the same. "
                          "A new keyboard or device is a common reason."),
    "acute_change": ("We noticed a recent change that has not lasted long. Tiredness or a busy week "
                     "are common reasons. We will keep an eye on it."),
}
RESOLVED_BODY = "Your patterns are back in your usual range."


def scan_user(user_id: str, models_provider: Callable[[], dict[str, Any] | None] | None = None,
              auto_analyze: bool = False) -> dict[str, Any]:
    """Screen one person now, compare with last time, and notify only if something changed."""
    sessions = storage.fetch_sessions(user_id)
    screen = stats.run_screen(sessions) if sessions else {"overall_signal": "insufficient_data", "as_of": None}
    signal = screen["overall_signal"]
    as_of = screen.get("as_of") or ""
    previous = storage.get_watch_state(user_id)
    prev_signal = previous["last_signal"] if previous else None
    severity, prev_severity = SEVERITY.get(signal, 0), SEVERITY.get(prev_signal, 0)

    notified = None
    if severity > prev_severity and signal in TITLES:
        notified = storage.add_notification(user_id, "change_detected", TITLES[signal], BODIES[signal], signal)
    elif severity == 0 and prev_severity >= 1:
        notified = storage.add_notification(user_id, "resolved", "Back to steady", RESOLVED_BODY, signal)

    analysis_started = False
    last_analysis = previous["last_analysis"] if previous else None
    if auto_analyze and severity >= 2 and as_of:
        recent = last_analysis and (datetime.now(timezone.utc) - datetime.fromisoformat(last_analysis)) < timedelta(hours=24)
        if not recent:
            jobs.start_analysis_job(user_id, as_of, models_provider)
            analysis_started = True
            last_analysis = datetime.now(timezone.utc).isoformat(timespec="seconds")

    if as_of:
        storage.set_watch_state(user_id, signal, as_of, last_analysis)
    log.info("Watch: user=%s signal=%s (was %s) notified=%s analysis_started=%s", user_id, signal, prev_signal,
             bool(notified), analysis_started)
    return {"user_id": user_id, "signal": signal, "previous_signal": prev_signal, "notified": bool(notified),
            "analysis_started": analysis_started}


def scan_all(models_provider: Callable[[], dict[str, Any] | None] | None = None, include_synthetic: bool = False,
             auto_analyze: bool = False) -> list[dict[str, Any]]:
    """Scan everyone (real people by default). One person's failure never stops the others."""
    results = []
    for user in storage.list_users():
        if user["is_synthetic"] and not include_synthetic:
            continue
        try:
            results.append(scan_user(user["user_id"], models_provider, auto_analyze))
        except Exception:  # noqa: BLE001
            log.exception("Watch failed for user %s", user["user_id"])
    return results


def prepare_checkins(models_provider: Callable[[], dict[str, Any] | None] | None) -> int:
    """Generate today's check-in message ahead of time for everyone who opted in. Returns how many were prepared."""
    if models_provider is None:
        return 0
    prepared = 0
    for user in storage.list_users():
        if user["is_synthetic"] or not user["checkin_consent"] or not get_settings().checkin_consent:
            continue
        try:
            models = models_provider()
            result = asyncio.run(generate_checkin(user["user_id"], models={"fast": models["fast"]} if models else None))
            prepared += 0 if result.get("cached") else 1
        except Exception as exc:  # noqa: BLE001 - a model hiccup must not kill the watcher
            log.warning("Could not prepare check-in for %s: %s", user["user_id"], exc)
    return prepared


class Watcher:
    """Runs `scan_all` every N minutes on a daemon thread."""

    def __init__(self, models_provider: Callable[[], dict[str, Any] | None] | None = None) -> None:
        self.models_provider = models_provider
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.last_scan_at: str | None = None
        self.last_results: list[dict[str, Any]] = []

    def run_once(self) -> list[dict[str, Any]]:
        settings = get_settings()
        self.last_results = scan_all(self.models_provider, auto_analyze=settings.watcher_auto_analyze)
        prepare_checkins(self.models_provider)
        self.last_scan_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        return self.last_results

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        interval = get_settings().watcher_interval_minutes * 60
        log.info("Watcher started: scanning every %d minutes", interval // 60)

        def loop() -> None:
            while not self._stop.is_set():
                try:
                    self.run_once()
                except Exception:  # noqa: BLE001
                    log.exception("Watcher cycle failed")
                self._stop.wait(interval)

        self._thread = threading.Thread(target=loop, name="neuroshield-watcher", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def status(self) -> dict[str, Any]:
        settings = get_settings()
        return {"enabled": settings.watcher_enabled, "running": bool(self._thread and self._thread.is_alive()),
                "interval_minutes": settings.watcher_interval_minutes, "auto_analyze": settings.watcher_auto_analyze,
                "last_scan_at": self.last_scan_at, "last_changes": sum(1 for r in self.last_results if r["notified"])}
