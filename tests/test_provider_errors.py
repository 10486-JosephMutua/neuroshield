"""
Model-provider failures (rate limit, bad key, wrong model id, timeout) must never surface as a
generic "Unexpected server error", and a failed confounder review must not sink the analysis.
"""
import asyncio
import time

import httpx
import openai
import pytest
from langchain_core.messages import AIMessage

from backend import jobs
from backend.errors import describe_error
from backend.graph.pipeline import run_analysis
from tests.fakes import ScriptedModel, json_reply, scripted
from tests.test_pipeline_offline import AS_OF, PASS, _good_analysis, _screen

_REQUEST = httpx.Request("POST", "https://example.test/v1/chat/completions")


def _status_error(cls, status):
    return cls("provider said no", response=httpx.Response(status, request=_REQUEST), body=None)


@pytest.mark.parametrize("exc, status, code", [
    (openai.APITimeoutError(request=_REQUEST), 504, "model_timeout"),
    (openai.APIConnectionError(request=_REQUEST), 503, "model_unreachable"),
    (_status_error(openai.AuthenticationError, 401), 503, "model_auth_failed"),
    (_status_error(openai.PermissionDeniedError, 403), 503, "model_auth_failed"),
    (_status_error(openai.NotFoundError, 404), 503, "model_not_found"),
    (_status_error(openai.RateLimitError, 429), 429, "model_rate_limited"),
    (_status_error(openai.BadRequestError, 400), 502, "model_rejected_request"),
    (_status_error(openai.InternalServerError, 500), 502, "model_service_error"),
])
def test_provider_errors_get_a_specific_code_and_message(exc, status, code):
    got_status, got_code, message = describe_error(exc)
    assert (got_status, got_code) == (status, code)
    assert message and "Unexpected server error" not in message


def test_an_error_wrapped_in_an_exception_group_is_still_recognised():
    wrapped = ExceptionGroup("task group", [_status_error(openai.RateLimitError, 429)])
    assert describe_error(wrapped)[1] == "model_rate_limited"


def test_unknown_errors_are_still_reported_as_internal_errors():
    assert describe_error(RuntimeError("boom"))[:2] == (500, "internal_error")


class RateLimitedModel(ScriptedModel):
    """A model whose every call is rejected by the provider with HTTP 429."""

    def _generate(self, *args, **kwargs):  # noqa: D102
        raise _status_error(openai.RateLimitError, 429)


@pytest.fixture()
def _env(mcp_servers, seeded_db):
    yield


def test_a_failed_confounder_review_does_not_lose_the_analysis(_env):
    screen = _screen("arthur_demo")
    models = {
        # reply 1 and the repair attempt (2) are not JSON, so the confounder review fails; the verifier then passes
        "fast": scripted(AIMessage(content="not json"), AIMessage(content="still not json"), json_reply(PASS)),
        "analyst": scripted(json_reply(_good_analysis(screen))),
    }
    result = asyncio.run(run_analysis("arthur_demo", AS_OF, models))
    final = result["final"]
    assert final["verification_status"] == "passed" and final["recommendation"] == "suggest_routine_checkup"
    review = [e for e in result["trace"] if e["node"] == "confounder_review"][0]
    assert review["status"] == "degraded"
    assert final["confounders"] == []
    assert any("everyday-explanations" in note for note in final["guardrail_notes"])


def test_a_rate_limited_provider_fails_the_job_with_a_specific_message(_env):
    job_id = jobs.start_analysis_job(
        "arthur_demo", "2026-03-28",
        lambda: {"fast": RateLimitedModel(messages=iter([])), "analyst": RateLimitedModel(messages=iter([]))},
        force=True)
    for _ in range(200):
        if jobs.STORE.get(job_id)["status"] in ("done", "failed"):
            break
        time.sleep(0.05)
    job = jobs.STORE.get(job_id)
    assert job["status"] == "failed"
    assert job["error"]["code"] == "model_rate_limited" and job["error"]["http_status"] == 429