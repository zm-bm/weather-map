from __future__ import annotations

from datetime import datetime, timezone

from tests.fixtures.run_plan import frame_worker, run_plan
from weather_etl.workers.claims.store import FrameClaim, FrameClaimResult, NullFrameClaimStore
from weather_etl.workers.launch import (
    WorkerLaunchRecord,
    WorkerLaunchRequest,
    launch_planned_workers,
    launch_run_plan_workers,
)
from weather_etl.workers.spec import FrameWorkerSpec


class _FakeBackend:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def launch_many(
        self,
        requests: tuple[WorkerLaunchRequest, ...],
        *,
        dry_run: bool,
    ) -> tuple[WorkerLaunchRecord, ...]:
        self.calls.append({"requests": requests, "dry_run": dry_run})
        return tuple(
            WorkerLaunchRecord(
                worker=request.worker,
                source_uri=request.source_uri,
                started=not dry_run,
                attempt=request.attempt,
                job_id=f"job-{request.worker.frame_id}" if not dry_run else None,
                job_name=f"name-{request.worker.frame_id}",
            )
            for request in requests
        )


class _FakeClaimStore:
    def __init__(self, results: tuple[FrameClaimResult, ...]) -> None:
        self.results = list(results)
        self.acquire_calls: list[dict] = []
        self.submissions: list[dict] = []

    def get(self, *, dataset_id: str, cycle: str, run_id: str, frame_id: str) -> FrameClaim | None:
        del dataset_id, cycle, run_id, frame_id
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
        self.acquire_calls.append(
            {
                "dataset_id": dataset_id,
                "cycle": cycle,
                "run_id": run_id,
                "frame_id": frame_id,
                "artifact_ids": artifact_ids,
                "worker_spec_hash": worker_spec_hash,
                "source_uri": source_uri,
                "now": now,
            }
        )
        return self.results.pop(0)

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
        self.submissions.append(
            {
                "dataset_id": dataset_id,
                "cycle": cycle,
                "run_id": run_id,
                "frame_id": frame_id,
                "job_id": job_id,
                "now": now,
            }
        )

    def record_complete(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frame_id: str,
        now: datetime,
    ) -> None:
        raise AssertionError("record_complete should not be called")


def test_launch_planned_workers_acquires_delegates_and_records_submission() -> None:
    now = datetime(2026, 5, 11, tzinfo=timezone.utc)
    claims = _FakeClaimStore((FrameClaimResult(acquired=True, attempt=2),))
    backend = _FakeBackend()

    summary = launch_planned_workers(
        workers=(_worker("003"),),
        claim_store=claims,
        backend=backend,
        dataset_id="gfs",
        cycle="2026051100",
        run_id="20260511T010203Z-abcdef12",
        artifact_ids=("tmp_surface",),
        now=now,
    )

    assert summary.workers_started == 1
    assert summary.workers_claimed == 0
    assert summary.failures == 0
    assert backend.calls[0]["requests"][0].attempt == 2
    assert claims.acquire_calls[0]["frame_id"] == "003"
    assert claims.acquire_calls[0]["source_uri"] == "s3://source/gfs.f003"
    assert claims.submissions == [
        {
            "dataset_id": "gfs",
            "cycle": "2026051100",
            "run_id": "20260511T010203Z-abcdef12",
            "frame_id": "003",
            "job_id": "job-003",
            "now": now,
        }
    ]


def test_launch_planned_workers_skips_active_claim_without_delegating() -> None:
    now = datetime(2026, 5, 11, tzinfo=timezone.utc)
    existing = FrameClaim(
        dataset_id="gfs",
        cycle="2026051100",
        run_id="20260511T010203Z-abcdef12",
        frame_id="003",
        state="claimed",
        attempt=1,
        expires_at_epoch=2_000_000_000,
        job_id="job-existing",
    )
    claims = _FakeClaimStore((FrameClaimResult(acquired=False, attempt=1, existing=existing, reason="active"),))
    backend = _FakeBackend()

    summary = launch_planned_workers(
        workers=(_worker("003"),),
        claim_store=claims,
        backend=backend,
        dataset_id="gfs",
        cycle="2026051100",
        run_id="20260511T010203Z-abcdef12",
        artifact_ids=("tmp_surface",),
        now=now,
    )

    assert summary.workers_started == 0
    assert summary.workers_claimed == 1
    assert summary.records[0].claimed
    assert summary.records[0].job_id == "job-existing"
    assert backend.calls == []
    assert claims.submissions == []


def test_launch_planned_workers_dry_run_delegates_without_claim_mutation() -> None:
    claims = _FakeClaimStore((FrameClaimResult(acquired=True, attempt=2),))
    backend = _FakeBackend()

    summary = launch_planned_workers(
        workers=(_worker("003"),),
        claim_store=claims,
        backend=backend,
        dataset_id="gfs",
        cycle="2026051100",
        run_id="20260511T010203Z-abcdef12",
        artifact_ids=("tmp_surface",),
        now=datetime(2026, 5, 11, tzinfo=timezone.utc),
        dry_run=True,
    )

    assert summary.workers_started == 0
    assert backend.calls[0]["dry_run"] is True
    assert claims.acquire_calls == []
    assert claims.submissions == []


def test_launch_planned_workers_accepts_null_claim_store() -> None:
    backend = _FakeBackend()

    summary = launch_planned_workers(
        workers=(_worker("003"),),
        claim_store=NullFrameClaimStore(),
        backend=backend,
        dataset_id="gfs",
        cycle="2026051100",
        run_id="20260511T010203Z-abcdef12",
        artifact_ids=("tmp_surface",),
        now=datetime(2026, 5, 11, tzinfo=timezone.utc),
    )

    assert summary.workers_started == 1
    assert backend.calls[0]["requests"][0].attempt == 1


def test_launch_run_plan_workers_uses_plan_identity_and_worker_subset() -> None:
    now = datetime(2026, 5, 11, tzinfo=timezone.utc)
    backend = _FakeBackend()
    claims = _FakeClaimStore((FrameClaimResult(acquired=True, attempt=1),))
    plan = run_plan(
        cycle="2026051100",
        run_id="20260511T010203Z-abcdef12",
        artifact_root_uri="file:///artifacts",
        workers=(_worker("003"), _worker("006")),
    )

    summary = launch_run_plan_workers(
        plan=plan,
        workers=(plan.workers[1],),
        claim_store=claims,
        backend=backend,
        now=now,
    )

    assert summary.workers_started == 1
    assert summary.record_for_frame("006") == summary.records[0]
    assert summary.record_for_frame("003") is None
    assert backend.calls[0]["requests"][0].worker.frame_id == "006"
    assert claims.acquire_calls == [
        {
            "dataset_id": "gfs",
            "cycle": "2026051100",
            "run_id": "20260511T010203Z-abcdef12",
            "frame_id": "006",
            "artifact_ids": ("tmp_surface",),
            "worker_spec_hash": plan.workers[1].worker_spec_hash,
            "source_uri": "s3://source/gfs.f006",
            "now": now,
        }
    ]


def _worker(frame_id: str) -> FrameWorkerSpec:
    return frame_worker(
        frame_id=frame_id,
        dataset_id="gfs",
        env={"DATASET_ID": "gfs", "FRAME_ID": frame_id},
        command=("weather-etl", "run-frame", "--frame-id", frame_id),
        source_uri=f"s3://source/gfs.f{frame_id}",
    )
