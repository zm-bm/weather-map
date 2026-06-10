"""Source-triggered operation submission outcomes."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

SourceSubmissionStatus = Literal["ready", "skipped", "claimed", "submitted", "completed", "pending", "blocked"]
SourceSubmissionScope = Literal["object", "cycle", "frame"]


@dataclass(frozen=True)
class SourceSubmissionOutcome:
    """One source submission decision for an object, cycle, or frame."""

    status: SourceSubmissionStatus
    scope: SourceSubmissionScope
    dataset_id: str
    cycle: str | None = None
    run_id: str | None = None
    frame_id: str | None = None
    source_uri: str | None = None
    source_key: str | None = None
    reason: str | None = None
    job_id: str | None = None
    job_name: str | None = None


@dataclass(frozen=True)
class SourceSubmissionResult:
    """Submission summary shared by source-specific operation handlers."""

    outcomes: tuple[SourceSubmissionOutcome, ...] = ()
    cycles: int = 0

    @classmethod
    def from_outcomes(
        cls,
        *outcomes: SourceSubmissionOutcome,
        cycles: int = 0,
    ) -> "SourceSubmissionResult":
        return cls(outcomes=tuple(outcomes), cycles=cycles)

    @classmethod
    def combine(cls, results: Iterable["SourceSubmissionResult"]) -> "SourceSubmissionResult":
        outcomes: list[SourceSubmissionOutcome] = []
        cycles = 0
        for result in results:
            outcomes.extend(result.outcomes)
            cycles += result.cycles
        return cls(outcomes=tuple(outcomes), cycles=cycles)

    def count(
        self,
        status: SourceSubmissionStatus,
        *,
        scope: SourceSubmissionScope | None = None,
    ) -> int:
        return sum(
            1
            for outcome in self.outcomes
            if outcome.status == status and (scope is None or outcome.scope == scope)
        )

    @property
    def submitted(self) -> int:
        return self.count("submitted")

    @property
    def completed(self) -> int:
        return self.count("completed")

    @property
    def pending(self) -> int:
        return self.count("pending")

    @property
    def pending_frames(self) -> int:
        return self.count("pending", scope="frame")

    @property
    def claimed(self) -> int:
        return self.count("claimed")

    @property
    def skipped(self) -> int:
        return self.count("skipped")

    @property
    def blocked(self) -> int:
        return self.count("blocked")

    @property
    def skipped_cycles(self) -> int:
        return sum(
            1
            for outcome in self.outcomes
            if outcome.scope == "cycle" and outcome.status in {"blocked", "skipped", "pending"}
        )
