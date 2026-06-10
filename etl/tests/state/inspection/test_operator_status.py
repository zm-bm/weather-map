from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from weather_etl.config.pipeline import parse_pipeline_config
from weather_etl.config.product import product_config_document_digest
from weather_etl.state.inspection.runs import runs_report, status_report
from weather_etl.state.manifest.schema import parse_cycle_manifest
from weather_etl.state.runs.metadata import RunMetadata, RunSnapshot
from weather_etl.state.runs.validation import PAYLOAD_CHECK_MODE, VALIDATION_SCHEMA, VALIDATION_SCHEMA_VERSION

from tests.fixtures.artifacts import (
    DEFAULT_CODE_REVISION,
    DEFAULT_IMAGE_IDENTITY,
    DEFAULT_RUN_ID,
    temp_artifact_fixture,
)
from tests.fixtures.catalog import catalog_for_dataset
from tests.fixtures.pipeline import minimal_pipeline_config

CYCLE = "2026051106"
NEWER_RUN_ID = "20260511T010000Z-00000000"
GENERATED_AT = "2026-05-11T07:00:00+00:00"


class TestOperatorStatus:
    def test_no_runs_reports_empty_and_status_not_found(self) -> None:
        with temp_artifact_fixture() as artifacts:
            runs = runs_report(
                artifact_repo=artifacts.repository,
                store=artifacts.store,
                dataset_id="gfs",
                cycle=CYCLE,
            )
            status = status_report(
                artifact_repo=artifacts.repository,
                store=artifacts.store,
                dataset_id="gfs",
                cycle=CYCLE,
            )

        assert runs["schema"] == "weather-map.etl-operator-runs"
        assert runs["schema_version"] == 2
        assert runs["run_count"] == 0
        assert runs["runs"] == []
        assert status["state"] == "not_found"
        assert status["stage"] is None
        assert status["run"] is None

    def test_run_listing_is_newest_first(self) -> None:
        with temp_artifact_fixture() as artifacts:
            _write_snapshot(artifacts, run_id=DEFAULT_RUN_ID)
            _write_snapshot(artifacts, run_id=NEWER_RUN_ID)

            report = runs_report(
                artifact_repo=artifacts.repository,
                store=artifacts.store,
                dataset_id="gfs",
                cycle=CYCLE,
            )

        assert [run["run_id"] for run in report["runs"]] == [NEWER_RUN_ID, DEFAULT_RUN_ID]

    def test_complete_run_reports_validation_published_and_manifest_status(self) -> None:
        with temp_artifact_fixture() as artifacts:
            _write_snapshot(artifacts)
            artifacts.write_success_marker(cycle=CYCLE, artifact_id="tmp_surface", frame_id="000")
            _write_validation(artifacts)
            public_uri = _write_public_latest_current_manifests(artifacts)
            artifacts.repository.write_run_manifest(
                dataset_id="gfs",
                cycle=CYCLE,
                run_id=DEFAULT_RUN_ID,
                manifest=parse_cycle_manifest(_run_manifest(DEFAULT_RUN_ID)),
            )
            artifacts.write_publication(
                cycle=CYCLE,
                run_id=DEFAULT_RUN_ID,
                generated_at=datetime(2026, 5, 11, 7, tzinfo=timezone.utc),
                manifest_path=artifacts.paths.relative_key(public_uri),
            )

            report = status_report(
                artifact_repo=artifacts.repository,
                store=artifacts.store,
                dataset_id="gfs",
                cycle=CYCLE,
            )

        run = report["run"]
        assert report["state"] == "complete"
        assert report["stage"] == "published"
        assert run["stage"] == "published"
        assert run["markers"]["expected"] == 1
        assert run["markers"]["completed"] == 1
        assert run["complete"]
        assert run["validation"]["status"] == "passed"
        assert run["published"]["status"] == "present"
        assert run["manifests"]["internal_run_manifest_exists"]
        assert run["manifests"]["public_run_manifest_exists"]
        assert run["published_manifest_status"]["current"] == "matches"
        assert run["published_manifest_status"]["latest"] == "matches"
        assert run["publication_ready"]

    def test_incomplete_run_reports_missing_marker_sample(self) -> None:
        with temp_artifact_fixture() as artifacts:
            cfg = minimal_pipeline_config()
            cfg["datasets"]["gfs"]["workload"]["frame_end"] = 1
            _write_snapshot(artifacts, pipeline_config=cfg)
            artifacts.write_success_marker(cycle=CYCLE, artifact_id="tmp_surface", frame_id="000")

            report = status_report(
                artifact_repo=artifacts.repository,
                store=artifacts.store,
                dataset_id="gfs",
                cycle=CYCLE,
            )

        run = report["run"]
        assert report["state"] == "incomplete"
        assert report["stage"] == "pending_frames"
        assert run["stage"] == "pending_frames"
        assert run["markers"]["expected"] == 2
        assert run["markers"]["completed"] == 1
        assert run["markers"]["missing"] == 1
        assert run["markers"]["missing_sample"] == ["tmp_surface/001"]
        assert not run["publication_ready"]

    def test_missing_and_invalid_snapshots_are_reported_without_crashing(self) -> None:
        with temp_artifact_fixture() as artifacts:
            artifacts.write_success_marker(cycle=CYCLE, artifact_id="tmp_surface", frame_id="000", run_id=DEFAULT_RUN_ID)
            invalid_run_id = NEWER_RUN_ID
            artifacts.store.write_bytes(
                uri=artifacts.paths.run_metadata_uri(dataset_id="gfs", cycle=CYCLE, run_id=invalid_run_id),
                data=b"{not-json",
            )

            report = runs_report(
                artifact_repo=artifacts.repository,
                store=artifacts.store,
                dataset_id="gfs",
                cycle=CYCLE,
            )

        by_run = {run["run_id"]: run for run in report["runs"]}
        assert by_run[DEFAULT_RUN_ID]["state"] == "missing_snapshot"
        assert by_run[DEFAULT_RUN_ID]["stage"] == "missing_snapshot"
        assert by_run[DEFAULT_RUN_ID]["markers"]["completed"] == 1
        assert by_run[invalid_run_id]["state"] == "invalid_snapshot"
        assert by_run[invalid_run_id]["stage"] == "invalid_snapshot"
        assert "error" in by_run[invalid_run_id]["snapshot"]

    def test_status_exposes_ready_for_validation_stage(self) -> None:
        with temp_artifact_fixture() as artifacts:
            _write_snapshot(artifacts)
            artifacts.write_success_marker(cycle=CYCLE, artifact_id="tmp_surface", frame_id="000")

            report = status_report(
                artifact_repo=artifacts.repository,
                store=artifacts.store,
                dataset_id="gfs",
                cycle=CYCLE,
            )

        assert report["state"] == "complete"
        assert report["stage"] == "ready_for_validation"
        assert report["run"]["stage"] == "ready_for_validation"

    def test_status_exposes_ready_for_publish_stage(self) -> None:
        with temp_artifact_fixture() as artifacts:
            _write_snapshot(artifacts)
            artifacts.write_success_marker(cycle=CYCLE, artifact_id="tmp_surface", frame_id="000")
            _write_validation(artifacts)

            report = status_report(
                artifact_repo=artifacts.repository,
                store=artifacts.store,
                dataset_id="gfs",
                cycle=CYCLE,
            )

        assert report["state"] == "complete"
        assert report["stage"] == "ready_for_publish"
        assert report["run"]["stage"] == "ready_for_publish"

    def test_status_without_run_id_selects_newest_and_marks_ambiguity(self) -> None:
        with temp_artifact_fixture() as artifacts:
            _write_snapshot(artifacts, run_id=DEFAULT_RUN_ID)
            _write_snapshot(artifacts, run_id=NEWER_RUN_ID)

            report = status_report(
                artifact_repo=artifacts.repository,
                store=artifacts.store,
                dataset_id="gfs",
                cycle=CYCLE,
            )

        assert report["run_id"] == NEWER_RUN_ID
        assert report["ambiguous"]
        assert "publishing requires an explicit run id" in report["warnings"][0]

    def test_status_marks_malformed_existing_latest_manifest_as_drift(self) -> None:
        with temp_artifact_fixture() as artifacts:
            _write_snapshot(artifacts)
            artifacts.write_success_marker(cycle=CYCLE, artifact_id="tmp_surface", frame_id="000")
            _write_validation(artifacts)
            public_uri = _write_public_latest_current_manifests(artifacts)
            artifacts.repository.write_run_manifest(
                dataset_id="gfs",
                cycle=CYCLE,
                run_id=DEFAULT_RUN_ID,
                manifest=parse_cycle_manifest(_run_manifest(DEFAULT_RUN_ID)),
            )
            artifacts.write_publication(
                cycle=CYCLE,
                run_id=DEFAULT_RUN_ID,
                generated_at=datetime(2026, 5, 11, 7, tzinfo=timezone.utc),
                manifest_path=artifacts.paths.relative_key(public_uri),
            )
            artifacts.store.write_bytes(
                uri=artifacts.paths.latest_manifest_uri(dataset_id="gfs"),
                data=b"{not-json",
            )

            report = status_report(
                artifact_repo=artifacts.repository,
                store=artifacts.store,
                dataset_id="gfs",
                cycle=CYCLE,
            )

        run = report["run"]
        assert report["stage"] == "published_with_manifest_drift"
        assert run["stage"] == "published_with_manifest_drift"
        assert run["published_manifest_status"]["current"] == "matches"
        assert run["published_manifest_status"]["latest"] == "invalid"
        assert "latest manifest status for this run is invalid" in run["diagnostics"]


