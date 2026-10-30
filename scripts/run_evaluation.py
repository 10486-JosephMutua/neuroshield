"""Run the evaluation benchmark and save it:  python scripts/run_evaluation.py [healthy per_scale confounder]"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.config import PROJECT_ROOT  # noqa: E402
from backend.evaluation import run_benchmark  # noqa: E402
from backend.logging_setup import configure_logging  # noqa: E402

OUTPUT = PROJECT_ROOT / "data" / "evaluation.json"

if __name__ == "__main__":
    configure_logging("evaluation")
    sizes = [int(a) for a in sys.argv[1:4]]
    report = run_benchmark(*sizes)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(report, indent=2))
    print(f"Wrote {OUTPUT} ({report['seconds']} s)")
    print("False alarms (people ever flagged):", report["healthy"]["people_ever_flagged"])
    for row in report["decline"]:
        print(f"Decline {row['label']:<14} detected {row['detected']['count']}/{row['people']}  median delay {row['median_delay_days']} days")
    print("Flu:", report["flu"]["mistaken_for_decline_during_illness"], report["flu"]["flagged_after_recovery"])
    print("Keyboard:", report["keyboard"]["recognised_as_mechanical_only"])
