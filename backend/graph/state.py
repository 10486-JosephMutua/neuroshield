"""LangGraph state.

One typed dict flows through the pipeline. Each node returns only the keys it changes.
`trace` uses an additive reducer so nodes can append events without overwriting each other."""
from __future__ import annotations

import operator
from typing import Annotated, Any, Optional, TypedDict


class PipelineState(TypedDict, total=False):
    user_id: str
    as_of: Optional[str]            # ISO date the analysis is "as of" (time-travel friendly)
    screen: dict[str, Any]          # deterministic statistics (from the biomarker MCP server)
    confounders: dict[str, Any]     # confounder reviewer output
    analysis: dict[str, Any]        # analyst output (latest attempt)
    verification: dict[str, Any]    # verifier verdict + issues
    attempts: int                   # how many analyst attempts have run
    analyst_fallback: bool          # True when the smaller model had to stand in for the analyst
    feedback: str                   # issues from the last verification, fed back to the analyst
    final: dict[str, Any]           # the approved result shown to people
    report: dict[str, Any]          # structured clinician report (from the report MCP server)
    trace: Annotated[list[dict[str, Any]], operator.add]
