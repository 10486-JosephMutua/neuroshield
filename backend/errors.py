"""Maps exceptions to (HTTP status, error code, friendly message).

Shared by the Flask error handlers and background jobs, so a failure looks the same
in both places."""
from __future__ import annotations

from backend.agents.checkin import ConsentRequired
from backend.agents.common import AgentOutputError
from backend.graph.pipeline import UnknownUserError
from backend.llm import ConfigError
from backend.logging_setup import get_logger
from backend.mcp_client import McpUnavailable
from backend.schemas import PayloadError

log = get_logger("errors")


def describe_error(exc: BaseException) -> tuple[int, str, str]:
    """Return (status, code, message) for any exception."""
    if isinstance(exc, PayloadError):
        return 400, "invalid_payload", str(exc)
    if isinstance(exc, UnknownUserError) or isinstance(exc, LookupError):
        return 404, "not_found", str(exc.args[0]) if exc.args else "not found"
    if isinstance(exc, ValueError):
        return 400, "bad_request", str(exc)
    if isinstance(exc, McpUnavailable):
        return 503, "mcp_unavailable", str(exc)
    if isinstance(exc, ConfigError):
        return 503, "not_configured", str(exc)
    if isinstance(exc, ConsentRequired):
        return 403, "consent_required", str(exc)
    if isinstance(exc, AgentOutputError):
        log.error("Agent output error: %s", exc)
        return 502, "model_output_invalid", "The model returned an unusable answer. Please retry."
    log.exception("Unhandled error", exc_info=exc)
    return 500, "internal_error", "Unexpected server error. See the server log."
