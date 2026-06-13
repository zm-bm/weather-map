from __future__ import annotations

import hashlib
import re
from pathlib import Path

import pytest

from tests.fixtures.artifacts import DEFAULT_RUN_ID
from tests.fixtures.scripts import (
    ETL_APP_FINGERPRINT_LABEL,
    ETL_BASE_FINGERPRINT_LABEL,
    LocalRunScriptHarness,
    local_run_script_harness,
)


@pytest.fixture
def script(repo_root: Path, tmp_path: Path) -> LocalRunScriptHarness:
    return local_run_script_harness(repo_root, tmp_path)


def test_icon_dry_run_uses_one_worker_container_per_configured_frame(script: LocalRunScriptHarness) -> None:
    result = script.run(
        "--dataset-id",
        "icon",
        "--cycle",
        "2026021606",
        "--run-id",
        DEFAULT_RUN_ID,
        "--dry-run",
    )

    assert "frames: 48" in result.stdout
    assert result.stdout.count("weather-map-etl:local run-frame") == 48
    assert "--volume " + (script.repo_root / "artifacts").as_posix() + ":/artifacts" in result.stdout
    assert "--volume " + (script.repo_root / "etl" / "cache").as_posix() + ":/app/etl/cache" in result.stdout
    assert "--env ARTIFACT_ROOT_URI=file:///artifacts" in result.stdout
    assert _run_config_uri("icon", "2026021606") in result.stdout
    assert _run_catalog_uri("icon", "2026021606") in result.stdout
    assert "--env DATASET_ID=icon" in result.stdout
    assert f"--env RUN_ID={DEFAULT_RUN_ID}" in result.stdout
    assert "--env FRAME_ID=001" in result.stdout
    assert "--env FRAME_ID=048" in result.stdout
    assert "GRIB_SOURCE_URI" not in result.stdout
    assert result.stdout.count("weather-map-etl:local init-run") == 1
    assert result.stdout.count("weather-map-etl:local validate-run") == 1
    assert result.stdout.count("weather-map-etl:local publish-run") == 1


def test_no_publish_skips_final_publish_container(script: LocalRunScriptHarness) -> None:
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

    assert "frames: 48" in result.stdout
    assert result.stdout.count("weather-map-etl:local run-frame") == 48
    assert result.stdout.count("weather-map-etl:local validate-run") == 1
    assert "weather-map-etl:local publish-run" not in result.stdout


def test_dry_run_without_run_id_generates_one_shared_run_id(script: LocalRunScriptHarness) -> None:
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
    assert result.stdout.count(f"--env RUN_ID={run_id}") == 51
    assert f"--run-id {run_id}" in result.stdout
    assert f"pipeline_uri: file:///artifacts/runs/icon/2026021606/{run_id}/config/pipeline.json" in result.stdout
    assert f"catalog_uri: file:///artifacts/runs/icon/2026021606/{run_id}/config/catalog.json" in result.stdout
    assert result.stdout.count("weather-map-etl:local init-run") == 1
    assert result.stdout.count("weather-map-etl:local run-frame") == 48
    assert result.stdout.count("weather-map-etl:local validate-run") == 1
    assert result.stdout.count("weather-map-etl:local publish-run") == 1


def test_dry_run_reuses_current_worker_image_without_rebuilding(script: LocalRunScriptHarness) -> None:
    docker_log = script.fake_bin_dir / "docker.log"
    base_fingerprint = script.current_base_image_source_fingerprint()
    app_fingerprint = script.current_app_image_source_fingerprint()

    result = script.run(
        "--dataset-id",
        "icon",
        "--cycle",
        "2026021606",
        "--run-id",
        DEFAULT_RUN_ID,
        "--dry-run",
        env_overrides={
            "FAKE_DOCKER_IMAGE_LABELS_JSON": _local_image_labels(
                script,
                base_fingerprint=base_fingerprint,
                app_fingerprint=app_fingerprint,
                app_base_fingerprint=base_fingerprint,
            ),
            "FAKE_DOCKER_LOG": docker_log.as_posix(),
        },
    )

    assert "Worker images are current; skipping rebuild." in result.stdout
    assert not docker_log.exists()


def test_stale_app_image_rebuilds_only_app_with_split_fingerprint_labels(script: LocalRunScriptHarness) -> None:
    docker_log = script.fake_bin_dir / "docker.log"
    base_fingerprint = script.current_base_image_source_fingerprint()
    app_fingerprint = script.current_app_image_source_fingerprint()

    result = script.run(
        "--dataset-id",
        "icon",
        "--cycle",
        "2026021606",
        "--run-id",
        DEFAULT_RUN_ID,
        "--dry-run",
        env_overrides={
            "FAKE_DOCKER_IMAGE_LABELS_JSON": _local_image_labels(
                script,
                base_fingerprint=base_fingerprint,
                app_fingerprint="stale",
                app_base_fingerprint=base_fingerprint,
            ),
            "FAKE_DOCKER_LOG": docker_log.as_posix(),
        },
    )

    log_text = docker_log.read_text(encoding="utf-8")

    assert "Building ETL app image (app image inputs changed)." in result.stdout
    assert "Building ETL base image" not in result.stdout
    assert str(script.repo_root / "etl" / "Dockerfile.base") not in log_text
    assert "--build-arg ETL_BASE_IMAGE=weather-map-etl-base:local" in log_text
    assert f"--label {ETL_BASE_FINGERPRINT_LABEL}={base_fingerprint}" in log_text
    assert f"--label {ETL_APP_FINGERPRINT_LABEL}={app_fingerprint}" in log_text


