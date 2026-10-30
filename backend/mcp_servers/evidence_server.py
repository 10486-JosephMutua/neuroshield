"""Evidence MCP server: optional background reading for the clinician report, found with Tavily.

Links come from a live search, never from a model's memory. The tool returns
{"enabled": false} unless TAVILY_API_KEY is set. Searches are limited to scholarly
domains and a short allow-list of topics, and results are cached for a week.

Tool: find_background_reading

Run:  python -m backend.mcp_servers.evidence_server"""
from __future__ import annotations

from typing import Any, Callable

from fastmcp import FastMCP

from backend import storage
from backend.config import get_settings
from backend.logging_setup import get_logger
from backend.mcp_servers.common import logged_tool, serve

SERVER_NAME = "evidence"
mcp = FastMCP(SERVER_NAME)
log = get_logger("mcp.evidence")

# Only these topics can be searched; the model never chooses a free-text query.
TOPICS: dict[str, str] = {
    "keystroke_dynamics": "keystroke dynamics typing mild cognitive impairment detection study",
    "typing_language": "lexical diversity writing early cognitive decline longitudinal study",
}
SCHOLARLY_DOMAINS = ["pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov", "jmir.org", "nature.com", "frontiersin.org",
                     "sciencedirect.com", "mdpi.com", "biomedcentral.com", "alzheimers-dementia.org", "springer.com"]


def search_background(client: Any, topic: str, max_results: int = 4) -> list[dict[str, str]]:
    """Run one allow-listed search with `client` (a TavilyClient or a stand-in) and trim the results."""
    response = client.search(query=TOPICS[topic], search_depth="basic", max_results=max_results,
                             include_domains=SCHOLARLY_DOMAINS)
    items = []
    for hit in response.get("results", [])[:max_results]:
        if hit.get("url") and hit.get("title"):
            items.append({"title": str(hit["title"])[:160], "url": str(hit["url"]),
                          "snippet": str(hit.get("content", ""))[:280]})
    return items


def find_with(client_factory: Callable[[], Any], topic: str, max_results: int = 4) -> dict[str, Any]:
    """The tool's logic, separated from the MCP wrapper so it can be tested with a stub client."""
    if topic not in TOPICS:
        raise ValueError(f"unknown topic '{topic}'. Valid: {sorted(TOPICS)}")
    max_results = max(1, min(int(max_results), 6))
    if not get_settings().tavily_api_key:
        return {"enabled": False, "reason": "TAVILY_API_KEY is not set", "results": []}
    key = f"{topic}:{max_results}"
    cached = storage.get_evidence_cache(key)
    if cached is not None:
        return {"enabled": True, "cached": True, "topic": topic, "results": cached}
    try:
        results = search_background(client_factory(), topic, max_results)
    except Exception as exc:  # network, quota or key problems must never break a report
        log.warning("Background-reading search failed: %s: %s", type(exc).__name__, exc)
        return {"enabled": False, "reason": "the literature search is unavailable right now", "results": []}
    storage.put_evidence_cache(key, results)
    return {"enabled": True, "cached": False, "topic": topic, "results": results}


def _tavily_client():
    from tavily import TavilyClient  # imported lazily: the package is optional

    return TavilyClient(api_key=get_settings().tavily_api_key)


@mcp.tool
@logged_tool(SERVER_NAME)
def find_background_reading(topic: str = "keystroke_dynamics", max_results: int = 4) -> dict:
    """Find peer-reviewed background reading for an allow-listed topic (keystroke_dynamics or typing_language)."""
    return find_with(_tavily_client, topic, max_results)


if __name__ == "__main__":
    serve(mcp, SERVER_NAME, get_settings().evidence_port)
