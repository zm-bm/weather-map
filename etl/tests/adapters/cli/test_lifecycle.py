from __future__ import annotations

import io
import os
import subprocess
import sys
from contextlib import redirect_stdout
from unittest.mock import patch

import pytest
from tests.fixtures.artifacts import DEFAULT_RUN_ID
from weather_etl.adapters import cli
from weather_etl.operations.publish_run import PublishRunResult
from weather_etl.operations.validate_run import ValidateRunResult


def test_package_module_entrypoint_runs_cli() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "weather_etl", "smoke"],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert result.stdout == "hello world\n"


def test_run_frame_requires_dataset_id() -> None:
    with patch.dict(os.environ, {}, clear=True):
        with pytest.raises(SystemExit):
            cli.main(
                [
                    "run-frame",
                    "--cycle",
                    "2026021300",
                    "--run-id",
                    DEFAULT_RUN_ID,
                    "--frame-id",
                    "003",
                    "--source-uri",
                    "file:///tmp/input.grib2",
                ]
            )


def test_run_frame_processes_without_publishing() -> None:
    with patch("weather_etl.adapters.cli.handlers.run_frame") as run_frame:
        result = cli.main(
            [
                "run-frame",
                "--dataset-id",
                "gfs",
                "--cycle",
                "2026021300",
                "--run-id",
                DEFAULT_RUN_ID,
                "--frame-id",
                "003",
                "--source-uri",
                "s3://noaa-gfs-bdp-pds/gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003",
            ]
        )

    assert result == 0
    assert run_frame.call_args.kwargs["dataset_id"] == "gfs"
    assert run_frame.call_args.kwargs["cycle"] == "2026021300"
    assert run_frame.call_args.kwargs["run_id"] == DEFAULT_RUN_ID
    assert run_frame.call_args.kwargs["frame_id"] == "003"
    assert (
        run_frame.call_args.kwargs["source_uri"]
        == "s3://noaa-gfs-bdp-pds/gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003"
    )
    assert run_frame.call_args.kwargs["selected_artifacts"] is None


def test_run_frame_requires_run_id() -> None:
    with (
        patch.dict(os.environ, {}, clear=True),
        patch("weather_etl.adapters.cli.handlers.run_frame") as run_process_frame,
    ):
        with pytest.raises(SystemExit) as raised:
            cli.main(
                [
                    "run-frame",
                    "--dataset-id",
                    "gfs",
                    "--cycle",
                    "2026021300",
                    "--frame-id",
                    "003",
                ]
            )

    assert "--run-id" in str(raised.value)
    run_process_frame.assert_not_called()


def test_run_frame_forwards_selected_artifacts() -> None:
    with patch("weather_etl.adapters.cli.handlers.run_frame") as run_frame:
        result = cli.main(
            [
                "run-frame",
                "--dataset-id",
                "gfs",
                "--cycle",
                "2026021300",
                "--run-id",
                DEFAULT_RUN_ID,
                "--frame-id",
                "003",
                "--artifact",
                "rh_surface",
            ]
        )

    assert result == 0
    assert run_frame.call_args.kwargs["selected_artifacts"] == ["rh_surface"]


def test_run_frame_uses_env_fallbacks() -> None:
    with (
        patch.dict(
            os.environ,
            {
                "CYCLE": "2026021300",
                "RUN_ID": DEFAULT_RUN_ID,
                "FRAME_ID": "006",
                "GRIB_SOURCE_URI": "https://example.test/gfs.t00z.pgrb2.0p25.f006",
                "DATASET_ID": "gfs",
            },
            clear=False,
        ),
        patch("weather_etl.adapters.cli.handlers.run_frame") as run_frame,
    ):
        result = cli.main(["run-frame"])

    assert result == 0
    assert run_frame.call_args.kwargs["dataset_id"] == "gfs"
    assert run_frame.call_args.kwargs["cycle"] == "2026021300"
    assert run_frame.call_args.kwargs["run_id"] == DEFAULT_RUN_ID
    assert run_frame.call_args.kwargs["frame_id"] == "006"
    assert run_frame.call_args.kwargs["source_uri"] == "https://example.test/gfs.t00z.pgrb2.0p25.f006"
    assert run_frame.call_args.kwargs["selected_artifacts"] is None


def test_publish_run_publishes_ready_cycle(loaded_run_snapshot_factory) -> None:
    with patch(
        "weather_etl.adapters.cli.handlers.publish_run",
        return_value=PublishRunResult(ready=True, run_id=DEFAULT_RUN_ID),
    ) as publish_run:
        result = cli.main(["publish-run", "--dataset-id", "gfs", "--cycle", "2026021300", "--run-id", DEFAULT_RUN_ID])

    assert result == 0
    assert publish_run.call_args.kwargs["dataset_id"] == "gfs"
    assert publish_run.call_args.kwargs["cycle"] == "2026021300"
    assert publish_run.call_args.kwargs["required_run_id"] == DEFAULT_RUN_ID


def test_publish_run_returns_not_ready_exit_code(loaded_run_snapshot_factory) -> None:
    with patch(
        "weather_etl.adapters.cli.handlers.publish_run",
        return_value=PublishRunResult(
            ready=False,
            run_id=DEFAULT_RUN_ID,
            message="missing markers",
            errors=("missing marker",),
        ),
    ):
        result = cli.main(["publish-run", "--dataset-id", "gfs", "--cycle", "2026021300", "--run-id", DEFAULT_RUN_ID])

    assert result == 2


