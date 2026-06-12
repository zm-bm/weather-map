from __future__ import annotations

from pathlib import Path

import pytest

from tests.fixtures.artifacts import DEFAULT_RUN_ID
from tests.fixtures.scripts import AwsRunScriptHarness, aws_run_script_harness


@pytest.fixture
def script(repo_root: Path, tmp_path: Path) -> AwsRunScriptHarness:
    return aws_run_script_harness(repo_root, tmp_path)


def test_dry_run_shows_snapshot_before_jobs(script: AwsRunScriptHarness) -> None:
    result = script.run(
        "--cycle",
        "2026051100",
        "--run-id",
        DEFAULT_RUN_ID,
        "--dry-run",
        "--skip-config-check",
    )

    assert result.returncode == 0
    assert result.stdout.index("Run snapshot") < result.stdout.index("dry-run job_name")
    assert "source_pipeline_uri: s3://config-bucket/pipeline.json" in result.stdout
    assert "source_catalog_uri:  s3://config-bucket/catalog.json" in result.stdout
    assert _run_config_line("gfs", "2026051100") in result.stdout
    assert _run_catalog_line("gfs", "2026051100") in result.stdout
    assert result.stdout.count("dry-run job_name") == 2
    assert "submit-aws-run" in script.cli_log()


def test_submit_uses_one_snapshot_and_run_scoped_batch_env(script: AwsRunScriptHarness) -> None:
    result = script.run(
        "--cycle",
        "2026051100",
        "--run-id",
        DEFAULT_RUN_ID,
        "--skip-config-check",
    )

    assert result.returncode == 0
    assert "Submitted 2 Batch jobs." in result.stdout
    assert "The scheduled weather-etl-publisher Lambda will validate the run and publish manifests" in result.stdout
    cli_log = script.cli_log()
    assert "submit-aws-run" in cli_log
    assert " init-run " not in cli_log

    jobs = script.submitted_batch_jobs()
    assert len(jobs) == 2
    for expected_frame_id, job in zip(("000", "003"), jobs, strict=True):
        assert f"weather-etl-manual-gfs-2026051100-{DEFAULT_RUN_ID}-{expected_frame_id}" in job["job_name"]
        assert job["job_queue"] == "weather-etl"
        assert job["job_definition"] == "arn:aws:batch:us-east-1:123:job-definition/weather-etl-worker:1"
        env = {item["name"]: item["value"] for item in job["container_overrides"]["environment"]}
        assert env["DATASET_ID"] == "gfs"
        assert env["CYCLE"] == "2026051100"
        assert env["RUN_ID"] == DEFAULT_RUN_ID
        assert env["FRAME_ID"] == expected_frame_id
        assert env["PIPELINE_URI"] == _run_config_uri("gfs", "2026051100")
        assert env["CATALOG_URI"] == _run_catalog_uri("gfs", "2026051100")
        assert env["GRIB_SOURCE_URI"] == _gfs_source_uri("2026051100", expected_frame_id)


def test_icon_submit_uses_icon_job_definition_and_no_grib_source_env(script: AwsRunScriptHarness) -> None:
    result = script.run(
        "--dataset-id",
        "icon",
        "--cycle",
        "2026051100",
        "--run-id",
        DEFAULT_RUN_ID,
        "--skip-config-check",
    )

    assert result.returncode == 0
    jobs = script.submitted_batch_jobs()
    assert len(jobs) == 1
    job = jobs[0]
    assert f"weather-etl-manual-icon-2026051100-{DEFAULT_RUN_ID}-001" in job["job_name"]
    assert job["job_definition"] == "arn:aws:batch:us-east-1:123:job-definition/weather-etl-worker-icon:1"
    env = {item["name"]: item["value"] for item in job["container_overrides"]["environment"]}
    assert env["DATASET_ID"] == "icon"
    assert env["FRAME_ID"] == "001"
    assert "GRIB_SOURCE_URI" not in env
    assert env["PIPELINE_URI"] == _run_config_uri("icon", "2026051100")


def _run_config_uri(dataset_id: str, cycle: str, run_id: str = DEFAULT_RUN_ID) -> str:
    return f"s3://artifacts-bucket/runs/{dataset_id}/{cycle}/{run_id}/config/pipeline.json"


def _run_catalog_uri(dataset_id: str, cycle: str, run_id: str = DEFAULT_RUN_ID) -> str:
    return f"s3://artifacts-bucket/runs/{dataset_id}/{cycle}/{run_id}/config/catalog.json"


def _run_config_line(dataset_id: str, cycle: str, run_id: str = DEFAULT_RUN_ID) -> str:
    return f"pipeline_uri={_run_config_uri(dataset_id, cycle, run_id)}"


def _run_catalog_line(dataset_id: str, cycle: str, run_id: str = DEFAULT_RUN_ID) -> str:
    return f"catalog_uri={_run_catalog_uri(dataset_id, cycle, run_id)}"


def _gfs_source_uri(cycle: str, frame_id: str) -> str:
    return f"s3://noaa-gfs-bdp-pds/gfs.{cycle[:8]}/{cycle[8:10]}/atmos/gfs.t{cycle[8:10]}z.pgrb2.0p25.f{frame_id}"
