from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from tests.fixtures.run_plan import frame_worker
from weather_etl.workers.backends.local_docker import (
    LocalDockerWorkerBackend,
    container_uri,
    local_container_cmd,
    worker_container_cmd,
)
from weather_etl.workers.launch import WorkerLaunchRequest
from weather_etl.workers.spec import FrameWorkerSpec


def test_container_uri_maps_host_artifact_paths_to_container_paths(tmp_path: Path) -> None:
    artifacts_dir = tmp_path / "artifacts"
    payload = artifacts_dir / "runs" / "gfs" / "payload.bin"

    assert container_uri(artifacts_dir.as_uri(), artifacts_dir=artifacts_dir) == "file:///artifacts"
    assert container_uri(payload.as_uri(), artifacts_dir=artifacts_dir) == "file:///artifacts/runs/gfs/payload.bin"
    assert container_uri("s3://bucket/key", artifacts_dir=artifacts_dir) == "s3://bucket/key"


def test_local_container_cmd_includes_artifact_cache_and_env(tmp_path: Path) -> None:
    artifacts_dir = tmp_path / "artifacts"
    cache_dir = tmp_path / "cache"

    with patch.dict("os.environ", {"ETL_CODE_REVISION": "rev-1"}, clear=True):
        cmd = local_container_cmd(
            local_image="weather-etl:local",
            artifacts_dir=artifacts_dir,
            cache_dir=cache_dir,
            extra_mounts=None,
            env={"DATASET_ID": "gfs"},
            command=["run-frame"],
        )

    assert "--volume" in cmd
    assert f"{artifacts_dir.as_posix()}:/artifacts" in cmd
    assert f"{cache_dir.as_posix()}:/app/etl/cache" in cmd
    assert "--env" in cmd
    assert "DATASET_ID=gfs" in cmd
    assert "ETL_CODE_REVISION=rev-1" in cmd
    assert cmd[-2:] == ["weather-etl:local", "run-frame"]


def test_local_container_cmd_includes_readonly_input_mounts(tmp_path: Path) -> None:
    artifacts_dir = tmp_path / "artifacts"
    config_dir = tmp_path / "config"

    with patch.dict("os.environ", {}, clear=True):
        cmd = local_container_cmd(
            local_image="weather-etl:local",
            artifacts_dir=artifacts_dir,
            cache_dir=None,
            extra_mounts={config_dir: "/config/1"},
            env={"PIPELINE_URI": "file:///config/1/pipeline.json"},
            command=["init-run"],
        )

    assert f"{config_dir.as_posix()}:/config/1:ro" in cmd
    assert "PIPELINE_URI=file:///config/1/pipeline.json" in cmd


def test_worker_container_cmd_uses_frame_command_and_containerized_env(tmp_path: Path) -> None:
    artifacts_dir = tmp_path / "artifacts"
    worker = FrameWorkerSpec(
        frame_id="003",
        env={
            "ARTIFACT_ROOT_URI": artifacts_dir.as_uri(),
            "PIPELINE_URI": (artifacts_dir / "runs" / "gfs" / "config" / "pipeline.json").as_uri(),
        },
        command=("weather-etl", "run-frame", "--dataset-id", "gfs", "--frame-id", "003"),
    )

    with patch.dict("os.environ", {}, clear=True):
        cmd = worker_container_cmd(
            local_image="weather-etl:local",
            artifacts_dir=artifacts_dir,
            cache_dir=tmp_path / "cache",
            worker=worker,
        )

    assert "ARTIFACT_ROOT_URI=file:///artifacts" in cmd
    assert "PIPELINE_URI=file:///artifacts/runs/gfs/config/pipeline.json" in cmd
    assert cmd[-5:] == ["run-frame", "--dataset-id", "gfs", "--frame-id", "003"]


def test_container_uri_maps_extra_readonly_mounts_to_container_paths(tmp_path: Path) -> None:
    artifacts_dir = tmp_path / "artifacts"
    config_dir = tmp_path / "config"
    pipeline = config_dir / "pipeline.json"

    assert (
        container_uri(
            pipeline.as_uri(),
            artifacts_dir=artifacts_dir,
            extra_mounts={config_dir: "/config/1"},
        )
        == "file:///config/1/pipeline.json"
    )


def test_local_docker_backend_reports_worker_failures(tmp_path: Path) -> None:
    backend = LocalDockerWorkerBackend(
        local_image="weather-etl:local",
        artifacts_dir=tmp_path / "artifacts",
        cache_dir=tmp_path / "cache",
        procs=1,
        worker_stagger_seconds=0.0,
    )

    with patch("weather_etl.workers.backends.local_docker.run_command", return_value=7):
        records = backend.launch_many(
            (WorkerLaunchRequest(worker=_worker(), source_uri=None, attempt=1),),
            dry_run=False,
        )

    assert len(records) == 1
    assert not records[0].started
    assert records[0].failed


def test_local_docker_backend_preserves_request_order(tmp_path: Path) -> None:
    backend = LocalDockerWorkerBackend(
        local_image="weather-etl:local",
        artifacts_dir=tmp_path / "artifacts",
        cache_dir=tmp_path / "cache",
        procs=2,
        worker_stagger_seconds=0.0,
    )

    def run_command(cmd):
        return 7 if cmd[-1] == "006" else 0

    with patch("weather_etl.workers.backends.local_docker.run_command", side_effect=run_command):
        records = backend.launch_many(
            (
                WorkerLaunchRequest(worker=_worker("003"), source_uri=None),
                WorkerLaunchRequest(worker=_worker("006"), source_uri=None),
            ),
            dry_run=False,
        )

    assert [record.worker.frame_id for record in records] == ["003", "006"]
    assert records[0].started
    assert not records[1].started
    assert records[1].failed


def test_local_docker_backend_dry_run_prints_worker_commands(tmp_path: Path) -> None:
    backend = LocalDockerWorkerBackend(
        local_image="weather-etl:local",
        artifacts_dir=tmp_path / "artifacts",
        cache_dir=tmp_path / "cache",
        procs=1,
        worker_stagger_seconds=0.0,
    )

    with patch("weather_etl.workers.backends.local_docker.run_or_print", return_value=0) as run_or_print:
        records = backend.launch_many(
            (WorkerLaunchRequest(worker=_worker(), source_uri=None),),
            dry_run=True,
        )

    assert not records[0].started
    assert run_or_print.call_args.kwargs["dry_run"] is True


def _worker(frame_id: str = "003") -> FrameWorkerSpec:
    return frame_worker(
        frame_id=frame_id,
        dataset_id="gfs",
        env={"DATASET_ID": "gfs"},
        command=("weather-etl", "run-frame", "--dataset-id", "gfs", "--frame-id", frame_id),
    )
