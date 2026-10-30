"""Scripted chat models: stand-ins for Nemotron so tests run offline and deterministically."""
from __future__ import annotations

import json

from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage


class ScriptedModel(GenericFakeChatModel):
    """Replies with a fixed sequence of messages; `bind_tools` is a no-op so create_agent accepts it."""

    def bind_tools(self, tools, **kwargs):  # noqa: D102
        return self


def scripted(*messages) -> ScriptedModel:
    return ScriptedModel(messages=iter(messages))


def json_reply(payload: dict) -> AIMessage:
    return AIMessage(content=json.dumps(payload))


def tool_call(name: str, args: dict, call_id: str = "call_1") -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id}])


class ExplodingModel(ScriptedModel):
    """Fails loudly if a model is ever called (proves calm signals never reach an LLM)."""

    def _generate(self, *args, **kwargs):  # noqa: D102
        raise AssertionError("a model was called but should not have been")
