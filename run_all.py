"""Run the Flask app and all four MCP servers in one Python process.

Production entry point: gunicorn run_all:app --workers 1 --worker-class gthread --threads 4
Each FastMCP server keeps its own HTTP port/tool namespace, but shares one asyncio
 event loop in a background thread instead of spawning four extra interpreters.
"""
from __future__ import annotations

import asyncio
import socket
import threading
import time
from typing import Any

from backend.config import get_settings
from backend.logging_setup import configure_logging, get_logger

configure_logging("run_all")
log = get_logger("run_all")
_SERVER_THREAD: threading.Thread | None = None
_SERVER_ERROR: list[BaseException] = []
_START_LOCK = threading.Lock()
_STARTED = False


def _load_servers() -> list[tuple[str, Any, int]]:
    """Import the four existing MCP apps without starting separate processes."""
    from backend.mcp_servers.biomarker_server import mcp as biomarkers
    from backend.mcp_servers.memory_server import mcp as memory
    from backend.mcp_servers.report_server import mcp as report
    from backend.mcp_servers.evidence_server import mcp as evidence
    settings = get_settings()
    return [
        ("biomarkers", biomarkers, settings.biomarker_port),
        ("memory", memory, settings.memory_port),
        ("report", report, settings.report_port),
        ("evidence", evidence, settings.evidence_port),
    ]


async def _serve_all_mcp() -> None:
    """Serve all four FastMCP apps concurrently on one asyncio event loop."""
    settings = get_settings()
    servers = _load_servers()
    log.info("Starting %d MCP servers in one Python process", len(servers))
    await asyncio.gather(*(
        server.run_async(
            transport="http",
            host=settings.mcp_host,
            port=port,
            show_banner=False,
            stateless_http=True,
        )
        for _name, server, port in servers
    ))


def _mcp_thread_main() -> None:
    try:
        asyncio.run(_serve_all_mcp())
    except BaseException as exc:
        _SERVER_ERROR.append(exc)
        log.exception("MCP server event loop stopped unexpectedly")


def _port_is_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.35):
            return True
    except OSError:
        return False


def start_mcp_servers(timeout: float = 45.0) -> None:
    """Start the MCP event loop once and wait until all four ports accept TCP."""
    global _SERVER_THREAD, _STARTED
    with _START_LOCK:
        if _STARTED:
            return
        settings = get_settings()
        _SERVER_THREAD = threading.Thread(
            target=_mcp_thread_main,
            name="neuroshield-mcp-event-loop",
            daemon=True,
        )
        _SERVER_THREAD.start()
        pending = {
            "biomarkers": settings.biomarker_port,
            "memory": settings.memory_port,
            "report": settings.report_port,
            "evidence": settings.evidence_port,
        }
        deadline = time.monotonic() + timeout
        while pending and time.monotonic() < deadline:
            if _SERVER_ERROR:
                raise RuntimeError("An MCP server failed during startup") from _SERVER_ERROR[0]
            for name, port in list(pending.items()):
                if _port_is_open(settings.mcp_host, port):
                    log.info("MCP server %s is listening on %s:%s", name, settings.mcp_host, port)
                    pending.pop(name)
            if pending:
                time.sleep(0.2)
        if pending:
            raise RuntimeError(
                "MCP startup timed out; ports not ready: "
                + ", ".join(f"{name}:{port}" for name, port in pending.items())
            )
        _STARTED = True


# Gunicorn imports this module in its single worker. Start MCP before exposing WSGI.
start_mcp_servers()

from backend.app import create_app  # noqa: E402
app = create_app()


if __name__ == "__main__":
    settings = get_settings()
    app.run(host=settings.flask_host, port=settings.flask_port, debug=False, threaded=True)