def test_stale_base_image_rebuilds_base_and_app(script: LocalRunScriptHarness) -> None:
    docker_log = script.fake_bin_dir / "docker.log"
    base_fingerprint = script.current_base_image_source_fingerprint()
    app_fingerprint = script.current_app_image_source_fingerprint()

    result = script.run(
        "--dataset-id",
        "icon",
        "--cycle",
        "2026021606",
        "--run-id",
        DEFAULT_RUN_ID,
        "--dry-run",
        env_overrides={
            "FAKE_DOCKER_IMAGE_LABELS_JSON": _local_image_labels(
                script,
                base_fingerprint="stale",
                app_fingerprint=app_fingerprint,
                app_base_fingerprint="stale",
            ),
            "FAKE_DOCKER_LOG": docker_log.as_posix(),
        },
    )

    log_text = docker_log.read_text(encoding="utf-8")

    assert "Building ETL base image (base image inputs changed)." in result.stdout
    assert "Building ETL app image (base image changed)." in result.stdout
    assert str(script.repo_root / "etl" / "Dockerfile.base") in log_text
    assert str(script.repo_root / "etl" / "Dockerfile") in log_text
    assert f"--label {ETL_BASE_FINGERPRINT_LABEL}={base_fingerprint}" in log_text
    assert f"--label {ETL_APP_FINGERPRINT_LABEL}={app_fingerprint}" in log_text


def test_gfs_dry_run_resolves_configured_frames(script: LocalRunScriptHarness) -> None:
    result = script.run(
        "--dataset-id",
        "gfs",
        "--cycle",
        "2026051100",
        "--run-id",
        DEFAULT_RUN_ID,
        "--dry-run",
    )

    assert "frames: 49" in result.stdout
    assert "--env DATASET_ID=gfs" in result.stdout
    assert f"--env RUN_ID={DEFAULT_RUN_ID}" in result.stdout
    assert "--env FRAME_ID=000" in result.stdout
    assert "--env FRAME_ID=048" in result.stdout


def test_mrms_dry_run_allows_frames_without_cycle(script: LocalRunScriptHarness) -> None:
    frame_ids = ("20260611000000", "20260611000200")

    result = script.run(
        "--dataset-id",
        "mrms",
        "--frames",
        ",".join(frame_ids),
        "--dry-run",
    )

    assert result.returncode == 0
    assert result.stdout.count("weather-map-etl:local init-run") == 2
    assert result.stdout.count("weather-map-etl:local run-frame") == 2
    assert result.stdout.count("weather-map-etl:local validate-run") == 2
    assert result.stdout.count("weather-map-etl:local publish-run") == 2
    for frame_id in frame_ids:
        run_id = _observed_run_id("mrms", frame_id)
        assert f"--env CYCLE={frame_id[:10]}" in result.stdout
        assert f"--env RUN_ID={run_id}" in result.stdout
        assert f"--env FRAME_ID={frame_id}" in result.stdout
        assert f"--frames {frame_id}" in result.stdout


def test_mrms_rejects_run_id_in_wrapper(script: LocalRunScriptHarness) -> None:
    result = script.run(
        "--dataset-id",
        "mrms",
        "--frames",
        "20260611000000",
        "--run-id",
        DEFAULT_RUN_ID,
        "--dry-run",
    )

    assert result.returncode == 1
    assert "--run-id is not supported for observed single-frame local runs" in result.stderr


def test_parallel_run_prints_failed_worker_log_tail(script: LocalRunScriptHarness) -> None:
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


def test_script_invokes_run_local_with_artifacts_dir(script: LocalRunScriptHarness) -> None:
    script_text = script.script.read_text(encoding="utf-8")

    assert "weather_etl run-local" in script_text
    assert '--artifacts-dir "$ARTIFACTS_DIR"' in script_text


def _run_config_uri(dataset_id: str, cycle: str, run_id: str = DEFAULT_RUN_ID) -> str:
    return f"--env PIPELINE_URI=file:///artifacts/runs/{dataset_id}/{cycle}/{run_id}/config/pipeline.json"


def _run_catalog_uri(dataset_id: str, cycle: str, run_id: str = DEFAULT_RUN_ID) -> str:
    return f"--env CATALOG_URI=file:///artifacts/runs/{dataset_id}/{cycle}/{run_id}/config/catalog.json"


def _observed_run_id(dataset_id: str, frame_id: str) -> str:
    suffix = hashlib.sha1(f"{dataset_id}:{frame_id}".encode("utf-8")).hexdigest()[:8]
    return f"{frame_id[:8]}T{frame_id[8:14]}Z-{suffix}"


def _local_image_labels(
    script: LocalRunScriptHarness,
    *,
    base_fingerprint: str | None = None,
    app_fingerprint: str | None = None,
    app_base_fingerprint: str | None = None,
) -> str:
    image_labels: dict[str, dict[str, str]] = {}
    if base_fingerprint is not None:
        image_labels["weather-map-etl-base:local"] = {
            ETL_BASE_FINGERPRINT_LABEL: base_fingerprint,
        }
    if app_fingerprint is not None or app_base_fingerprint is not None:
        app_labels: dict[str, str] = {}
        if app_base_fingerprint is not None:
            app_labels[ETL_BASE_FINGERPRINT_LABEL] = app_base_fingerprint
        if app_fingerprint is not None:
            app_labels[ETL_APP_FINGERPRINT_LABEL] = app_fingerprint
        image_labels["weather-map-etl:local"] = app_labels
    return script.image_labels_json(image_labels)
