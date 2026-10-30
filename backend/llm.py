"""Model layer: Nemotron on Nebius Token Factory through its OpenAI-compatible API.

analyst  Nemotron 3 Ultra  deep reasoning, once per analysis
fast     Nemotron 3 Nano   check-ins, verification, JSON repair

UsageTracker is a LangChain callback that records model, latency, tokens and estimated
cost for every call."""
from __future__ import annotations

import time
from typing import Any
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler
from langchain_openai import ChatOpenAI
from openai import DefaultAsyncHttpxClient

from backend.config import get_settings
from backend.logging_setup import get_logger

log = get_logger("llm")

# USD per 1M tokens (input, output). Confirm current prices in the Token Factory console.
PRICES_PER_MILLION: dict[str, tuple[float, float]] = {
    "nvidia/Nemotron-3-Ultra-550b-a55b": (1.00, 3.00),
    "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B": (0.06, 0.24),
}


class ConfigError(RuntimeError):
    """Raised when required configuration (e.g. the API key) is missing."""


def _own_async_client() -> DefaultAsyncHttpxClient:
    """A private async HTTP client for ONE model instance.

    Every analysis / check-in runs in its own `asyncio.run(...)` event loop. langchain-openai
    otherwise reuses one process-wide async HTTP client whose pooled connections belong to the
    FIRST (by now closed) loop, so the next request fails with "RuntimeError: Event loop is
    closed". A client created per model is used by a single loop and never outlives it."""
    return DefaultAsyncHttpxClient()


def get_chat_model(role: str) -> ChatOpenAI:
    """
    Build a chat model for a role:
      "analyst"  Nemotron 3 Ultra (deep reasoning, longer timeout)
      "fast"     Nemotron 3 Nano  (verification, repair)
      "checkin"  a LOCAL model if NEUROSHIELD_CHECKIN_BASE_URL is set, otherwise the fast cloud model
    """
    settings = get_settings()
    if role == "checkin" and settings.checkin_is_local:
        log.info("Creating LOCAL check-in model %s at %s", settings.checkin_model, settings.checkin_base_url)
        return ChatOpenAI(model=settings.checkin_model, base_url=settings.checkin_base_url,
                          api_key=settings.checkin_api_key or "local", temperature=0.0, timeout=120, max_retries=1,
                          http_async_client=_own_async_client())
    if not settings.nebius_api_key:
        raise ConfigError("NEBIUS_API_KEY is not set. Copy .env.example to .env and add your Token Factory key.")
    if role == "analyst":
        model, temperature, timeout = settings.model_analyst, 0.2, 150
    elif role in ("fast", "checkin"):
        model, temperature, timeout = settings.model_fast, 0.0, 60
    else:
        raise ValueError(f"unknown model role '{role}'")
    log.info("Creating chat model role=%s model=%s", role, model)
    return ChatOpenAI(model=model, base_url=settings.nebius_base_url, api_key=settings.nebius_api_key,
                      temperature=temperature, timeout=timeout, max_retries=2, http_async_client=_own_async_client())


class UsageTracker(BaseCallbackHandler):
    """Record latency, token usage and estimated cost for every model call in a run."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self._started: dict[UUID, tuple[float, str]] = {}

    @staticmethod
    def _model_name(serialized: dict | None, kwargs: dict) -> str:
        params = kwargs.get("invocation_params") or {}
        name = params.get("model") or params.get("model_name") or (kwargs.get("metadata") or {}).get("ls_model_name")
        return name or ((serialized or {}).get("name")) or "unknown"

    def on_chat_model_start(self, serialized, messages, *, run_id, **kwargs):  # noqa: D102
        self._started[run_id] = (time.perf_counter(), self._model_name(serialized, kwargs))

    def on_llm_start(self, serialized, prompts, *, run_id, **kwargs):  # noqa: D102
        self._started[run_id] = (time.perf_counter(), self._model_name(serialized, kwargs))

    def on_llm_end(self, response, *, run_id, **kwargs):  # noqa: D102
        started, model = self._started.pop(run_id, (time.perf_counter(), "unknown"))
        input_tokens = output_tokens = 0
        try:
            usage = getattr(response.generations[0][0].message, "usage_metadata", None) or {}
            input_tokens = int(usage.get("input_tokens", 0))
            output_tokens = int(usage.get("output_tokens", 0))
        except (IndexError, AttributeError):
            pass
        price_in, price_out = PRICES_PER_MILLION.get(model, (0.0, 0.0))
        cost = (input_tokens * price_in + output_tokens * price_out) / 1_000_000
        record = {"model": model, "latency_ms": round((time.perf_counter() - started) * 1000),
                  "input_tokens": input_tokens, "output_tokens": output_tokens, "cost_usd": round(cost, 6)}
        self.calls.append(record)
        log.info("LLM call model=%s latency=%dms tokens_in=%d tokens_out=%d cost=$%.5f",
                 model, record["latency_ms"], input_tokens, output_tokens, cost)

    def on_llm_error(self, error, *, run_id, **kwargs):  # noqa: D102
        self._started.pop(run_id, None)
        log.error("LLM call failed: %s: %s", type(error).__name__, error)

    def summary(self) -> dict[str, Any]:
        """Per-model and overall totals for the UI cost panel."""
        per_model: dict[str, dict[str, Any]] = {}
        for call in self.calls:
            row = per_model.setdefault(call["model"], {"calls": 0, "latency_ms": 0, "input_tokens": 0,
                                                       "output_tokens": 0, "cost_usd": 0.0})
            row["calls"] += 1
            for key in ("latency_ms", "input_tokens", "output_tokens", "cost_usd"):
                row[key] += call[key]
        for row in per_model.values():
            row["cost_usd"] = round(row["cost_usd"], 6)
        return {"calls": len(self.calls), "per_model": per_model,
                "total_cost_usd": round(sum(c["cost_usd"] for c in self.calls), 6),
                "total_tokens": sum(c["input_tokens"] + c["output_tokens"] for c in self.calls)}
