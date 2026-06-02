from __future__ import annotations

import json
import unittest
from datetime import datetime, timezone
from typing import Any

from forecast_etl.inspection.pointers import pointers_report
from forecast_etl.inspection.runs import runs_report, status_report
from forecast_etl.manifest.pointers import CURRENT_POINTER_SCHEMA, LATEST_POINTER_SCHEMA, manifest_pointer_dict
from forecast_etl.run_metadata import RunMetadata, RunSnapshot, json_document_digest
from forecast_etl.run_validation import PAYLOAD_CHECK_MODE, VALIDATION_SCHEMA, VALIDATION_SCHEMA_VERSION
from forecast_etl.tests.fixtures.artifacts import (
    DEFAULT_CODE_REVISION,
    DEFAULT_IMAGE_IDENTITY,
    DEFAULT_RUN_ID,
    manifest_payload,
    temp_artifact_fixture,
)
from forecast_etl.tests.fixtures.pipeline import minimal_pipeline_config

CYCLE = "2026051106"
NEWER_RUN_ID = "20260511T010000Z-00000000"
GENERATED_AT = "2026-05-11T07:00:00+00:00"


class OperatorStatusTest(unittest.TestCase):
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

        self.assertEqual(runs["schema"], "weather-map.etl-operator-runs")
        self.assertEqual(runs["run_count"], 0)
        self.assertEqual(runs["runs"], [])
        self.assertEqual(status["state"], "not_found")
        self.assertIsNone(status["run"])

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

        self.assertEqual([run["run_id"] for run in report["runs"]], [NEWER_RUN_ID, DEFAULT_RUN_ID])

    def test_complete_run_reports_validation_published_and_pointer_state(self) -> None:
        with temp_artifact_fixture() as artifacts:
            _write_snapshot(artifacts)
            artifacts.write_success_marker(cycle=CYCLE, artifact_id="tmp_surface", frame_id="000")
            _write_validation(artifacts)
            public_uri = _write_public_manifest_and_pointers(artifacts)
            artifacts.repository.write_run_manifest(
                dataset_id="gfs",
                cycle=CYCLE,
                run_id=DEFAULT_RUN_ID,
                manifest=_run_manifest(DEFAULT_RUN_ID),
            )
            artifacts.write_published_marker(
                cycle=CYCLE,
                run_id=DEFAULT_RUN_ID,
                generated_at=datetime(2026, 5, 11, 7, tzinfo=timezone.utc),
                manifest_uri=public_uri,
            )

            report = status_report(
                artifact_repo=artifacts.repository,
                store=artifacts.store,
                dataset_id="gfs",
                cycle=CYCLE,
            )

        run = report["run"]
        self.assertEqual(report["state"], "complete")
        self.assertEqual(run["markers"]["expected"], 1)
        self.assertEqual(run["markers"]["completed"], 1)
        self.assertTrue(run["complete"])
        self.assertEqual(run["validation"]["status"], "passed")
        self.assertEqual(run["published"]["status"], "present")
        self.assertTrue(run["manifests"]["internal_run_manifest_exists"])
        self.assertTrue(run["manifests"]["public_run_manifest_exists"])
        self.assertEqual(run["pointers"]["cycle_current"], "matches")
        self.assertEqual(run["pointers"]["dataset_latest"], "matches")
        self.assertTrue(run["publication_ready"])

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
        self.assertEqual(report["state"], "incomplete")
        self.assertEqual(run["markers"]["expected"], 2)
        self.assertEqual(run["markers"]["completed"], 1)
        self.assertEqual(run["markers"]["missing"], 1)
        self.assertEqual(run["markers"]["missing_sample"], ["tmp_surface/001"])
        self.assertFalse(run["publication_ready"])

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
        self.assertEqual(by_run[DEFAULT_RUN_ID]["state"], "missing_snapshot")
        self.assertEqual(by_run[DEFAULT_RUN_ID]["markers"]["completed"], 1)
        self.assertEqual(by_run[invalid_run_id]["state"], "invalid_snapshot")
        self.assertIn("error", by_run[invalid_run_id]["snapshot"])

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

        self.assertEqual(report["run_id"], NEWER_RUN_ID)
        self.assertTrue(report["ambiguous"])
        self.assertIn("publishing requires an explicit run id", report["warnings"][0])

    def test_pointer_report_handles_valid_latest_and_current(self) -> None:
        with temp_artifact_fixture() as artifacts:
            _write_public_manifest_and_pointers(artifacts)

            report = pointers_report(artifact_repo=artifacts.repository, dataset_id="gfs")

        self.assertEqual(report["latest"]["status"], "valid")
        self.assertEqual(report["current"]["status"], "valid")
        self.assertEqual(report["cycle"], CYCLE)
        self.assertEqual(report["latest"]["run_id"], DEFAULT_RUN_ID)

    def test_pointer_report_handles_missing_target_mismatch_and_malformed_aliases(self) -> None:
        with temp_artifact_fixture() as artifacts:
            missing_pointer = manifest_pointer_dict(
                schema_name=LATEST_POINTER_SCHEMA,
                dataset_id="gfs",
                cycle=CYCLE,
                run_id=DEFAULT_RUN_ID,
                revision="missing",
                generated_at=GENERATED_AT,
                manifest_path=f"manifests/gfs/cycles/{CYCLE}/runs/{DEFAULT_RUN_ID}.json",
            )
            artifacts.repository.write_latest_pointer(dataset_id="gfs", pointer=missing_pointer)
            missing = pointers_report(artifact_repo=artifacts.repository, dataset_id="gfs")

            public_uri = artifacts.repository.write_public_run_manifest(
                dataset_id="gfs",
                cycle=CYCLE,
                run_id=DEFAULT_RUN_ID,
                manifest=_run_manifest(DEFAULT_RUN_ID, revision="target"),
            )
            stale_pointer = manifest_pointer_dict(
                schema_name=LATEST_POINTER_SCHEMA,
                dataset_id="gfs",
                cycle=CYCLE,
                run_id=DEFAULT_RUN_ID,
                revision="pointer",
                generated_at=GENERATED_AT,
                manifest_path=artifacts.paths.relative_key(public_uri),
            )
            artifacts.repository.write_latest_pointer(dataset_id="gfs", pointer=stale_pointer)
            mismatch = pointers_report(artifact_repo=artifacts.repository, dataset_id="gfs")

            artifacts.store.write_bytes(
                uri=artifacts.paths.manifest_latest_uri(dataset_id="gfs"),
                data=json.dumps({"schema": LATEST_POINTER_SCHEMA}).encode("utf-8"),
            )
            malformed = pointers_report(artifact_repo=artifacts.repository, dataset_id="gfs")

            artifacts.store.write_bytes(
                uri=artifacts.paths.manifest_latest_uri(dataset_id="gfs"),
                data=json.dumps(
                    manifest_payload(
                        cycle=CYCLE,
                        generated_at=datetime(2026, 5, 11, 7, tzinfo=timezone.utc),
                        revision="full-manifest",
                    ),
                    sort_keys=True,
                ).encode("utf-8"),
            )
            full_manifest_alias = pointers_report(artifact_repo=artifacts.repository, dataset_id="gfs")

        self.assertEqual(missing["latest"]["status"], "target_missing")
        self.assertEqual(mismatch["latest"]["status"], "target_mismatch")
        self.assertEqual(malformed["latest"]["status"], "malformed")
        self.assertEqual(full_manifest_alias["latest"]["status"], "malformed")
        self.assertEqual(full_manifest_alias["latest"]["kind"], "unknown")


