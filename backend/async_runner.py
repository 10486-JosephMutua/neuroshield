"""Runs coroutines on one long-lived event loop.

Flask views and background threads are synchronous, so they used to call `asyncio.run`, which
creates and closes a new event loop each time. The HTTP client used by the model library is
cached and reused between calls. After the first loop closed, the next analysis picked up a
connection that belonged to the closed loop and failed with "RuntimeError: Event loop is
closed". Keeping a single loop alive for the whole process avoids that.
"""
from __future__ import annotations

import asyncio
import threading
from typing import Any, Coroutine, TypeVar

T = TypeVar("T")

_lock = threading.Lock()
_loop: asyncio.AbstractEventLoop | None = None


def _get_loop() -> asyncio.AbstractEventLoop:
    global _loop
    with _lock:
        if _loop is None or _loop.is_closed():
            loop = asyncio.new_event_loop()
            threading.Thread(target=loop.run_forever, name="async-runner", daemon=True).start()
            _loop = loop
        return _loop


def run_sync(coro: Coroutine[Any, Any, T]) -> T:
    """Run `coro` on the shared loop and block until it finishes. Exceptions propagate to the caller."""
    return asyncio.run_coroutine_threadsafe(coro, _get_loop()).result()
