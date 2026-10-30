"""Shared agent helpers: JSON extraction, schema validation with one repair attempt,
and a runner for `create_agent` agents."""
from __future__ import annotations

import json
import re
from typing import Any, TypeVar

from langchain.agents import create_agent
from langchain_core.runnables import RunnableConfig
from pydantic import BaseModel, ValidationError

from backend.logging_setup import get_logger

log = get_logger("agents")

T = TypeVar("T", bound=BaseModel)

_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
AGENT_RECURSION_LIMIT = 16  # caps tool-call loops inside one agent run


class AgentOutputError(RuntimeError):
    """Raised when an agent's reply cannot be turned into valid JSON, even after a repair attempt."""


def message_text(content: Any) -> str:
    """Normalise a message's content (string or list of blocks) into plain text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        return "".join(parts)
    return str(content)


def extract_json(text: str) -> dict[str, Any]:
    """
    Pull the first JSON object out of a model reply.

    Handles reasoning models that prepend <think>...</think>, markdown fences,
    and stray prose before/after the object.
    """
    cleaned = _THINK_BLOCK.sub("", text).strip()
    cleaned = re.sub(r"^```(?:json)?|```$", "", cleaned.strip(), flags=re.MULTILINE).strip()
    start = cleaned.find("{")
    if start == -1:
        raise ValueError("no JSON object found in model reply")
    decoder = json.JSONDecoder()
    obj, _ = decoder.raw_decode(cleaned[start:])
    if not isinstance(obj, dict):
        raise ValueError("model reply JSON is not an object")
    return obj


def build_agent(model: Any, tools: list[Any], system_prompt: str, name: str):
    """Create an agent with LangChain's `create_agent` (tools may be empty)."""
    return create_agent(model, tools=tools, system_prompt=system_prompt, name=name)


async def run_agent(agent: Any, user_content: str, config: RunnableConfig | None = None) -> str:
    """Invoke an agent and return the text of its final message."""
    run_config: RunnableConfig = {**(config or {}), "recursion_limit": AGENT_RECURSION_LIMIT}
    result = await agent.ainvoke({"messages": [{"role": "user", "content": user_content}]}, run_config)
    return message_text(result["messages"][-1].content)


async def run_json_agent(
    agent: Any,
    user_content: str,
    schema: type[T],
    config: RunnableConfig | None = None,
    repair_model: Any | None = None,
    label: str = "agent",
) -> T:
    """
    Run an agent and return its reply validated against `schema`.

    If the reply is not valid, ONE repair attempt is made with `repair_model`
    (the cheap model) before giving up with `AgentOutputError`.
    """
    raw = await run_agent(agent, user_content, config)
    try:
        return schema.model_validate(extract_json(raw))
    except (ValueError, ValidationError) as first_error:
        log.warning("%s: invalid JSON reply (%s); attempting repair", label, type(first_error).__name__)
        if repair_model is None:
            raise AgentOutputError(f"{label}: invalid output: {first_error}") from first_error
        prompt = (
            "Fix the following so it is ONE valid JSON object matching this JSON schema. "
            "Return ONLY the JSON.\n\nSCHEMA:\n" + json.dumps(schema.model_json_schema()) +
            f"\n\nERROR:\n{first_error}\n\nREPLY:\n{raw[:6000]}"
        )
        repaired = await repair_model.ainvoke(prompt, config)
        try:
            return schema.model_validate(extract_json(message_text(repaired.content)))
        except (ValueError, ValidationError) as second_error:
            raise AgentOutputError(f"{label}: invalid output after repair: {second_error}") from second_error
