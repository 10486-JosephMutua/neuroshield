"""Launch the four MCP servers as child processes and keep them running:

    python run_mcp_servers.py

Each server logs to the console and to logs/mcp_<name>.log. Ctrl+C stops them all.
A single server can also be started on its own, for example
`python -m backend.mcp_servers.biomarker_server`."""
from __future__ import annotations

import signal
import socket
import subprocess
import sys
import time

from backend.config import get_settings
from backend.logging_setup import configure_logging, get_logger

MODULES = {
    "biomarkers": "backend.mcp_servers.biomarker_server",
    "memory": "backend.mcp_servers.memory_server",
    "report": "backend.mcp_servers.report_server",
    "evidence": "backend.mcp_servers.evidence_server",
}


def _wait_for_port(host: str, port: int, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5)
            if sock.connect_ex((host, port)) == 0:
                return True
        time.sleep(0.25)
    return False


def main() -> int:
    configure_logging("launcher")
    log = get_logger("launcher")
    settings = get_settings()
    processes: dict[str, subprocess.Popen] = {}

    def shutdown(*_):
        log.info("Stopping MCP servers...")
        for name, proc in processes.items():
            proc.terminate()
        for proc in processes.values():
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    for name, module in MODULES.items():
        log.info("Launching %s server (%s)", name, module)
        processes[name] = subprocess.Popen([sys.executable, "-m", module])

    for name, port in settings.mcp_ports.items():
        if _wait_for_port(settings.mcp_host, port):
            log.info("%s server is accepting connections on port %d", name, port)
        else:
            log.error("%s server did not start on port %d", name, port)
            shutdown()

    log.info("All MCP servers are up. Press Ctrl+C to stop.")
    while True:
        for name, proc in processes.items():
            if proc.poll() is not None:
                log.error("Server %s exited unexpectedly with code %s", name, proc.returncode)
                shutdown()
        time.sleep(1)


if __name__ == "__main__":
    sys.exit(main())
