"""Shared claim-gated launch path for planned frame workers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from .claims.store import FrameClaimStore
from .plan import RunPlan
from .spec import FrameWorkerSpec


@dataclass(frozen=True)
class WorkerLaunchRequest:
    """One planned worker after claim acquisition or dry-run selection."""

    worker: FrameWorkerSpec
    attempt: int | None = None


@dataclass(frozen=True)
class WorkerLaunchRecord:
    """Result for one planned worker launch attempt."""

    worker: FrameWorkerSpec
    started: bool
    claimed: bool = False
    failed: bool = False
    job_id: str | None = None
    job_name: str | None = None


@dataclass(frozen=True)
class WorkerLaunchSummary:
    """Ordered launch records and common worker counts."""

    records: tuple[WorkerLaunchRecord, ...]

    @property
    def workers_started(self) -> int:
        return sum(1 for record in self.records if record.started)

    @property
    def workers_claimed(self) -> int:
        return sum(1 for record in self.records if record.claimed)

    def record_for_frame(self, frame_id: str) -> WorkerLaunchRecord | None:
        """Return the launch record for a frame, if present."""
        return next((record for record in self.records if record.worker.frame_id == frame_id), None)


class WorkerLaunchBackend(Protocol):
    """Launch backend for already-selected workers."""

    def launch_many(
        self,
        requests: tuple[WorkerLaunchRequest, ...],
        *,
        dry_run: bool,
    ) -> tuple[WorkerLaunchRecord, ...]:
        """Launch selected worker requests and return records in input order."""
        ...


def launch_planned_workers(
    *,
    workers: tuple[FrameWorkerSpec, ...],
    claim_store: FrameClaimStore,
    backend: WorkerLaunchBackend,
    dataset_id: str,
    cycle: str,
    run_id: str,
    artifact_ids: tuple[str, ...],
    now: datetime,
    dry_run: bool = False,
) -> WorkerLaunchSummary:
    """Claim and launch planned workers through a backend.

    Dry runs intentionally bypass claim acquisition and claim mutation.
    """

    if dry_run:
        requests = tuple(WorkerLaunchRequest(worker=worker) for worker in workers)
        return WorkerLaunchSummary(records=backend.launch_many(requests, dry_run=True))

    records: list[WorkerLaunchRecord | None] = [None] * len(workers)
    acquired: list[tuple[int, WorkerLaunchRequest]] = []
    for index, worker in enumerate(workers):
        claim = claim_store.acquire(
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            frame_id=worker.frame_id,
            artifact_ids=artifact_ids,
            worker_spec_hash=worker.worker_spec_hash,
            source_uri=worker.source_uri,
            now=now,
        )
        if not claim.acquired:
            records[index] = WorkerLaunchRecord(
                worker=worker,
                started=False,
                claimed=True,
                job_id=claim.existing_job_id,
            )
            continue
        acquired.append(
            (
                index,
                WorkerLaunchRequest(
                    worker=worker,
                    attempt=claim.attempt_or(1),
                ),
            )
        )

    launched = (
        backend.launch_many(tuple(request for _, request in acquired), dry_run=False)
        if acquired
        else ()
    )
    for (index, _request), record in zip(acquired, launched, strict=True):
        records[index] = record
        if record.started and not record.failed:
            claim_store.record_submission(
                dataset_id=dataset_id,
                cycle=cycle,
                run_id=run_id,
                frame_id=record.worker.frame_id,
                job_id=record.job_id or "",
                now=now,
            )

    return WorkerLaunchSummary(records=tuple(record for record in records if record is not None))


def launch_run_plan_workers(
    *,
    plan: RunPlan,
    claim_store: FrameClaimStore,
    backend: WorkerLaunchBackend,
    now: datetime,
    workers: tuple[FrameWorkerSpec, ...] | None = None,
    dry_run: bool = False,
) -> WorkerLaunchSummary:
    """Launch workers from a cycle plan through a backend."""

    return launch_planned_workers(
        workers=plan.workers if workers is None else workers,
        claim_store=claim_store,
        backend=backend,
        dataset_id=plan.dataset_id,
        cycle=plan.cycle,
        run_id=plan.run_id,
        artifact_ids=plan.artifact_ids,
        now=now,
        dry_run=dry_run,
    )
