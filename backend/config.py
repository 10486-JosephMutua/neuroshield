"""Central configuration.

All settings are read from environment variables or a local .env file. Nothing else
in the code base calls os.getenv."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")


def _flag(name: str, default: bool) -> bool:
    """Read a true/false environment variable."""
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


def _resolve_path(value: str) -> Path:
    """Treat relative paths as relative to the project root."""
    path = Path(value)
    return path if path.is_absolute() else PROJECT_ROOT / path


@dataclass(frozen=True)
class Settings:
    nebius_api_key: str
    nebius_base_url: str
    model_analyst: str  # heavy reasoning model (Nemotron 3 Ultra)
    model_fast: str     # cheap, quick model (Nemotron 3 Nano)

    mcp_host: str
    biomarker_port: int
    memory_port: int
    report_port: int
    evidence_port: int

    flask_host: str
    flask_port: int

    db_path: Path
    log_dir: Path
    log_level: str

    checkin_consent: bool
    max_verify_attempts: int
    analysis_cache: bool          # reuse an identical, still-valid analysis instead of paying for another
    max_concurrent_analyses: int  # how many analyses may call the models at the same time

    checkin_base_url: str
    checkin_model: str
    checkin_api_key: str

    watcher_enabled: bool
    watcher_interval_minutes: int
    watcher_auto_analyze: bool

    tavily_api_key: str

    baseline_days: int = 28
    min_history_days: int = 42
    recent_days: int = 14

    @property
    def checkin_is_local(self) -> bool:
        """True when check-in text is processed by a model you run yourself, not the cloud."""
        return bool(self.checkin_base_url)

    @property
    def mcp_servers(self) -> dict[str, str]:
        """Server name -> streamable-HTTP URL (FastMCP serves at /mcp)."""
        base = f"http://{self.mcp_host}"
        return {
            "biomarkers": f"{base}:{self.biomarker_port}/mcp",
            "memory": f"{base}:{self.memory_port}/mcp",
            "report": f"{base}:{self.report_port}/mcp",
            "evidence": f"{base}:{self.evidence_port}/mcp",
        }

    @property
    def mcp_config(self) -> dict:
        """The `MCPConfig` dict shape expected by `langchain.mcp.MCPAdapter`."""
        return {"mcpServers": {name: {"url": url} for name, url in self.mcp_servers.items()}}

    @property
    def mcp_ports(self) -> dict[str, int]:
        return {
            "biomarkers": self.biomarker_port,
            "memory": self.memory_port,
            "report": self.report_port,
            "evidence": self.evidence_port,
        }


def get_settings() -> Settings:
    """Build settings from the *current* environment (cheap; safe to call often)."""
    return Settings(
        nebius_api_key=os.getenv("NEBIUS_API_KEY", ""),
        nebius_base_url=os.getenv("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1/"),
        model_analyst=os.getenv("NEUROSHIELD_MODEL_ANALYST", "nvidia/Nemotron-3-Ultra-550b-a55b"),
        model_fast=os.getenv("NEUROSHIELD_MODEL_FAST", "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"),
        mcp_host=os.getenv("NEUROSHIELD_MCP_HOST", "127.0.0.1"),
        biomarker_port=int(os.getenv("NEUROSHIELD_BIOMARKER_PORT", "8101")),
        memory_port=int(os.getenv("NEUROSHIELD_MEMORY_PORT", "8102")),
        report_port=int(os.getenv("NEUROSHIELD_REPORT_PORT", "8103")),
        evidence_port=int(os.getenv("NEUROSHIELD_EVIDENCE_PORT", "8104")),
        flask_host=os.getenv("NEUROSHIELD_FLASK_HOST", "127.0.0.1"),
        flask_port=int(os.getenv("NEUROSHIELD_FLASK_PORT", "5000")),
        db_path=_resolve_path(os.getenv("NEUROSHIELD_DB_PATH", "data/neuroshield.db")),
        log_dir=_resolve_path(os.getenv("NEUROSHIELD_LOG_DIR", "logs")),
        log_level=os.getenv("NEUROSHIELD_LOG_LEVEL", "INFO").upper(),
        checkin_consent=_flag("NEUROSHIELD_CHECKIN_CONSENT", True),
        max_verify_attempts=int(os.getenv("NEUROSHIELD_MAX_VERIFY_ATTEMPTS", "2")),
        analysis_cache=_flag("NEUROSHIELD_ANALYSIS_CACHE", True),
        max_concurrent_analyses=max(1, int(os.getenv("NEUROSHIELD_MAX_CONCURRENT_ANALYSES", "2"))),
        checkin_base_url=os.getenv("NEUROSHIELD_CHECKIN_BASE_URL", "").strip(),
        checkin_model=os.getenv("NEUROSHIELD_CHECKIN_MODEL", "nemotron-3-nano:30b").strip(),
        checkin_api_key=os.getenv("NEUROSHIELD_CHECKIN_API_KEY", "local").strip(),
        watcher_enabled=_flag("NEUROSHIELD_WATCHER", False),
        watcher_interval_minutes=max(1, int(os.getenv("NEUROSHIELD_WATCHER_INTERVAL_MINUTES", "60"))),
        watcher_auto_analyze=_flag("NEUROSHIELD_WATCHER_AUTO_ANALYZE", False),
        tavily_api_key=os.getenv("TAVILY_API_KEY", "").strip(),
    )
