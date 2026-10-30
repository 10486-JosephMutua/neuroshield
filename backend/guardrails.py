"""Guardrails enforced in code rather than in prompts.

1. Policy: which recommendation each overall signal may lead to.
2. Verification: numbers quoted by the analyst must match the screen.
3. Sanitising: the patient-facing message never contains diagnostic wording.
4. Templates: safe fallback messages used when no model output is trusted."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

RECOMMENDATIONS = ("no_action", "keep_monitoring", "suggest_routine_checkup")


def recommendation_rank(value: str) -> int:
    return RECOMMENDATIONS.index(value) if value in RECOMMENDATIONS else 0


@dataclass(frozen=True)
class SignalPolicy:
    max_recommendation: str
    default_recommendation: str
    headline: str
    use_llm: bool  # False => skip the models entirely and use a template (saves cost, removes risk)


POLICY: dict[str, SignalPolicy] = {
    "insufficient_data": SignalPolicy(
        "no_action", "no_action", "Not enough history yet to establish a personal baseline.", False),
    "stable": SignalPolicy(
        "no_action", "no_action", "Typing and check-in patterns are steady compared with the personal baseline.", False),
    "minor_fluctuation": SignalPolicy(
        "no_action", "no_action", "Small fluctuations only; nothing sustained.", False),
    "acute_change": SignalPolicy(
        "keep_monitoring", "keep_monitoring", "A recent, short-lived change; common with tiredness or illness.", True),
    "motor_only_change": SignalPolicy(
        "keep_monitoring", "keep_monitoring",
        "Mechanical typing timing changed while thinking-related measures did not.", True),
    "single_domain_drift": SignalPolicy(
        "keep_monitoring", "keep_monitoring", "A sustained change in one area only.", True),
    "sustained_multi_domain_drift": SignalPolicy(
        "suggest_routine_checkup", "suggest_routine_checkup",
        "A sustained, gradual change across several areas compared with the personal baseline.", True),
}


def policy_for(overall_signal: str) -> SignalPolicy:
    return POLICY.get(overall_signal, POLICY["insufficient_data"])


def _close(claimed: float | None, actual: float | None, rel: float = 0.03, abs_tol: float = 0.01) -> bool:
    if claimed is None or actual is None:
        return True  # nothing to compare
    return abs(claimed - actual) <= max(abs(actual) * rel, abs_tol)


def check_analysis_against_screen(analysis: dict[str, Any], screen: dict[str, Any]) -> list[dict[str, str]]:
    """Return a list of {claim, problem} issues; an empty list means the numbers check out."""
    issues: list[dict[str, str]] = []
    metrics = screen.get("metrics", {})
    policy = policy_for(screen.get("overall_signal", ""))

    for item in analysis.get("evidence", []):
        key = item.get("metric")
        actual = metrics.get(key)
        if actual is None or actual.get("status") == "insufficient_baseline":
            issues.append({"claim": f"evidence for '{key}'", "problem": "metric is not in the statistical screen"})
            continue
        if not _close(item.get("baseline_value"), actual["baseline"]["median"]):
            issues.append({"claim": f"{key} baseline_value={item.get('baseline_value')}",
                           "problem": f"screen baseline median is {actual['baseline']['median']}"})
        if not _close(item.get("recent_value"), actual["recent"]["mean"]):
            issues.append({"claim": f"{key} recent_value={item.get('recent_value')}",
                           "problem": f"screen recent mean is {actual['recent']['mean']}"})
        if not _close(item.get("change_pct"), actual["recent"]["change_pct"], rel=0.0, abs_tol=1.0):
            issues.append({"claim": f"{key} change_pct={item.get('change_pct')}",
                           "problem": f"screen change is {actual['recent']['change_pct']}%"})

    if recommendation_rank(analysis.get("recommendation", "")) > recommendation_rank(policy.max_recommendation):
        issues.append({"claim": f"recommendation={analysis.get('recommendation')}",
                       "problem": f"policy allows at most '{policy.max_recommendation}' for signal "
                                  f"'{screen.get('overall_signal')}'"})

    if analysis.get("confidence") == "high" and screen.get("overall_signal") != "sustained_multi_domain_drift":
        issues.append({"claim": "confidence=high",
                       "problem": "high confidence is only allowed for sustained multi-domain drift"})
    return issues


_FORBIDDEN = re.compile(
    r"diagnos|dementia|alzheimer|\bmci\b|cognitive impairment|cognitive decline|neurodegenerat|"
    r"you have\b|disease|disorder|brain damage|deteriorat",
    re.IGNORECASE,
)

SAFE_PATIENT_MESSAGES = {
    "no_action": ("Your typing and check-in patterns look steady compared with your own recent baseline. "
                  "Nothing needs your attention."),
    "keep_monitoring": ("We noticed small changes in some of your typing patterns. These often come from tiredness, "
                        "a new keyboard or a busy week. We'll keep an eye on things and look again soon."),
    "suggest_routine_checkup": ("Over the past few weeks we noticed a steady change in several of your typing and "
                                "check-in patterns. It could have many everyday causes, but it may be worth "
                                "mentioning at your next routine check-up. Would you like a one-page summary to "
                                "share with your doctor?"),
}


def sanitize_patient_message(message: str, recommendation: str) -> tuple[str, bool]:
    """Replace the message with a safe template if it contains diagnostic wording or is empty."""
    if not message or _FORBIDDEN.search(message):
        return SAFE_PATIENT_MESSAGES.get(recommendation, SAFE_PATIENT_MESSAGES["no_action"]), True
    return message.strip(), False


def build_template_final(screen: dict[str, Any], status: str, needs_human_review: bool = False) -> dict[str, Any]:
    """A complete, model-free result used for calm signals and as a fall-back."""
    policy = policy_for(screen.get("overall_signal", ""))
    recommendation = policy.default_recommendation
    return {
        "overall_signal": screen.get("overall_signal"),
        "recommendation": recommendation,
        "confidence": "low" if screen.get("overall_signal") in ("insufficient_data",) else "moderate",
        "headline": policy.headline,
        "patient_message": SAFE_PATIENT_MESSAGES[recommendation],
        "clinician_summary": (f"Statistical screen over {screen.get('history_days', 0)} days of history: "
                              f"{policy.headline} This is a screening summary, not a diagnosis."),
        "evidence": [],
        "limitations": [],
        "confounders": [],
        "confounder_pattern_summary": "",
        "verification_status": status,
        "needs_human_review": needs_human_review,
        "guardrail_notes": [],
    }
