from __future__ import annotations

from tests.fixtures.run_plan import frame_worker
from weather_etl.workers.backends.aws_batch import (
    AwsBatchWorkerBackend,
    batch_worker_job_name,
)
from weather_etl.workers.launch import WorkerLaunchRequest
from weather_etl.workers.spec import FrameWorkerSpec


class _FakeBatchClient:
    def __init__(self) -> None:
        self.submissions: list[dict] = []

    def submit_job(self, **kwargs) -> dict[str, str]:
        self.submissions.append(kwargs)
        return {"jobId": "job-123"}


def test_aws_batch_backend_submits_worker_command_and_env() -> None:
    batch = _FakeBatchClient()
    backend = AwsBatchWorkerBackend(
        batch=batch,
        queue="weather-etl",
        job_definition="weather-etl-worker:1",
        job_name_for_worker=lambda worker, attempt: f"{worker.frame_id}-{attempt}",
    )
    worker = _worker()

    records = backend.launch_many(
        (
            WorkerLaunchRequest(
                worker=worker,
                source_uri="s3://source/gfs.f003",
                attempt=2,
            ),
        ),
        dry_run=False,
    )

    assert len(records) == 1
    assert records[0].started
    assert records[0].job_id == "job-123"
    assert records[0].job_name == "003-2"
    submission = batch.submissions[0]
    assert submission["jobName"] == "003-2"
    assert submission["jobQueue"] == "weather-etl"
    assert submission["jobDefinition"] == "weather-etl-worker:1"
    assert submission["containerOverrides"]["command"] == ["run-frame", "--dataset-id", "gfs", "--frame-id", "003"]
    env = {item["name"]: item["value"] for item in submission["containerOverrides"]["environment"]}
    assert env["DATASET_ID"] == "gfs"
    assert env["FRAME_ID"] == "003"


def test_aws_batch_backend_dry_run_returns_job_name_without_submitting() -> None:
    batch = _FakeBatchClient()
    backend = AwsBatchWorkerBackend(
        batch=batch,
        queue="weather-etl",
        job_definition="weather-etl-worker:1",
        job_name_for_worker=lambda worker, attempt: f"{worker.frame_id}-{attempt or 'dry'}",
    )

    records = backend.launch_many(
        (WorkerLaunchRequest(worker=_worker(), source_uri=None),),
        dry_run=True,
    )

    assert records[0].job_name == "003-dry"
    assert not records[0].started
    assert batch.submissions == []


def test_batch_worker_job_name_is_stable_and_bounded() -> None:
    name = batch_worker_job_name(
        prefix="weather-etl",
        dataset_id="gfs",
        cycle="2026051100",
        run_id="20260511T010203Z-abcdef12",
        frame_id="003",
        worker_spec_hash="0123456789abcdef",
    )

    assert name == "weather-etl-gfs-2026051100-20260511T010203Z-abcdef12-003-01234567"
    assert len(name) <= 128


def _worker() -> FrameWorkerSpec:
    return frame_worker(
        frame_id="003",
        dataset_id="gfs",
        env={
            "DATASET_ID": "gfs",
            "CYCLE": "2026051100",
            "RUN_ID": "20260511T010203Z-abcdef12",
            "FRAME_ID": "003",
        },
        command=("weather-etl", "run-frame", "--dataset-id", "gfs", "--frame-id", "003"),
    )
