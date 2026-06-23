from __future__ import annotations

import os
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from tests.fixtures.artifacts import DEFAULT_RUN_ID
from weather_etl.adapters.cli import parser as cli


def test_package_module_entrypoint_runs_cli() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "weather_etl", "--help"],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert "submit-aws-run" in result.stdout
    assert "run-frame" in result.stdout


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


def test_submit_aws_run_delegates_to_submit_handler() -> None:
    fake_boto3 = SimpleNamespace(client=lambda service: f"{service}-client")

    with (
        patch.dict(sys.modules, {"boto3": fake_boto3}),
        patch("weather_etl.adapters.cli.handlers.submit_aws_batch_run", return_value=SimpleNamespace(ok=True)) as submit,
    ):
        result = cli.main(
            [
                "submit-aws-run",
                "--dataset-id",
                "gfs",
                "--cycle",
                "2026021300",
                "--run-id",
                DEFAULT_RUN_ID,
                "--frames",
                "000 003",
                "--artifact",
                "tmp_surface",
                "--job-queue",
                "weather-etl",
                "--job-definition",
                "weather-etl-worker:1",
                "--frame-claim-table",
                "frame-claims",
                "--dry-run",
            ]
        )

    assert result == 0
    assert submit.call_args.kwargs["dataset_id"] == "gfs"
    assert submit.call_args.kwargs["cycle"] == "2026021300"
    assert submit.call_args.kwargs["run_id"] == DEFAULT_RUN_ID
    assert submit.call_args.kwargs["selected_frames"] == ("000", "003")
    assert submit.call_args.kwargs["selected_artifacts"] == ["tmp_surface"]
    assert submit.call_args.kwargs["batch"] == "batch-client"
    assert submit.call_args.kwargs["ddb"] == "dynamodb-client"
    assert submit.call_args.kwargs["frame_claim_table"] == "frame-claims"
    assert submit.call_args.kwargs["dry_run"]
