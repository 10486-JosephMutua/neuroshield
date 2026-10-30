"""Daily check-in assistant.

generate_checkin writes a short morning message that asks about yesterday's plan.
evaluate_reply scores the person's reply (delayed recall) and stores any new plan.

This is the only feature where conversational text reaches a cloud model. It needs the
person's opt-in and can be disabled server-wide with NEUROSHIELD_CHECKIN_CONSENT=false.
Only the numeric recall score and a short plan note (stored locally) are kept."""
from __future__ import annotations

import json
from datetime import date
from typing import Any

from backend.agents import prompts
from backend.agents.common import build_agent, run_json_agent
from backend.agents.schemas import CheckinMessage, RecallScore
from backend import storage
from backend.config import get_settings
from backend.llm import UsageTracker, get_chat_model
from backend.logging_setup import get_logger, log_step
from backend.mcp_client import ToolBox, open_toolbox

log = get_logger("checkin")


class ConsentRequired(RuntimeError):
    """Raised when the check-in feature is disabled by configuration."""


def _require_consent(user_id: str) -> None:
    """The check-in sends chat text to the cloud model, so it needs the person's own opt-in."""
    if not get_settings().checkin_consent:
        raise ConsentRequired("Check-in is disabled on this server (NEUROSHIELD_CHECKIN_CONSENT=false).")
    user = storage.get_user(user_id)
    if user is None or not user["checkin_consent"]:
        raise ConsentRequired("The daily check-in is turned off for this person. It can be turned on in Privacy.")


async def _known_plans(toolbox: ToolBox, user_id: str, today: str, limit: int = 10) -> list[dict[str, Any]]:
    result = await toolbox.call("memory", "recall_recent_plans", user_id=user_id, before_day=today, limit=limit)
    return result.get("plans", []) if isinstance(result, dict) else []


@log_step("check-in: generate message")
async def generate_checkin(user_id: str, today: str | None = None, models: dict | None = None,
                           toolbox: ToolBox | None = None, fresh: bool = False) -> dict[str, Any]:
    """Create the morning message. Returns {message, plan_memory_id, asks_for_new_plan, usage}."""
    _require_consent(user_id)
    today = today or date.today().isoformat()
    cached = None if fresh else storage.get_memory_for_day(user_id, "checkin_cache", today)
    if cached:  # the same question all day, instantly, and no second model call
        log.info("Check-in for %s served from today's cache", user_id)
        return {"message": cached["text"], "plan_memory_id": cached["meta"].get("plan_memory_id"),
                "asks_for_new_plan": cached["meta"].get("asks_for_new_plan", True), "cached": True,
                "usage": UsageTracker().summary()}
    models = models or {"fast": get_chat_model("checkin")}
    tracker = UsageTracker()
    config = {"callbacks": [tracker]}

    async def _run(box: ToolBox) -> dict[str, Any]:
        agent = build_agent(models["fast"], box.for_server("memory", exclude=("remember_plan", "record_recall_outcome")),
                            prompts.CHECKIN_PROMPT, "checkin_companion")
        request = json.dumps({"user_id": user_id, "today": today})
        reply = await run_json_agent(agent, request, CheckinMessage, config, models["fast"], "checkin")
        # Code, not the model, decides which plan id is valid.
        plans = await _known_plans(box, user_id, today)
        valid_ids = {p["memory_id"] for p in plans}
        plan_id = reply.plan_memory_id if reply.plan_memory_id in valid_ids else None
        return {"message": reply.message, "plan_memory_id": plan_id, "asks_for_new_plan": reply.asks_for_new_plan}

    if toolbox is not None:
        result = await _run(toolbox)
    else:
        async with open_toolbox() as box:
            result = await _run(box)
    storage.add_memory(user_id, today, "checkin_cache", result["message"],
                       {"plan_memory_id": result["plan_memory_id"], "asks_for_new_plan": result["asks_for_new_plan"]})
    return {**result, "cached": False, "usage": tracker.summary()}


@log_step("check-in: evaluate reply")
async def evaluate_reply(user_id: str, reply_text: str, today: str | None = None, plan_memory_id: int | None = None,
                         models: dict | None = None, toolbox: ToolBox | None = None) -> dict[str, Any]:
    """Score the person's reply, store the score, and remember any new plan."""
    _require_consent(user_id)
    today = today or date.today().isoformat()
    models = models or {"fast": get_chat_model("checkin")}
    tracker = UsageTracker()
    config = {"callbacks": [tracker]}

    async def _run(box: ToolBox) -> dict[str, Any]:
        plans = await _known_plans(box, user_id, today)
        plan = next((p for p in plans if p["memory_id"] == plan_memory_id), None)
        agent = build_agent(models["fast"], [], prompts.RECALL_SCORING_PROMPT, "recall_scorer")
        request = json.dumps({"PLAN": plan["plan"] if plan else None, "REPLY": reply_text[:1000]})
        scored = await run_json_agent(agent, request, RecallScore, config, models["fast"], "recall-scoring")

        await box.call("memory", "record_recall_outcome", user_id=user_id, day=today,
                       recall_score=scored.recall_score, plan_memory_id=plan_memory_id)
        new_plan_id = None
        if scored.new_plan and scored.new_plan.strip():
            stored = await box.call("memory", "remember_plan", user_id=user_id, day=today, plan_text=scored.new_plan)
            new_plan_id = stored.get("memory_id")
        return {"recall_score": scored.recall_score, "new_plan_memory_id": new_plan_id}

    if toolbox is not None:
        result = await _run(toolbox)
    else:
        async with open_toolbox() as box:
            result = await _run(box)
    return {**result, "usage": tracker.summary()}
