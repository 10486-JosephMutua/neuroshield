"""
Run the full pipeline from the command line (MCP servers must be running):

    python scripts/run_analysis_cli.py arthur_demo [AS_OF_YYYY-MM-DD]
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.graph.pipeline import run_analysis  # noqa: E402
from backend.logging_setup import configure_logging  # noqa: E402

if __name__ == "__main__":
    configure_logging("cli")
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    result = asyncio.run(run_analysis(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None))
    print(json.dumps({"final": result["final"], "trace": result["trace"], "usage": result["usage"]}, indent=2))
