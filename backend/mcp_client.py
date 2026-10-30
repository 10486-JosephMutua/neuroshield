"""MCP client helpers built on `langchain.mcp.MCPAdapter`.

This is the only module that imports the adapter (it is in beta), so an API change
only touches this file. When several servers are configured the adapter skips the ones
it cannot reach, so `open_toolbox` checks that every expected tool is present and raises
`McpUnavailable` otherwise."""
from __future__ import annotations

import json
import warnings
from contextlib import AsyncExitStack, asynccontextmanager
from typing import Any, AsyncIterator

from langchain.mcp import MCPAdapter

from backend.config import get_settings
from backend.logging_setup import get_logger

log = get_logger("mcp_client")

# Silence the adapter's one-off beta warning.
warnings.filterwarnings("ignore", message=".*beta.*")

# Tools (without the "<server>_" prefix) that must exist for the app to work.
EXPECTED_TOOLS: dict[str, tuple[str, ...]] = {
    "biomarkers": ("list_metrics", "get_data_coverage", "run_statistical_screen",
                   "get_metric_weekly_series", "compare_windows"),
    "memory": ("remember_plan", "recall_recent_plans", "record_recall_outcome"),
    "report": ("get_limitations", "build_clinician_report"),
    "evidence": ("find_background_reading",),
}


class McpUnavailable(RuntimeError):
    """Raised when the MCP servers are unreachable or incomplete."""


def parse_tool_result(result: Any) -> Any:
    """
    Turn whatever an MCP tool returned into plain Python data.

    The adapter returns a list of content blocks such as
    [{"type": "text", "text": "{...json...}"}]; plain strings and dicts are
    also handled.
    """
    if isinstance(result, list):
        texts = [b.get("text", "") for b in result if isinstance(b, dict) and b.get("type") == "text"]
        result = "".join(texts)
    if isinstance(result, str):
        try:
            return json.loads(result)
        except json.JSONDecodeError:
            return result
    return result


class ToolBox:
    """A small convenience wrapper over the loaded LangChain tools."""

    def __init__(self, tools: list[Any]):
        self._by_name = {t.name: t for t in tools}

    def tool(self, server: str, name: str) -> Any:
        return self._by_name[f"{server}_{name}"]

    def for_server(self, server: str, exclude: tuple[str, ...] = ()) -> list[Any]:
        """All tools of one server (e.g. to hand to an agent)."""
        prefix = f"{server}_"
        return [t for n, t in self._by_name.items()
                if n.startswith(prefix) and n[len(prefix):] not in exclude]

    async def call(self, server: str, name: str, **arguments: Any) -> Any:
        """Call one tool directly (used by deterministic graph nodes) and parse the result."""
        log.info("MCP call %s.%s args=%s", server, name, sorted(arguments))
        # Drop None arguments so the server falls back to its own defaults.
        args = {k: v for k, v in arguments.items() if v is not None}
        raw = await self.tool(server, name).ainvoke(args)
        return parse_tool_result(raw)


@asynccontextmanager
async def open_toolbox() -> AsyncIterator[ToolBox]:
    """
    Connect to all MCP servers, verify the toolset, and yield a `ToolBox`.

    The tools keep their own client, so agents built from them stay usable for
    the duration of this context.
    """
    settings = get_settings()
    stack = AsyncExitStack()
    try:
        adapter = await stack.enter_async_context(MCPAdapter(settings.mcp_config))
        tools = await adapter.list_tools()
    except Exception as exc:  # connection problems surface here
        await stack.aclose()
        raise McpUnavailable(
            "Could not reach the MCP servers. Start them with `python run_mcp_servers.py` "
            f"(expected: {settings.mcp_servers})."
        ) from exc

    toolbox = ToolBox(tools)
    names = {t.name for t in tools}
    missing = [f"{s}_{t}" for s, ts in EXPECTED_TOOLS.items() for t in ts if f"{s}_{t}" not in names]
    if missing:
        await stack.aclose()
        raise McpUnavailable(f"Some MCP servers are down or incomplete; missing tools: {missing}")

    log.info("MCP toolbox ready with %d tools", len(tools))
    try:
        yield toolbox
    finally:
        await stack.aclose()
