from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from typing import Any

from forecast_etl.artifacts.repository import ArtifactRepository
from forecast_etl.cleanup_candidates import cleanup_runs_report
from forecast_etl.manifest.pointers import CURRENT_POINTER_SCHEMA, LATEST_POINTER_SCHEMA, manifest_pointer_dict
from forecast_etl.run_metadata import RunMetadata, RunSnapshot, json_document_digest
from forecast_etl.run_validation import PAYLOAD_CHECK_MODE, VALIDATION_SCHEMA, VALIDATION_SCHEMA_VERSION
from forecast_etl.storage.base import UriObject
from forecast_etl.tests.fixtures.artifacts import (
    DEFAULT_CODE_REVISION,
    DEFAULT_IMAGE_IDENTITY,
    DEFAULT_RUN_ID,
    temp_artifact_fixture,
)
from forecast_etl.tests.fixtures.pipeline import minimal_pipeline_config

NOW = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
CYCLE = "2026060100"
OLDER_CYCLE = "2026053118"
RUN_CURRENT = "20260601T010000Z-00000001"
RUN_INCOMPLETE = "20260601T020000Z-00000002"
RUN_INVALID = "20260601T030000Z-00000003"
RUN_FAILED = "20260601T040000Z-00000004"
RUN_VALIDATED = "20260601T050000Z-00000005"
RUN_PUBLISHED = "20260601T060000Z-00000006"
RUN_FRESH = "20260601T070000Z-00000007"


