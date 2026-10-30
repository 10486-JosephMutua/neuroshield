"""Check the Token Factory setup before running the pipeline:

    python scripts/verify_token_factory.py

It confirms that the configured Nemotron model IDs are available to your account, that a
plain chat completion works on each, and that tool calling works on each (the agents
depend on it). If a model fails the tool-calling check, set a different ID in .env."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from langchain_core.tools import tool  # noqa: E402
from openai import OpenAI  # noqa: E402

from backend.config import get_settings  # noqa: E402
from backend.llm import get_chat_model  # noqa: E402


@tool
def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b


def main() -> int:
    settings = get_settings()
    if not settings.nebius_api_key:
        print("NEBIUS_API_KEY is not set (copy .env.example to .env).")
        return 1

    client = OpenAI(base_url=settings.nebius_base_url, api_key=settings.nebius_api_key)
    available = {m.id for m in client.models.list().data}
    nemotron = sorted(m for m in available if "nemotron" in m.lower())
    print(f"{len(available)} models visible; Nemotron models:")
    for model_id in nemotron:
        print("   ", model_id)

    failures = 0
    for role, model_id in (("analyst", settings.model_analyst), ("fast", settings.model_fast)):
        print(f"\n[{role}] {model_id}")
        if model_id not in available:
            print("   FAILED: model id not found in your model list — fix it in .env")
            failures += 1
            continue
        model = get_chat_model(role)
        try:
            reply = model.invoke("Reply with the single word: ready")
            print("   OK: chat completion:", str(reply.content)[:60].replace("\n", " "))
        except Exception as exc:  # noqa: BLE001 - diagnostic script
            print("   FAILED: chat completion:", exc)
            failures += 1
            continue
        try:
            call = model.bind_tools([add]).invoke("Use the add tool to compute 19 + 23.")
            if call.tool_calls:
                print("   OK: tool calling:", call.tool_calls[0]["name"], call.tool_calls[0]["args"])
            else:
                print("   FAILED: tool calling: model answered in text instead of calling the tool")
                failures += 1
        except Exception as exc:  # noqa: BLE001
            print("   FAILED: tool calling:", exc)
            failures += 1

    print("\nAll checks passed." if not failures else f"\n{failures} check(s) failed.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
