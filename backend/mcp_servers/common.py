"""Shared helpers for the MCP servers.

Each server is a FastMCP app served over streamable HTTP at http://<host>:<port>/mcp.
`logged_tool` logs the tool name, argument names, user_id and duration, and never other
argument values, which may contain check-in text. `serve` starts a server with the
host and port from backend.config."""
from __future__ import annotations

import functools
import time
from typing import Callable

from fastmcp import FastMCP

from backend.config import get_settings
from backend.logging_setup import configure_logging, get_logger


def logged_tool(server_name: str) -> Callable:
    """Decorator factory: log each MCP tool call. Apply BELOW `@mcp.tool`."""
    log = get_logger(f"mcp.{server_name}")

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)  # keeps the signature so FastMCP can build the tool schema
        def wrapper(*args, **kwargs):
            started = time.perf_counter()
            log.info("▶ tool=%s user=%s args=%s", func.__name__, kwargs.get("user_id"), sorted(kwargs))
            try:
                result = func(*args, **kwargs)
            except Exception as exc:
                log.error("tool=%s failed: %s: %s", func.__name__, type(exc).__name__, exc)
                raise
            log.info("tool=%s done in %.0f ms", func.__name__, (time.perf_counter() - started) * 1000)
            return result

        return wrapper

    return decorator


def serve(mcp: FastMCP, server_name: str, port: int) -> None:
    """Configure logging and run the server over streamable HTTP."""
    configure_logging(f"mcp_{server_name}")
    host = get_settings().mcp_host
    get_logger(f"mcp.{server_name}").info("Starting MCP server '%s' on http://%s:%d/mcp", server_name, host, port)
    mcp.run(transport="http", host=host, port=port)
