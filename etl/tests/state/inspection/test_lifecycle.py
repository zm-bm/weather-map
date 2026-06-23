from __future__ import annotations

from datetime import datetime, timezone

from weather_etl.state.inspection.lifecycle import inspect_run_lifecycle
from weather_etl.state.manifest.schema import parse_cycle_manifest

from tests.fixtures.artifacts import DEFAULT_RUN_ID, temp_artifact_fixture
from tests.state.inspection.lifecycle_helpers import (
    CYCLE,
    NEWER_RUN_ID,
    run_manifest,
    write_public_latest_current_manifests,
    write_snapshot,
    write_validation,
)


def test_lifecycle_reports_missing_snapshot_stage() -> None:
    with temp_artifact_fixture() as artifacts:
        artifacts.write_success_marker(cycle=CYCLE, artifact_id="tmp_surface", frame_id="000", run_id=DEFAULT_RUN_ID)

        lifecycle = _inspect(artifacts)

    assert lifecycle.stage == "missing_snapshot"
    assert lifecycle.state == "missing_snapshot"
    assert lifecycle.markers.summary["completed"] == 1
    assert lifecycle.complete is None


def test_lifecycle_reports_invalid_snapshot_stage() -> None:
    with temp_artifact_fixture() as artifacts:
        artifacts.store.write_bytes(
            uri=artifacts.paths.run_metadata_uri(dataset_id="gfs", cycle=CYCLE, run_id=NEWER_RUN_ID),
            data=b"{not-json",
        )

        lifecycle = _inspect(artifacts, run_id=NEWER_RUN_ID)

    assert lifecycle.stage == "invalid_snapshot"
    assert lifecycle.state == "invalid_snapshot"
    assert lifecycle.snapshot.summary["status"] == "invalid"


def test_lifecycle_reports_pending_frames_stage() -> None:
    with temp_artifact_fixture() as artifacts:
        write_snapshot(artifacts)

        lifecycle = _inspect(artifacts)

    assert lifecycle.stage == "pending_frames"
    assert lifecycle.state == "incomplete"
    assert lifecycle.markers.summary["missing"] == 1


def test_lifecycle_reports_invalid_markers_stage() -> None:
    with temp_artifact_fixture() as artifacts:
        write_snapshot(artifacts)
        artifacts.write_invalid_success_marker(
            dataset_id="gfs",
            cycle=CYCLE,
            artifact_id="tmp_surface",
            frame_id="000",
            run_id=DEFAULT_RUN_ID,
        )

        lifecycle = _inspect(artifacts)

    assert lifecycle.stage == "invalid_markers"
    assert lifecycle.markers.summary["invalid_sample"] == ["tmp_surface/000"]


def test_lifecycle_reports_ready_for_validation_stage() -> None:
    with temp_artifact_fixture() as artifacts:
        write_snapshot(artifacts)
        artifacts.write_success_marker(cycle=CYCLE, artifact_id="tmp_surface", frame_id="000")

        lifecycle = _inspect(artifacts)

    assert lifecycle.stage == "ready_for_validation"
    assert lifecycle.publication_ready is False


def test_lifecycle_reports_validation_failed_stage() -> None:
    with temp_artifact_fixture() as artifacts:
        write_snapshot(artifacts)
        artifacts.write_success_marker(cycle=CYCLE, artifact_id="tmp_surface", frame_id="000")
        write_validation(artifacts, status="failed")

        lifecycle = _inspect(artifacts)

    assert lifecycle.stage == "validation_failed"
    assert lifecycle.validation.summary["status"] == "failed"


def test_lifecycle_reports_ready_for_publish_stage() -> None:
    with temp_artifact_fixture() as artifacts:
        write_snapshot(artifacts)
        artifacts.write_success_marker(cycle=CYCLE, artifact_id="tmp_surface", frame_id="000")
        write_validation(artifacts)

        lifecycle = _inspect(artifacts)

    assert lifecycle.stage == "ready_for_publish"
    assert lifecycle.publication_ready is True


def test_lifecycle_reports_published_stage() -> None:
    with temp_artifact_fixture() as artifacts:
        _write_published_run(artifacts)

        lifecycle = _inspect(artifacts)

    assert lifecycle.stage == "published"
    assert lifecycle.state == "complete"
    assert lifecycle.published_manifests.summary == {"current": "matches", "latest": "matches"}


def test_lifecycle_reports_published_with_manifest_drift_stage() -> None:
    with temp_artifact_fixture() as artifacts:
        _write_published_run(artifacts)
        artifacts.store.write_bytes(
            uri=artifacts.paths.latest_manifest_uri(dataset_id="gfs"),
            data=b"{not-json",
        )

        lifecycle = _inspect(artifacts)

    assert lifecycle.stage == "published_with_manifest_drift"
    assert lifecycle.published_manifests.summary["latest"] == "invalid"
    assert "latest manifest status for this run is invalid" in lifecycle.diagnostics


def test_lifecycle_treats_missing_latest_or_current_alias_as_manifest_drift() -> None:
    with temp_artifact_fixture() as artifacts:
        _write_published_run(artifacts)
        artifacts.store.delete_uri(uri=artifacts.paths.latest_manifest_uri(dataset_id="gfs"))

        lifecycle = _inspect(artifacts)

    assert lifecycle.stage == "published_with_manifest_drift"
    assert lifecycle.published_manifests.summary["latest"] == "missing"
    assert "latest manifest status for this run is missing" in lifecycle.diagnostics


def _inspect(artifacts, *, run_id: str = DEFAULT_RUN_ID):
    return inspect_run_lifecycle(
        artifact_repo=artifacts.repository,
        store=artifacts.store,
        dataset_id="gfs",
        cycle=CYCLE,
        run_id=run_id,
    )


def _write_published_run(artifacts) -> None:
    write_snapshot(artifacts)
    artifacts.write_success_marker(cycle=CYCLE, artifact_id="tmp_surface", frame_id="000")
    write_validation(artifacts)
    public_uri = write_public_latest_current_manifests(artifacts)
    artifacts.repository.write_run_manifest(
        dataset_id="gfs",
        cycle=CYCLE,
        run_id=DEFAULT_RUN_ID,
        manifest=parse_cycle_manifest(run_manifest(DEFAULT_RUN_ID)),
    )
    artifacts.write_publication(
        cycle=CYCLE,
        run_id=DEFAULT_RUN_ID,
        generated_at=datetime(2026, 5, 11, 7, tzinfo=timezone.utc),
        manifest_path=artifacts.paths.relative_key(public_uri),
    )
