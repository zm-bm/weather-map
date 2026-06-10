"""Provider-neutral frame submission claim interfaces."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True)
class FrameClaim:
    """One persisted in-flight frame submission claim."""

    dataset_id: str
    cycle: str
    run_id: str
    frame_id: str
    state: str
    attempt: int
    expires_at_epoch: int
    job_id: str | None = None


@dataclass(frozen=True)
class FrameClaimResult:
    """Result of trying to acquire a frame submission claim."""

    acquired: bool
    attempt: int | None = None
    existing: FrameClaim | None = None
    reason: str | None = None

    @property
    def existing_job_id(self) -> str | None:
        return self.existing.job_id if self.existing is not None else None

    def attempt_or(self, default: int) -> int:
        return self.attempt or default


class FrameClaimStore(Protocol):
    """Storage-neutral interface for submission throttling claims."""

    def get(self, *, dataset_id: str, cycle: str, run_id: str, frame_id: str) -> FrameClaim | None:
        """Return a persisted frame claim, if present."""
        ...

    def acquire(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frame_id: str,
        artifact_ids: tuple[str, ...],
        worker_spec_hash: str,
        source_uri: str | None,
        now: datetime,
    ) -> FrameClaimResult:
        """Conditionally acquire one frame claim."""
        ...

    def record_submission(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frame_id: str,
        job_id: str,
        now: datetime,
    ) -> None:
        """Record the submitted worker job id for a claimed frame."""
        ...

    def record_complete(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frame_id: str,
        now: datetime,
    ) -> None:
        """Record marker-derived completion for a frame."""
        ...


class NullFrameClaimStore:
    """No-op claim store for local planning and dry runs."""

    def get(self, *, dataset_id: str, cycle: str, run_id: str, frame_id: str) -> FrameClaim | None:
        return None

    def acquire(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frame_id: str,
        artifact_ids: tuple[str, ...],
        worker_spec_hash: str,
        source_uri: str | None,
        now: datetime,
    ) -> FrameClaimResult:
        del dataset_id, cycle, run_id, frame_id, artifact_ids, worker_spec_hash, source_uri, now
        return FrameClaimResult(acquired=True, attempt=1)

    def record_submission(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frame_id: str,
        job_id: str,
        now: datetime,
    ) -> None:
        del dataset_id, cycle, run_id, frame_id, job_id, now

    def record_complete(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frame_id: str,
        now: datetime,
    ) -> None:
        del dataset_id, cycle, run_id, frame_id, now


def frame_claim_pk(*, dataset_id: str, cycle: str, run_id: str, frame_id: str) -> str:
    return f"{dataset_id}#{cycle}#{run_id}#{frame_id}"
