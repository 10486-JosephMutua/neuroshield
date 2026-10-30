"""Logging helpers.

configure_logging(component) logs to the console and to logs/<component>.log.
log_step wraps a function and logs its start, duration and any failure.
Only identifiers, counts and timings are logged, never typed text, check-in replies
or full payloads."""
from __future__ import annotations

import functools
import inspect
import logging
import sys
import time
from logging.handlers import RotatingFileHandler

from backend.config import get_settings

_LOG_FORMAT = "%(asctime)s | %(levelname)-7s | %(name)-28s | %(message)s"
_configured_components: set[str] = set()


def configure_logging(component: str = "neuroshield") -> None:
    """Attach console + rotating-file handlers to the root logger (idempotent)."""
    if component in _configured_components:
        return
    settings = get_settings()
    settings.log_dir.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger()
    root.setLevel(settings.log_level)
    formatter = logging.Formatter(_LOG_FORMAT)

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(formatter)
    root.addHandler(console)

    file_handler = RotatingFileHandler(
        settings.log_dir / f"{component}.log",
        maxBytes=2_000_000,
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)

    # Third-party libraries are chatty at INFO; keep our own logs readable.
    for noisy in ("httpx", "httpcore", "mcp", "fastmcp", "uvicorn.access", "werkzeug"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    _configured_components.add(component)
    logging.getLogger("neuroshield.logging").info(
        "Logging configured for component=%s level=%s dir=%s",
        component, settings.log_level, settings.log_dir,
    )


def get_logger(name: str) -> logging.Logger:
    """Return a logger namespaced under `neuroshield.`"""
    return logging.getLogger(f"neuroshield.{name}")


def log_step(step_name: str | None = None):
    """
    Decorator: log start, success (with duration) or failure of a function.

    Works for both sync and async functions.
    """

    def decorator(func):
        name = step_name or func.__qualname__
        logger = get_logger("step")

        if inspect.iscoroutinefunction(func):
            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                started = time.perf_counter()
                logger.info("▶ %s started", name)
                try:
                    result = await func(*args, **kwargs)
                except Exception:
                    logger.exception("%s failed after %.0f ms", name, (time.perf_counter() - started) * 1000)
                    raise
                logger.info("%s finished in %.0f ms", name, (time.perf_counter() - started) * 1000)
                return result

            return async_wrapper

        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            started = time.perf_counter()
            logger.info("▶ %s started", name)
            try:
                result = func(*args, **kwargs)
            except Exception:
                logger.exception("%s failed after %.0f ms", name, (time.perf_counter() - started) * 1000)
                raise
            logger.info("%s finished in %.0f ms", name, (time.perf_counter() - started) * 1000)
            return result

        return sync_wrapper

    return decorator