def _write_snapshot(
    artifacts,
    *,
    run_id: str = DEFAULT_RUN_ID,
    pipeline_config: dict[str, Any] | None = None,
) -> None:
    cfg = pipeline_config or minimal_pipeline_config()
    dataset = parse_pipeline_config(cfg).dataset("gfs")
    catalog = catalog_for_dataset(dataset)
    artifacts.repository.ensure_run_snapshot(
        dataset_id="gfs",
        cycle=CYCLE,
        run_id=run_id,
        snapshot=RunSnapshot(
            metadata=RunMetadata(
                code_revision=DEFAULT_CODE_REVISION,
                image_identity=DEFAULT_IMAGE_IDENTITY,
                product_config_digest=product_config_document_digest(pipeline=cfg, catalog=catalog),
            ),
            pipeline=cfg,
            catalog=catalog,
        ),
    )


def _write_validation(artifacts, *, run_id: str = DEFAULT_RUN_ID, status: str = "passed") -> None:
    artifacts.repository.write_validation_report(
        dataset_id="gfs",
        cycle=CYCLE,
        run_id=run_id,
        report={
            "schema": VALIDATION_SCHEMA,
            "schema_version": VALIDATION_SCHEMA_VERSION,
            "dataset": "gfs",
            "cycle": CYCLE,
            "run_id": run_id,
            "generated_at": GENERATED_AT,
            "status": status,
            "payload_check_mode": PAYLOAD_CHECK_MODE,
            "product_config_digest": "sha256:" + "0" * 64,
            "expected": {"frames": ["000"], "artifacts": ["tmp_surface"], "marker_count": 1},
            "observed": {"expected_markers": 1, "unexpected_markers": 0, "total_markers": 1},
            "errors": [] if status == "passed" else ["failed"],
            "warnings": [],
        },
    )


