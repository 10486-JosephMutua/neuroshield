"""Create the four synthetic demo people:  python scripts/seed_demo_data.py [days]"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.logging_setup import configure_logging  # noqa: E402
from backend.synthetic import seed_demo_users  # noqa: E402

if __name__ == "__main__":
    configure_logging("seed")
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 90
    print(json.dumps(seed_demo_users(days=days), indent=2))
