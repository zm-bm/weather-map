"""AWS Batch worker launch mechanics."""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from ..claims.store import FrameClaimStore
from ..launch import (
    WorkerLaunchRecord,
    WorkerLaunchRequest,
    WorkerLaunchSummary,
    launch_run_plan_workers,
)
from ..plan import RunPlan
from ..spec import FrameWorkerSpec


@dataclass(frozen=True)
class AwsBatchWorkerBackend:
    """AWS Batch backend for launching planned frame workers."""

    batch: Any
    queue: str
    job_definition: str
    job_name_for_worker: Callable[[FrameWorkerSpec, int | None], str]
    submit_delay_seconds: float = 0.0

    def launch_many(
        self,
        requests: tuple[WorkerLaunchRequest, ...],
        *,
        dry_run: bool,
    ) -> tuple[WorkerLaunchRecord, ...]:
        return tuple(self._launch_one(request, dry_run=dry_run) for request in requests)

    def _launch_one(self, request: WorkerLaunchRequest, *, dry_run: bool) -> WorkerLaunchRecord:
        job_name = self.job_name_for_worker(request.worker, request.attempt)
        if dry_run:
            return WorkerLaunchRecord(
                worker=request.worker,
                started=False,
                job_name=job_name,
            )

        response = (
            self.batch.submit_job(
                jobName=job_name,
                jobQueue=self.queue,
                jobDefinition=self.job_definition,
                containerOverrides={
                    "command": list(request.worker.command[1:]),
                    "environment": _batch_env(request.worker.env),
                },
            )
            or {}
        )
        if self.submit_delay_seconds:
            time.sleep(self.submit_delay_seconds)
        return WorkerLaunchRecord(
            worker=request.worker,
            started=True,
            job_id=str(response.get("jobId", "")),
            job_name=job_name,
        )


def batch_worker_job_name(
    *,
    prefix: str,
    dataset_id: str,
    cycle: str,
    run_id: str,
    frame_id: str,
    worker_spec_hash: str,
) -> str:
    """Return the stable AWS Batch worker job name."""

    return f"{prefix}-{dataset_id}-{cycle}-{run_id}-{frame_id}-{worker_spec_hash[:8]}"[:128]


def launch_aws_batch_plan_workers(
    *,
    plan: RunPlan,
    claim_store: FrameClaimStore,
    batch: Any,
    queue: str,
    job_definition: str,
    job_name_for_worker: Callable[[FrameWorkerSpec, int | None], str],
    now: datetime,
    workers: tuple[FrameWorkerSpec, ...] | None = None,
    dry_run: bool = False,
    submit_delay_seconds: float = 0.0,
) -> WorkerLaunchSummary:
    """Launch selected cycle-plan workers through AWS Batch."""

    return launch_run_plan_workers(
        plan=plan,
        claim_store=claim_store,
        backend=AwsBatchWorkerBackend(
            batch=batch,
            queue=queue,
            job_definition=job_definition,
            job_name_for_worker=job_name_for_worker,
            submit_delay_seconds=submit_delay_seconds,
        ),
        now=now,
        workers=workers,
        dry_run=dry_run,
    )


def _batch_env(env: Mapping[str, str]) -> list[dict[str, str]]:
    return [{"name": key, "value": value} for key, value in env.items()]
