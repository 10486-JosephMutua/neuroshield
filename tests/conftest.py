"""
Test configuration.

* Every test run gets its own temporary database, log directory and MCP ports,
  set through environment variables BEFORE the app modules are imported.
* The `mcp_servers` fixture starts the real three MCP servers as subprocesses,
  so the offline pipeline test exercises the real MCP tool path. Only the
  language models are replaced by scripted fakes.
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="neuroshield_test_"))
os.environ["NEUROSHIELD_DB_PATH"] = str(_TMP / "test.db")
os.environ["NEUROSHIELD_LOG_DIR"] = str(_TMP / "logs")
os.environ["NEUROSHIELD_LOG_LEVEL"] = "INFO"
os.environ["NEUROSHIELD_BIOMARKER_PORT"] = "18101"
os.environ["NEUROSHIELD_MEMORY_PORT"] = "18102"
os.environ["NEUROSHIELD_REPORT_PORT"] = "18103"
os.environ["NEUROSHIELD_EVIDENCE_PORT"] = "18104"
os.environ["NEUROSHIELD_ANALYSIS_CACHE"] = "false"  # tests script different model outputs for the same run
os.environ["TAVILY_API_KEY"] = ""
os.environ.setdefault("NEBIUS_API_KEY", "test-key-not-used")

ROOT = Path(__file__).resolve().parent.parent
MODULES = ("backend.mcp_servers.biomarker_server", "backend.mcp_servers.memory_server",
           "backend.mcp_servers.report_server", "backend.mcp_servers.evidence_server")
PORTS = (18101, 18102, 18103, 18104)


def _wait(port: int, timeout: float = 40.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket() as sock:
            sock.settimeout(0.5)
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.25)
    raise RuntimeError(f"MCP server on port {port} did not start")


@pytest.fixture(scope="session")
def mcp_servers():
    procs = [subprocess.Popen([sys.executable, "-m", m], cwd=ROOT, env=os.environ.copy(),
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) for m in MODULES]
    try:
        for port in PORTS:
            _wait(port)
        yield
    finally:
        for proc in procs:
            proc.terminate()
        for proc in procs:
            proc.wait(timeout=10)


@pytest.fixture(scope="session")
def seeded_db():
    from datetime import date

    from backend.synthetic import seed_demo_users

    seed_demo_users(start_day=date(2026, 1, 1))
    return date(2026, 1, 1)