class CleanupCandidatesTest(unittest.TestCase):
    def test_current_and_latest_runs_are_protected(self) -> None:
        with temp_artifact_fixture() as artifacts:
            _write_complete_run(artifacts, run_id=RUN_CURRENT)
            _write_public_manifest_and_pointers(artifacts, run_id=RUN_CURRENT)
            _age_run(artifacts, run_id=RUN_CURRENT, hours=1000)

            report = cleanup_runs_report(
                artifact_repo=artifacts.repository,
                store=artifacts.store,
                dataset_id="gfs",
                cycle=CYCLE,
                now=NOW,
            )

        run = report["runs"][0]
        self.assertFalse(run["candidate"])
        self.assertTrue(run["protected"])
        self.assertEqual(run["state"], "protected")
        self.assertIn("dataset latest", run["reason"])
        self.assertEqual(report["protected_count"], 1)

    def test_incomplete_and_invalid_snapshot_runs_older_than_one_day_are_candidates(self) -> None:
        with temp_artifact_fixture() as artifacts:
            _write_snapshot(artifacts, run_id=RUN_INCOMPLETE)
            _write_invalid_snapshot(artifacts, run_id=RUN_INVALID)
            _age_run(artifacts, run_id=RUN_INCOMPLETE, hours=25)
            _age_run(artifacts, run_id=RUN_INVALID, hours=25)

            report = cleanup_runs_report(
                artifact_repo=artifacts.repository,
                store=artifacts.store,
                dataset_id="gfs",
                cycle=CYCLE,
                now=NOW,
            )

        by_run = _by_run(report)
        self.assertTrue(by_run[RUN_INCOMPLETE]["candidate"])
        self.assertEqual(by_run[RUN_INCOMPLETE]["state"], "incomplete")
        self.assertTrue(by_run[RUN_INVALID]["candidate"])
        self.assertEqual(by_run[RUN_INVALID]["state"], "invalid_snapshot")
        self.assertEqual(report["candidate_count"], 2)

    def test_failed_validation_older_than_one_day_is_candidate(self) -> None:
        with temp_artifact_fixture() as artifacts:
            _write_complete_run(artifacts, run_id=RUN_FAILED, validation_status="failed")
            _age_run(artifacts, run_id=RUN_FAILED, hours=25)

            report = cleanup_runs_report(
                artifact_repo=artifacts.repository,
                store=artifacts.store,
                dataset_id="gfs",
                cycle=CYCLE,
                now=NOW,
            )

        run = report["runs"][0]
        self.assertTrue(run["candidate"])
        self.assertEqual(run["state"], "failed_validation")
        self.assertEqual(run["threshold_hours"], 24.0)

    def test_validation_passed_but_unpublished_older_than_three_days_is_candidate(self) -> None:
        with temp_artifact_fixture() as artifacts:
            _write_complete_run(artifacts, run_id=RUN_VALIDATED)
            _age_run(artifacts, run_id=RUN_VALIDATED, hours=73)

            report = cleanup_runs_report(
                artifact_repo=artifacts.repository,
                store=artifacts.store,
                dataset_id="gfs",
                cycle=CYCLE,
                now=NOW,
            )

        run = report["runs"][0]
        self.assertTrue(run["candidate"])
        self.assertEqual(run["state"], "validated_unpromoted")
        self.assertEqual(run["threshold_hours"], 72.0)

    def test_published_but_not_current_latest_older_than_fourteen_days_is_candidate(self) -> None:
        with temp_artifact_fixture() as artifacts:
            public_uri = _write_complete_run(artifacts, run_id=RUN_PUBLISHED)
            artifacts.write_published_marker(
                cycle=CYCLE,
                run_id=RUN_PUBLISHED,
                generated_at=NOW - timedelta(days=15),
                manifest_uri=public_uri,
            )
            _age_run(artifacts, run_id=RUN_PUBLISHED, hours=337)

            report = cleanup_runs_report(
                artifact_repo=artifacts.repository,
                store=artifacts.store,
                dataset_id="gfs",
                cycle=CYCLE,
                now=NOW,
            )

        run = report["runs"][0]
        self.assertTrue(run["candidate"])
        self.assertEqual(run["state"], "published_superseded")
        self.assertEqual(run["threshold_hours"], 336.0)

    def test_fresh_run_under_threshold_is_not_candidate(self) -> None:
        with temp_artifact_fixture() as artifacts:
            _write_snapshot(artifacts, run_id=RUN_FRESH)
            _age_run(artifacts, run_id=RUN_FRESH, hours=12)

            report = cleanup_runs_report(
                artifact_repo=artifacts.repository,
                store=artifacts.store,
                dataset_id="gfs",
                cycle=CYCLE,
                now=NOW,
            )

        run = report["runs"][0]
        self.assertFalse(run["candidate"])
        self.assertFalse(run["protected"])
        self.assertIn("not old enough", run["reason"])

    def test_cycle_filter_restricts_scanned_runs(self) -> None:
        with temp_artifact_fixture() as artifacts:
            _write_snapshot(artifacts, cycle=CYCLE, run_id=RUN_INCOMPLETE)
            _write_snapshot(artifacts, cycle=OLDER_CYCLE, run_id=RUN_FAILED)

            report = cleanup_runs_report(
                artifact_repo=artifacts.repository,
                store=artifacts.store,
                dataset_id="gfs",
                cycle=OLDER_CYCLE,
                now=NOW,
            )

        self.assertEqual([run["cycle"] for run in report["runs"]], [OLDER_CYCLE])
        self.assertEqual(report["cycle"], OLDER_CYCLE)

    def test_missing_object_sizes_do_not_break_totals(self) -> None:
        with temp_artifact_fixture() as artifacts:
            _write_snapshot(artifacts, run_id=RUN_INCOMPLETE)
            store = _MissingSizeStore(artifacts.store)
            repo = ArtifactRepository(store=store, paths=artifacts.paths)

            report = cleanup_runs_report(
                artifact_repo=repo,
                store=store,
                dataset_id="gfs",
                cycle=CYCLE,
                now=NOW,
            )

        run = report["runs"][0]
        self.assertGreater(run["object_count"], 0)
        self.assertEqual(run["unknown_size_count"], run["object_count"])
        self.assertEqual(run["total_bytes"], 0)

    def test_delete_candidates_removes_only_candidate_run_prefix_objects(self) -> None:
        with temp_artifact_fixture() as artifacts:
            _write_snapshot(artifacts, run_id=RUN_INCOMPLETE)
            _age_run(artifacts, run_id=RUN_INCOMPLETE, hours=25)
            _write_complete_run(artifacts, run_id=RUN_CURRENT)
            _write_public_manifest_and_pointers(artifacts, run_id=RUN_CURRENT)
            _age_run(artifacts, run_id=RUN_CURRENT, hours=1000)
            candidate_count = len(artifacts.repository.list_run_objects(dataset_id="gfs", cycle=CYCLE, run_id=RUN_INCOMPLETE))
            protected_count = len(artifacts.repository.list_run_objects(dataset_id="gfs", cycle=CYCLE, run_id=RUN_CURRENT))

            report = cleanup_runs_report(
                artifact_repo=artifacts.repository,
                store=artifacts.store,
                dataset_id="gfs",
                cycle=CYCLE,
                now=NOW,
                delete_candidates=True,
            )

            remaining_candidate = artifacts.repository.list_run_objects(dataset_id="gfs", cycle=CYCLE, run_id=RUN_INCOMPLETE)
            remaining_protected = artifacts.repository.list_run_objects(dataset_id="gfs", cycle=CYCLE, run_id=RUN_CURRENT)

        by_run = _by_run(report)
        self.assertTrue(by_run[RUN_INCOMPLETE]["deleted"])
        self.assertEqual(by_run[RUN_INCOMPLETE]["deleted_object_count"], candidate_count)
        self.assertEqual(report["deleted_object_count"], candidate_count)
        self.assertEqual(remaining_candidate, [])
        self.assertFalse(by_run[RUN_CURRENT]["deleted"])
        self.assertEqual(len(remaining_protected), protected_count)


