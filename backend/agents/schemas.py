"""Pydantic schemas for the JSON each agent must return.

Replies are parsed and validated against these classes, with one repair attempt."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class Explanation(BaseModel):
    name: str
    likelihood: Literal["low", "medium", "high"]
    reasoning: str


class ConfounderReport(BaseModel):
    alternative_explanations: list[Explanation] = Field(default_factory=list)
    pattern_summary: str
    suggested_recheck_days: int = Field(default=7, ge=0, le=90)


class EvidenceItem(BaseModel):
    metric: str
    observation: str
    baseline_value: Optional[float] = None
    recent_value: Optional[float] = None
    change_pct: Optional[float] = None


class AnalystReport(BaseModel):
    headline: str
    evidence: list[EvidenceItem] = Field(default_factory=list, max_length=6)
    confidence: Literal["low", "moderate", "high"]
    recommendation: Literal["no_action", "keep_monitoring", "suggest_routine_checkup"]
    patient_message: str
    clinician_summary: str
    limitations: list[str] = Field(default_factory=list)


class VerifierIssue(BaseModel):
    claim: str
    problem: str


class VerifierReport(BaseModel):
    verdict: Literal["pass", "revise"]
    issues: list[VerifierIssue] = Field(default_factory=list)


class CheckinMessage(BaseModel):
    message: str
    plan_memory_id: Optional[int] = None
    asks_for_new_plan: bool = True


class RecallScore(BaseModel):
    recall_score: float = Field(ge=0.0, le=1.0)
    reasoning: str
    new_plan: Optional[str] = None
