from __future__ import annotations

import re
from pathlib import Path

import pytest

from tests.fixtures.artifacts import DEFAULT_RUN_ID
from tests.fixtures.scripts import LocalCycleScriptHarness, local_cycle_script_harness


@pytest.fixture
def script(repo_root: Path, tmp_path: Path) -> LocalCycleScriptHarness:
    return local_cycle_script_harness(repo_root, tmp_path)


def test_icon_dry_run_uses_one_worker_container_per_configured_frame(script: LocalCycleScriptHarness) -> None:
    result = script.run(
        "--dataset-id",
        "icon",
        "--cycle",
        "2026021606",
        "--run-id",
        DEFAULT_RUN_ID,
        "--dry-run",
    )

    assert "frames: 72" in result.stdout
    assert result.stdout.count("weather-map-etl:local run-frame") == 72
    assert "--volume " + (script.repo_root / "artifacts").as_posix() + ":/artifacts" in result.stdout
    assert "--volume " + (script.repo_root / "etl" / "cache").as_posix() + ":/app/etl/cache" in result.stdout
    assert "--env ARTIFACT_ROOT_URI=file:///artifacts" in result.stdout
    assert _run_config_uri("icon", "2026021606") in result.stdout
    assert _run_catalog_uri("icon", "2026021606") in result.stdout
    assert "--env DATASET_ID=icon" in result.stdout
    assert f"--env RUN_ID={DEFAULT_RUN_ID}" in result.stdout
    assert "--env FRAME_ID=001" in result.stdout
    assert "--env FRAME_ID=072" in result.stdout
    assert "GRIB_SOURCE_URI" not in result.stdout
    assert result.stdout.count("weather-map-etl:local init-run") == 1
    assert result.stdout.count("weather-map-etl:local validate-cycle") == 1
    assert result.stdout.count("weather-map-etl:local publish-cycle") == 1


def test_no_publish_skips_final_publish_container(script: LocalCycleScriptHarness) -> None:
    result = script.run(
        "--dataset-id",
        "icon",
        "--cycle",
        "2026021606",
        "--run-id",
        DEFAULT_RUN_ID,
        "--no-publish",
        "--dry-run",
    )

    assert "frames: 72" in result.stdout
    assert result.stdout.count("weather-map-etl:local run-frame") == 72
    assert result.stdout.count("weather-map-etl:local validate-cycle") == 1
    assert "weather-map-etl:local publish-cycle" not in result.stdout


def test_dry_run_without_run_id_generates_one_shared_run_id(script: LocalCycleScriptHarness) -> None:
    result = script.run(
        "--dataset-id",
        "icon",
        "--cycle",
        "2026021606",
        "--dry-run",
    )

    run_ids = re.findall(r"--env RUN_ID=([0-9]{8}T[0-9]{6}Z-[0-9a-f]{8})", result.stdout)
    assert run_ids
    assert len(set(run_ids)) == 1
    run_id = run_ids[0]
    assert result.stdout.count(f"--env RUN_ID={run_id}") == 75
    assert f"--run-id {run_id}" in result.stdout
    assert f"pipeline_uri: file:///artifacts/runs/icon/2026021606/{run_id}/config/pipeline.json" in result.stdout
    assert f"catalog_uri: file:///artifacts/runs/icon/2026021606/{run_id}/config/catalog.json" in result.stdout
    assert result.stdout.count("weather-map-etl:local init-run") == 1
    assert result.stdout.count("weather-map-etl:local run-frame") == 72
    assert result.stdout.count("weather-map-etl:local validate-cycle") == 1
    assert result.stdout.count("weather-map-etl:local publish-cycle") == 1


def test_dry_run_reuses_current_worker_image_without_rebuilding(script: LocalCycleScriptHarness) -> None:
    docker_log = script.fake_bin_dir / "docker.log"

    result = script.run(
        "--dataset-id",
        "icon",
        "--cycle",
        "2026021606",
        "--run-id",
        DEFAULT_RUN_ID,
        "--dry-run",
        env_overrides={
            "FAKE_DOCKER_IMAGE_FINGERPRINT": script.current_image_source_fingerprint(),
            "FAKE_DOCKER_LOG": docker_log.as_posix(),
        },
    )

    assert "Worker image is current; skipping rebuild." in result.stdout
    assert not docker_log.exists()


def test_stale_worker_image_rebuilds_with_source_fingerprint_label(script: LocalCycleScriptHarness) -> None:
    docker_log = script.fake_bin_dir / "docker.log"

    result = script.run(
        "--dataset-id",
        "icon",
        "--cycle",
        "2026021606",
        "--run-id",
        DEFAULT_RUN_ID,
        "--dry-run",
        env_overrides={
            "FAKE_DOCKER_IMAGE_FINGERPRINT": "stale",
            "FAKE_DOCKER_LOG": docker_log.as_posix(),
        },
    )

    assert "Building worker image (ETL image inputs changed)." in result.stdout
    expected_label = "org.zmbm.weather-map.weather-etl.source-fingerprint=" + script.current_image_source_fingerprint()
    assert f"--label {expected_label}" in docker_log.read_text(encoding="utf-8")


def test_gfs_dry_run_resolves_configured_frames(script: LocalCycleScriptHarness) -> None:
    result = script.run(
        "--dataset-id",
        "gfs",
        "--cycle",
        "2026051100",
        "--run-id",
        DEFAULT_RUN_ID,
        "--dry-run",
    )

    assert "frames: 73" in result.stdout
    assert "--env DATASET_ID=gfs" in result.stdout
    assert f"--env RUN_ID={DEFAULT_RUN_ID}" in result.stdout
    assert "--env FRAME_ID=000" in result.stdout
    assert "--env FRAME_ID=072" in result.stdout


def test_parallel_run_prints_failed_worker_log_tail(script: LocalCycleScriptHarness) -> None:
    result = script.run(
        "--dataset-id",
        "icon",
        "--cycle",
        "2026021606",
        "--procs",
        "4",
        env_overrides={
            "ETL_WORKER_STAGGER_SECONDS": "0",
            "FAKE_DOCKER_FAIL_FRAME": "003",
        },
    )

    assert result.returncode == 1
    assert "simulated worker failure for frame_id=003" in result.stderr


def test_script_invokes_run_cycle_with_artifacts_dir(script: LocalCycleScriptHarness) -> None:
    script_text = script.script.read_text(encoding="utf-8")

    assert "weather_etl run-cycle" in script_text
    assert '--artifacts-dir "$ARTIFACTS_DIR"' in script_text


def _run_config_uri(dataset_id: str, cycle: str, run_id: str = DEFAULT_RUN_ID) -> str:
    return f"--env PIPELINE_URI=file:///artifacts/runs/{dataset_id}/{cycle}/{run_id}/config/pipeline.json"


def _run_catalog_uri(dataset_id: str, cycle: str, run_id: str = DEFAULT_RUN_ID) -> str:
    return f"--env CATALOG_URI=file:///artifacts/runs/{dataset_id}/{cycle}/{run_id}/config/catalog.json"