def _write_public_latest_current_manifests(artifacts, *, run_id: str = DEFAULT_RUN_ID) -> str:
    manifest = parse_cycle_manifest(_run_manifest(run_id))
    public_uri = artifacts.repository.write_public_run_manifest(
        dataset_id="gfs",
        cycle=CYCLE,
        run_id=run_id,
        manifest=manifest,
    )
    artifacts.repository.write_latest_manifest(dataset_id="gfs", manifest=manifest)
    artifacts.repository.write_cycle_current_manifest(dataset_id="gfs", cycle=CYCLE, manifest=manifest)
    return public_uri


def _run_manifest(run_id: str, *, revision: str = "abc123") -> dict[str, Any]:
    return {
        "schema": "weather-map.dataset-cycle-manifest",
        "schema_version": 7,
        "payload_contract": "field-binary-v2",
        "dataset": {"id": "gfs", "label": "GFS"},
        "run": {
            "cycle": CYCLE,
            "run_id": run_id,
            "payload_root": f"runs/gfs/{CYCLE}/{run_id}/payloads",
            "generated_at": GENERATED_AT,
            "revision": revision,
        },
        "frames": [{"id": "000", "lead_hours": 0, "valid_at": GENERATED_AT}],
        "artifacts": {
            "tmp_surface": {
                "id": "tmp_surface",
                "kind": "scalar",
                "units": "C",
                "parameter": "tmp",
                "level": "surface",
                "components": ["value"],
                "grid": {
                    "id": "gfs_0p25_global",
                    "crs": "EPSG:4326",
                    "nx": 1,
                    "ny": 1,
                    "lon0": 0,
                    "lat0": 0,
                    "dx": 1,
                    "dy": 1,
                    "origin": "cell_center",
                    "layout": "row_major",
                    "x_wrap": "repeat",
                    "y_mode": "clamp",
                },
                "encoding": {"id": "tmp_surface_i16_v1", "format": "linear-i16-v1", "dtype": "int16"},
                "payload_file": "tmp_surface.i16.bin",
                "frames": {
                    "000": {
                        "path": f"runs/gfs/{CYCLE}/{run_id}/payloads/000/tmp_surface.i16.bin",
                        "byte_length": 2,
                        "sha256": "a" * 64,
                    },
                },
            }
        },
    }
