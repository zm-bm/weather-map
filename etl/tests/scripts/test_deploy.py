from __future__ import annotations

from pathlib import Path

import pytest

from tests.fixtures.scripts import (
    ETL_APP_FINGERPRINT_LABEL,
    ETL_BASE_FINGERPRINT_LABEL,
    DeployScriptHarness,
    deploy_script_harness,
)


@pytest.fixture
def script(repo_root: Path, tmp_path: Path) -> DeployScriptHarness:
    return deploy_script_harness(repo_root, tmp_path)


def test_default_deploy_stops_after_plan_when_prompt_is_declined(script: DeployScriptHarness) -> None:
    result = script.run(input_text="n\n")

    terraform_log = script.terraform_log()

    assert result.returncode == 0
    assert "Deploy stopped after plan." in result.stdout
    assert "init" in terraform_log
    assert "validate" in terraform_log
    assert "plan -var worker_image_tag=" in terraform_log
    assert "apply" not in terraform_log
    assert script.docker_log() == ""
    assert script.aws_log() == ""


def test_approved_deploy_creates_ecr_before_push_then_applies_stack(script: DeployScriptHarness) -> None:
    base_fingerprint = script.current_base_image_source_fingerprint()
    app_fingerprint = script.current_app_image_source_fingerprint()
    image_uri = _ecr_image_uri()

    result = script.run(
        "--image-tag",
        "test-tag",
        env_overrides={
            "FAKE_DOCKER_IMAGE_LABELS_JSON": _ecr_image_labels(
                script,
                base_fingerprint=base_fingerprint,
                app_fingerprint=app_fingerprint,
                app_base_fingerprint=base_fingerprint,
            ),
        },
        input_text="y\n",
    )

    terraform_log = script.terraform_log()
    docker_log = script.docker_log()
    aws_log = script.aws_log()

    assert result.returncode == 0
    assert "Apply Terraform" not in result.stdout
    assert "apply -auto-approve -target=aws_ecr_repository.worker -var worker_image_tag=test-tag" in terraform_log
    assert "apply -auto-approve -var worker_image_tag=test-tag" in terraform_log
    assert f"tag {image_uri}:base-latest {image_uri}:base-{base_fingerprint}" in docker_log
    assert f"tag {image_uri}:latest {image_uri}:test-tag" in docker_log
    assert f"push {image_uri}:base-{base_fingerprint}" in docker_log
    assert f"push {image_uri}:base-latest" in docker_log
    assert f"push {image_uri}:test-tag" in docker_log
    assert f"push {image_uri}:latest" in docker_log
    assert "ecr describe-repositories --repository-names weather-etl-worker" in aws_log
    assert "s3 cp" not in aws_log
    _assert_order(
        script.command_log(),
        "apply -auto-approve -target=aws_ecr_repository.worker -var worker_image_tag=test-tag",
        f"push {image_uri}:test-tag",
    )
    _assert_order(
        script.command_log(),
        f"push {image_uri}:test-tag",
        "apply -auto-approve -var worker_image_tag=test-tag",
    )


def test_auto_approve_skips_prompt_and_uses_same_ecr_first_order(script: DeployScriptHarness) -> None:
    base_fingerprint = script.current_base_image_source_fingerprint()
    app_fingerprint = script.current_app_image_source_fingerprint()
    image_uri = _ecr_image_uri()

    result = script.run(
        "--auto-approve",
        "--image-tag",
        "auto-tag",
        env_overrides={
            "FAKE_DOCKER_IMAGE_LABELS_JSON": _ecr_image_labels(
                script,
                base_fingerprint=base_fingerprint,
                app_fingerprint=app_fingerprint,
                app_base_fingerprint=base_fingerprint,
            ),
        },
    )

    command_log = script.command_log()

    assert result.returncode == 0
    assert "[y/N]" not in result.stdout
    _assert_order(
        command_log,
        "apply -auto-approve -target=aws_ecr_repository.worker -var worker_image_tag=auto-tag",
        f"push {image_uri}:auto-tag",
    )
    _assert_order(
        command_log,
        f"push {image_uri}:auto-tag",
        "apply -auto-approve -var worker_image_tag=auto-tag",
    )


def test_image_tag_override_is_used_for_terraform_and_app_image(script: DeployScriptHarness) -> None:
    base_fingerprint = script.current_base_image_source_fingerprint()
    app_fingerprint = script.current_app_image_source_fingerprint()
    image_uri = _ecr_image_uri()

    result = script.run(
        "--auto-approve",
        "--image-tag=custom-tag",
        env_overrides={
            "FAKE_DOCKER_IMAGE_LABELS_JSON": _ecr_image_labels(
                script,
                base_fingerprint=base_fingerprint,
                app_fingerprint="stale",
                app_base_fingerprint=base_fingerprint,
            ),
        },
    )

    docker_log = script.docker_log()

    assert result.returncode == 0
    assert "plan -var worker_image_tag=custom-tag" in script.terraform_log()
    assert "apply -auto-approve -target=aws_ecr_repository.worker -var worker_image_tag=custom-tag" in script.terraform_log()
    assert "apply -auto-approve -var worker_image_tag=custom-tag" in script.terraform_log()
    assert "Building ETL app image (app image inputs changed)" in result.stdout
    assert f"--build-arg ETL_BASE_IMAGE={image_uri}:base-{base_fingerprint}" in docker_log
    assert f"--label {ETL_BASE_FINGERPRINT_LABEL}={base_fingerprint}" in docker_log
    assert f"--label {ETL_APP_FINGERPRINT_LABEL}={app_fingerprint}" in docker_log
    assert f"-t {image_uri}:custom-tag" in docker_log


def test_upload_static_flag_uploads_static_artifacts(script: DeployScriptHarness, tmp_path: Path) -> None:
    base_fingerprint = script.current_base_image_source_fingerprint()
    app_fingerprint = script.current_app_image_source_fingerprint()
    artifact_root = _static_artifact_root(tmp_path)

    result = script.run(
        "--auto-approve",
        "--image-tag",
        "static-tag",
        "--upload-static",
        env_overrides={
            "ARTIFACT_ROOT": artifact_root.as_posix(),
            "FAKE_DOCKER_IMAGE_LABELS_JSON": _ecr_image_labels(
                script,
                base_fingerprint=base_fingerprint,
                app_fingerprint=app_fingerprint,
                app_base_fingerprint=base_fingerprint,
            ),
        },
    )

    aws_log = script.aws_log()

    assert result.returncode == 0
    assert "Uploading static weather-map artifacts" in result.stdout
    assert aws_log.count("s3 cp ") == 1
    assert "s3://artifacts-bucket/pmtiles/" in aws_log


def _static_artifact_root(tmp_path: Path) -> Path:
    root = tmp_path / "static-artifacts"
    (root / "pmtiles").mkdir(parents=True)
    (root / "pmtiles" / "world.pmtiles").write_bytes(b"pmtiles")
    return root


def _ecr_image_uri(
    account_id: str = "123456789012",
    region: str = "us-east-1",
    repository: str = "weather-etl-worker",
) -> str:
    return f"{account_id}.dkr.ecr.{region}.amazonaws.com/{repository}"


def _assert_order(text: str, first: str, second: str) -> None:
    assert first in text
    assert second in text
    assert text.index(first) < text.index(second)


def _ecr_image_labels(
    script: DeployScriptHarness,
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
