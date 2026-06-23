from __future__ import annotations

from pathlib import Path

import pytest

from tests.fixtures.artifacts import DEFAULT_RUN_ID
from tests.fixtures.scripts import FetchRunScriptHarness, fetch_run_script_harness


@pytest.fixture
def script(repo_root: Path, tmp_path: Path) -> FetchRunScriptHarness:
    return fetch_run_script_harness(repo_root, tmp_path)


def test_requires_explicit_run_coordinates(script: FetchRunScriptHarness) -> None:
    result = script.run("--dataset-id", "gfs")

    assert result.returncode == 2
    assert "--cycle is required" in result.stderr


def test_rejects_non_s3_artifact_roots(script: FetchRunScriptHarness) -> None:
    result = script.run(
        "--dataset-id",
        "gfs",
        "--cycle",
        "2026051100",
        "--run-id",
        DEFAULT_RUN_ID,
        "--artifact-root-uri",
        "file:///artifacts",
    )

    assert result.returncode == 2
    assert "must be an s3:// URI" in result.stderr


def test_fetches_run_prefix(script: FetchRunScriptHarness, tmp_path: Path) -> None:
    dest = tmp_path / "artifacts"

    result = script.run(
        "--dataset-id",
        "gfs",
        "--cycle",
        "2026051100",
        "--run-id",
        DEFAULT_RUN_ID,
        "--artifact-root-uri",
        "s3://artifacts-bucket/weather",
        "--dest",
        dest.as_posix(),
    )

    assert result.returncode == 0
    assert (
        "s3 sync "
        f"s3://artifacts-bucket/weather/runs/gfs/2026051100/{DEFAULT_RUN_ID}/ "
        f"{dest.as_posix()}/runs/gfs/2026051100/{DEFAULT_RUN_ID}/"
    ) in script.aws_log()


def test_include_public_fetches_manifest_and_status_files(script: FetchRunScriptHarness, tmp_path: Path) -> None:
    dest = tmp_path / "artifacts"

    result = script.run(
        "--dataset-id",
        "gfs",
        "--cycle",
        "2026051100",
        "--run-id",
        DEFAULT_RUN_ID,
        "--artifact-root-uri",
        "s3://artifacts-bucket/weather/",
        "--dest",
        dest.as_posix(),
        "--include-public",
    )

    assert result.returncode == 0
    log = script.aws_log()
    for relative_path in (
        "manifests/index.json",
        "manifests/gfs/latest.json",
        "manifests/gfs/cycles/2026051100/current.json",
        f"manifests/gfs/cycles/2026051100/runs/{DEFAULT_RUN_ID}.json",
        "status.json",
    ):
        assert f"s3 cp s3://artifacts-bucket/weather/{relative_path} {dest.as_posix()}/{relative_path}" in log
