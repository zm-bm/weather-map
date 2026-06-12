from __future__ import annotations

from pathlib import Path

import pytest

from tests.fixtures.scripts import (
    ETL_APP_FINGERPRINT_LABEL,
    ETL_BASE_FINGERPRINT_LABEL,
    WorkerImageBuildScriptHarness,
    worker_image_build_script_harness,
)


@pytest.fixture
def script(repo_root: Path, tmp_path: Path) -> WorkerImageBuildScriptHarness:
    return worker_image_build_script_harness(repo_root, tmp_path)


def test_current_base_and_app_images_skip_rebuilds(script: WorkerImageBuildScriptHarness) -> None:
    base_fingerprint = script.current_base_image_source_fingerprint()
    app_fingerprint = script.current_app_image_source_fingerprint()
    image_uri = _ecr_image_uri()

    result = script.run(
        env_overrides={
            "IMAGE_TAG": "test-tag",
            "ETL_CODE_REVISION": "test-revision",
            "PUSH_IMAGE": "false",
            "FAKE_DOCKER_IMAGE_LABELS_JSON": _ecr_image_labels(
                script,
                base_fingerprint=base_fingerprint,
                app_fingerprint=app_fingerprint,
                app_base_fingerprint=base_fingerprint,
            ),
        },
    )

    log_text = script.docker_log()

    assert result.returncode == 0
    assert "ETL base image is current; reusing local base-latest." in result.stdout
    assert "ETL app image is current; reusing local latest." in result.stdout
    assert " build " not in f" {log_text} "
    assert f"tag {image_uri}:base-latest {image_uri}:base-{base_fingerprint}" in log_text
    assert f"tag {image_uri}:latest {image_uri}:test-tag" in log_text


def test_stale_app_rebuild_uses_explicit_base_tag(script: WorkerImageBuildScriptHarness) -> None:
    base_fingerprint = script.current_base_image_source_fingerprint()
    app_fingerprint = script.current_app_image_source_fingerprint()
    image_uri = _ecr_image_uri()

    result = script.run(
        env_overrides={
            "IMAGE_TAG": "test-tag",
            "ETL_CODE_REVISION": "test-revision",
            "PUSH_IMAGE": "false",
            "FAKE_DOCKER_IMAGE_LABELS_JSON": _ecr_image_labels(
                script,
                base_fingerprint=base_fingerprint,
                app_fingerprint="stale",
                app_base_fingerprint=base_fingerprint,
            ),
        },
    )

    log_text = script.docker_log()

    assert result.returncode == 0
    assert "Building ETL app image (app image inputs changed)" in result.stdout
    assert "Building ETL base image" not in result.stdout
    assert str(script.repo_root / "etl" / "Dockerfile.base") not in log_text
    assert f"--build-arg ETL_BASE_IMAGE={image_uri}:base-{base_fingerprint}" in log_text
    assert f"--label {ETL_BASE_FINGERPRINT_LABEL}={base_fingerprint}" in log_text
    assert f"--label {ETL_APP_FINGERPRINT_LABEL}={app_fingerprint}" in log_text


def test_push_includes_base_and_app_tags(script: WorkerImageBuildScriptHarness) -> None:
    base_fingerprint = script.current_base_image_source_fingerprint()
    app_fingerprint = script.current_app_image_source_fingerprint()
    image_uri = _ecr_image_uri()

    result = script.run(
        env_overrides={
            "IMAGE_TAG": "test-tag",
            "ETL_CODE_REVISION": "test-revision",
            "PUSH_IMAGE": "true",
            "FAKE_DOCKER_IMAGE_LABELS_JSON": _ecr_image_labels(
                script,
                base_fingerprint=base_fingerprint,
                app_fingerprint=app_fingerprint,
                app_base_fingerprint=base_fingerprint,
            ),
        },
    )

    log_text = script.docker_log()

    assert result.returncode == 0
    assert "login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com" in log_text
    assert f"push {image_uri}:base-{base_fingerprint}" in log_text
    assert f"push {image_uri}:base-latest" in log_text
    assert f"push {image_uri}:test-tag" in log_text
    assert f"push {image_uri}:latest" in log_text


def _ecr_image_uri(
    account_id: str = "123456789012",
    region: str = "us-east-1",
    repository: str = "weather-etl-worker",
) -> str:
    return f"{account_id}.dkr.ecr.{region}.amazonaws.com/{repository}"


def _ecr_image_labels(
    script: WorkerImageBuildScriptHarness,
    *,
    base_fingerprint: str | None = None,
    app_fingerprint: str | None = None,
    app_base_fingerprint: str | None = None,
) -> str:
    image_uri = _ecr_image_uri()
    image_labels: dict[str, dict[str, str]] = {}
    if base_fingerprint is not None:
        image_labels[f"{image_uri}:base-latest"] = {
            ETL_BASE_FINGERPRINT_LABEL: base_fingerprint,
        }
    if app_fingerprint is not None or app_base_fingerprint is not None:
        app_labels: dict[str, str] = {}
        if app_base_fingerprint is not None:
            app_labels[ETL_BASE_FINGERPRINT_LABEL] = app_base_fingerprint
        if app_fingerprint is not None:
            app_labels[ETL_APP_FINGERPRINT_LABEL] = app_fingerprint
        image_labels[f"{image_uri}:latest"] = app_labels
    return script.image_labels_json(image_labels)
