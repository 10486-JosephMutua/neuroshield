"""Memory MCP server: local episodic memory for the check-in agent.

Remembers what the person said they would do and lets the agent ask about it later,
which is how delayed recall is measured. Plan text is stored locally in SQLite only.

Tools: remember_plan, recall_recent_plans, record_recall_outcome

Run:  python -m backend.mcp_servers.memory_server"""
from __future__ import annotations

from datetime import date

from fastmcp import FastMCP

from backend import storage
from backend.config import get_settings
from backend.mcp_servers.common import logged_tool, serve
from backend.schemas import validate_feature_payload

SERVER_NAME = "memory"
mcp = FastMCP(SERVER_NAME)

MAX_PLAN_CHARS = 300


@mcp.tool
@logged_tool(SERVER_NAME)
def remember_plan(user_id: str, day: str, plan_text: str) -> dict:
    """Store a short plan the person mentioned on `day` (YYYY-MM-DD). Returns its memory id."""
    day = date.fromisoformat(day).isoformat()
    plan = plan_text.strip()[:MAX_PLAN_CHARS]
    if not plan:
        raise ValueError("plan_text is empty")
    memory_id = storage.add_memory(user_id, day, "plan", plan)
    return {"memory_id": memory_id, "day": day}


@mcp.tool
@logged_tool(SERVER_NAME)
def recall_recent_plans(user_id: str, before_day: str | None = None, limit: int = 3) -> dict:
    """Return the most recent plans stored before `before_day` (newest first)."""
    limit = max(1, min(int(limit), 10))
    plans = storage.get_memories(user_id, "plan", before_day=before_day, limit=limit)
    return {"plans": [{"memory_id": p["id"], "day": p["day"], "plan": p["text"]} for p in plans]}


@mcp.tool
@logged_tool(SERVER_NAME)
def record_recall_outcome(user_id: str, day: str, recall_score: float, plan_memory_id: int | None = None) -> dict:
    """
    Record how well the person remembered a plan (0.0 - 1.0). The score is also
    written to the biomarker store as the `recall_score` metric for that day.
    """
    day = date.fromisoformat(day).isoformat()
    # Validate through the same data contract every other numeric payload uses.
    payload = validate_feature_payload({
        "user_id": user_id, "session_id": f"{user_id}-{day}-checkin", "day": day,
        "recall_score": float(recall_score),
    })
    storage.insert_sessions([payload])
    storage.add_memory(user_id, day, "recall_outcome", f"recall_score={payload['recall_score']:.2f}",
                       {"plan_memory_id": plan_memory_id})
    return {"stored": True, "day": day, "recall_score": payload["recall_score"]}


if __name__ == "__main__":
    serve(mcp, SERVER_NAME, get_settings().memory_port)