def test_validate_run_writes_report_for_ready_run(loaded_run_snapshot_factory) -> None:
    with patch(
        "weather_etl.adapters.cli.handlers.validate_run",
        return_value=ValidateRunResult(ready=True, passed=True, run_id=DEFAULT_RUN_ID),
    ) as validate_run:
        result = cli.main(
            ["validate-run", "--dataset-id", "gfs", "--cycle", "2026021300", "--run-id", DEFAULT_RUN_ID]
        )

    assert result == 0
    assert validate_run.call_args.kwargs["cycle"] == "2026021300"
    assert validate_run.call_args.kwargs["required_run_id"] == DEFAULT_RUN_ID


def test_validate_run_returns_not_ready_for_failed_validation(loaded_run_snapshot_factory) -> None:
    with patch(
        "weather_etl.adapters.cli.handlers.validate_run",
        return_value=ValidateRunResult(ready=True, passed=False, run_id=DEFAULT_RUN_ID),
    ):
        result = cli.main(
            ["validate-run", "--dataset-id", "gfs", "--cycle", "2026021300", "--run-id", DEFAULT_RUN_ID]
        )

    assert result == 2


def test_validate_run_returns_not_ready_for_missing_snapshot() -> None:
    with patch(
        "weather_etl.adapters.cli.handlers.validate_run",
        return_value=ValidateRunResult(
            ready=False,
            passed=False,
            run_id=DEFAULT_RUN_ID,
            message="missing run snapshot",
            errors=("missing run snapshot",),
        ),
    ) as validate_run:
        result = cli.main(
            ["validate-run", "--dataset-id", "gfs", "--cycle", "2026021300", "--run-id", DEFAULT_RUN_ID]
        )

    assert result == 2
    validate_run.assert_called_once()


def test_init_run_writes_snapshot_and_prints_snapshot_uris(loaded_run_snapshot_factory) -> None:
    loaded_snapshot = loaded_run_snapshot_factory(artifact_root_uri="file:///artifacts", frame_start=0, frame_end=1)
    out = io.StringIO()

    with (
        patch("weather_etl.adapters.cli.handlers.init_run", return_value=loaded_snapshot) as init_run,
        redirect_stdout(out),
    ):
        result = cli.main(["init-run", "--dataset-id", "gfs", "--cycle", "2026021300", "--run-id", DEFAULT_RUN_ID])

    assert result == 0
    init_run.assert_called_once()
    assert f"run_id={DEFAULT_RUN_ID}" in out.getvalue()
    assert "pipeline_uri=file:///artifacts/runs/gfs/2026021300/" in out.getvalue()


def test_init_run_forwards_selected_frames(loaded_run_snapshot_factory) -> None:
    loaded_snapshot = loaded_run_snapshot_factory(artifact_root_uri="file:///artifacts", frame_start=0, frame_end=1)

    with patch("weather_etl.adapters.cli.handlers.init_run", return_value=loaded_snapshot) as init_run:
        result = cli.main(
            [
                "init-run",
                "--dataset-id",
                "mrms",
                "--cycle",
                "2026061100",
                "--run-id",
                DEFAULT_RUN_ID,
                "--frames",
                "20260611000000",
            ]
        )

    assert result == 0
    assert init_run.call_args.kwargs["selected_frames"] == ("20260611000000",)


def test_run_local_delegates_to_lifecycle_handler(tmp_path) -> None:
    with patch("weather_etl.adapters.cli.handlers.run_local") as run_local:
        result = cli.main(
            [
                "run-local",
                "--dataset-id",
                "gfs",
                "--cycle",
                "2026021300",
                "--frames",
                "000 003",
                "--artifact-root-uri",
                "file:///artifacts",
                "--artifacts-dir",
                (tmp_path / "artifacts").as_posix(),
                "--cache-dir",
                (tmp_path / "cache").as_posix(),
                "--local-image",
                "weather-etl:local",
                "--no-publish",
                "--procs",
                "2",
            ]
        )

    assert result == 0
    assert run_local.call_args.kwargs["dataset_id"] == "gfs"
    assert run_local.call_args.kwargs["cycle"] == "2026021300"
    assert run_local.call_args.kwargs["run_id"] is None
    assert run_local.call_args.kwargs["selected_frames"] == ("000", "003")
    assert run_local.call_args.kwargs["selected_artifacts"] is None
    assert run_local.call_args.kwargs["procs"] == 2
    assert not run_local.call_args.kwargs["dry_run"]
    assert run_local.call_args.kwargs["local_image"] == "weather-etl:local"
    assert not run_local.call_args.kwargs["publish"]


def test_run_local_forwards_selected_artifacts(tmp_path) -> None:
    with patch("weather_etl.adapters.cli.handlers.run_local") as run_local:
        result = cli.main(
            [
                "run-local",
                "--dataset-id",
                "gfs",
                "--cycle",
                "2026021300",
                "--artifacts-dir",
                (tmp_path / "artifacts").as_posix(),
                "--cache-dir",
                (tmp_path / "cache").as_posix(),
                "--local-image",
                "weather-etl:local",
                "--artifact",
                "not_configured",
            ]
        )

    assert result == 0
    assert run_local.call_args.kwargs["selected_artifacts"] == ["not_configured"]