class _MissingSizeStore:
    name = "missing-size"

    def __init__(self, delegate) -> None:
        self.delegate = delegate

    def __getattr__(self, name: str):
        return getattr(self.delegate, name)

    def read_bytes(self, *, uri: str):
        return self.delegate.read_bytes(uri=uri)

    def write_bytes(self, *, uri: str, data: bytes) -> None:
        return self.delegate.write_bytes(uri=uri, data=data)

    def delete_uri(self, *, uri: str) -> None:
        return self.delegate.delete_uri(uri=uri)

    def exists(self, *, uri: str):
        return self.delegate.exists(uri=uri)

    def list_prefix(self, *, prefix_uri: str):
        return self.delegate.list_prefix(prefix_uri=prefix_uri)

    def list_objects(self, *, prefix_uri: str):
        return [
            UriObject(uri=obj.uri, last_modified=obj.last_modified, size=None)
            for obj in self.delegate.list_objects(prefix_uri=prefix_uri)
        ]

    def get_to_file(self, *, uri: str, dst):
        return self.delegate.get_to_file(uri=uri, dst=dst)

    def put_file(self, *, uri: str, src):
        return self.delegate.put_file(uri=uri, src=src)


def _write_snapshot(
    artifacts,
    *,
    cycle: str = CYCLE,
    run_id: str = DEFAULT_RUN_ID,
    pipeline_config: dict[str, Any] | None = None,
) -> None:
    cfg = pipeline_config or minimal_pipeline_config()
    artifacts.repository.ensure_run_snapshot(
        dataset_id="gfs",
        cycle=cycle,
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


def _write_invalid_snapshot(artifacts, *, run_id: str) -> None:
    artifacts.store.write_bytes(
        uri=artifacts.paths.run_metadata_uri(dataset_id="gfs", cycle=CYCLE, run_id=run_id),
        data=b"{not-json",
    )


def _write_complete_run(artifacts, *, run_id: str, validation_status: str = "passed") -> str:
    _write_snapshot(artifacts, run_id=run_id)
    artifacts.write_success_marker(cycle=CYCLE, run_id=run_id, artifact_id="tmp_surface", frame_id="000")
    _write_validation(artifacts, run_id=run_id, status=validation_status)
    return artifacts.repository.write_public_run_manifest(
        dataset_id="gfs",
        cycle=CYCLE,
        run_id=run_id,
        manifest=_run_manifest(run_id),
    )


def _write_validation(artifacts, *, run_id: str, status: str) -> None:
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
            "generated_at": NOW.isoformat(),
            "status": status,
            "payload_check_mode": PAYLOAD_CHECK_MODE,
            "config_digest": "sha256:" + "0" * 64,
            "expected": {"frames": ["000"], "artifacts": ["tmp_surface"], "marker_count": 1},
            "observed": {"expected_markers": 1, "unexpected_markers": 0, "total_markers": 1},
            "errors": [] if status == "passed" else ["failed"],
            "warnings": [],
        },
    )


def _write_public_manifest_and_pointers(artifacts, *, run_id: str) -> None:
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
                generated_at=NOW.isoformat(),
                manifest_path=artifacts.paths.relative_key(public_uri),
            ),
        )


def _run_manifest(run_id: str) -> dict[str, Any]:
    return {
        "run": {
            "cycle": CYCLE,
            "run_id": run_id,
            "payload_root": f"runs/gfs/{CYCLE}/{run_id}/fields",
            "generated_at": NOW.isoformat(),
            "revision": "abc123",
        },
        "frames": [],
        "artifacts": {},
    }


def _age_run(artifacts, *, run_id: str, hours: float) -> None:
    modified = NOW - timedelta(hours=hours)
    for obj in artifacts.repository.list_run_objects(dataset_id="gfs", cycle=CYCLE, run_id=run_id):
        artifacts.touch(obj.uri, modified)


def _by_run(report: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {run["run_id"]: run for run in report["runs"]}


if __name__ == "__main__":
    unittest.main()