def _write_snapshot(
    artifacts,
    *,
    run_id: str = DEFAULT_RUN_ID,
    pipeline_config: dict[str, Any] | None = None,
) -> None:
    cfg = pipeline_config or minimal_pipeline_config()
    artifacts.repository.ensure_run_snapshot(
        dataset_id="gfs",
        cycle=CYCLE,
        run_id=run_id,
        snapshot=RunSnapshot(
            metadata=RunMetadata(
                code_revision=DEFAULT_CODE_REVISION,
                image_identity=DEFAULT_IMAGE_IDENTITY,
                config_digest=json_document_digest(cfg),
            ),
            pipeline_config=cfg,
            forecast_catalog={"catalogVersion": "test", "rasterLayers": []},
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
            "config_digest": "sha256:" + "0" * 64,
            "expected": {"frames": ["000"], "artifacts": ["tmp_surface"], "marker_count": 1},
            "observed": {"expected_markers": 1, "unexpected_markers": 0, "total_markers": 1},
            "errors": [] if status == "passed" else ["failed"],
            "warnings": [],
        },
    )


def _write_public_manifest_and_pointers(artifacts, *, run_id: str = DEFAULT_RUN_ID) -> str:
    public_uri = artifacts.repository.write_public_run_manifest(
        dataset_id="gfs",
        cycle=CYCLE,
        run_id=run_id,
        manifest=_run_manifest(run_id),
    )
    for schema_name, writer in (
        (LATEST_POINTER_SCHEMA, artifacts.repository.write_latest_pointer),
        (CURRENT_POINTER_SCHEMA, artifacts.repository.write_cycle_current_pointer),
    ):
        kwargs = {"dataset_id": "gfs"}
        if schema_name == CURRENT_POINTER_SCHEMA:
            kwargs["cycle"] = CYCLE
        writer(
            **kwargs,
            pointer=manifest_pointer_dict(
                schema_name=schema_name,
                dataset_id="gfs",
                cycle=CYCLE,
                run_id=run_id,
                revision="abc123",
                generated_at=GENERATED_AT,
                manifest_path=artifacts.paths.relative_key(public_uri),
            ),
        )
    return public_uri


def _run_manifest(run_id: str, *, revision: str = "abc123") -> dict[str, Any]:
    return {
        "run": {
            "cycle": CYCLE,
            "run_id": run_id,
            "payload_root": f"runs/gfs/{CYCLE}/{run_id}/fields",
            "generated_at": GENERATED_AT,
            "revision": revision,
        },
        "frames": [],
        "artifacts": {},
    }


if __name__ == "__main__":
    unittest.main()
