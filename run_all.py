"""Start everything for local use or a single-machine demo:

    python run_all.py

Launches the four MCP servers, waits until they accept connections, then runs the Flask
app, which also serves the built React app from frontend/dist. Ctrl+C stops everything."""
from __future__ import annotations

import signal
import socket
import subprocess
import sys
import time

from backend.config import get_settings
from backend.logging_setup import configure_logging, get_logger

MODULES = ("backend.mcp_servers.biomarker_server", "backend.mcp_servers.memory_server",
           "backend.mcp_servers.report_server", "backend.mcp_servers.evidence_server")


def _wait_for_port(host: str, port: int, timeout: float = 40.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5)
            if sock.connect_ex((host, port)) == 0:
                return True
        time.sleep(0.25)
    return False


def main() -> int:
    configure_logging("run_all")
    log = get_logger("run_all")
    settings = get_settings()
    children = [subprocess.Popen([sys.executable, "-m", m]) for m in MODULES]

    def stop(*_):
        log.info("Stopping...")
        for child in children:
            child.terminate()
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
        sys.exit(0)

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    for name, port in settings.mcp_ports.items():
        if not _wait_for_port(settings.mcp_host, port):
            log.error("MCP server '%s' did not start on port %d", name, port)
            stop()
    log.info("MCP servers are up. Starting the web app on http://%s:%d", settings.flask_host, settings.flask_port)

    from backend.app import create_app  # imported late so logging is configured first

    try:
        create_app().run(host=settings.flask_host, port=settings.flask_port, debug=False, threaded=True)
    finally:
        stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
