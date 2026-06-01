from __future__ import annotations

import unittest
from datetime import datetime, timezone

from forecast_etl.manifest.inspect import (
    list_manifest_infos,
    manifest_cycle_from_key,
    manifest_info_from_obj,
    read_latest_manifest_info,
    read_latest_manifest_object,
)
from forecast_etl.manifest.pointers import CURRENT_POINTER_SCHEMA, LATEST_POINTER_SCHEMA, manifest_pointer_dict
from forecast_etl.tests.fixtures.artifacts import (
    DEFAULT_RUN_ID,
    manifest_payload,
    temp_artifact_fixture,
)


class ManifestInspectTest(unittest.TestCase):
    def test_manifest_cycle_from_key_accepts_current_pointer(self) -> None:
        self.assertEqual(
            manifest_cycle_from_key(
                model_id="gfs",
                key="manifests/gfs/cycles/2026051106/current.json",
            ),
            "2026051106",
        )

    def test_manifest_cycle_from_key_rejects_latest_and_non_matching_keys(self) -> None:
        self.assertIsNone(manifest_cycle_from_key(model_id="gfs", key="manifests/gfs/latest.json"))
        self.assertIsNone(manifest_cycle_from_key(model_id="gfs", key="manifests/gfs/2026051106.json"))
        self.assertIsNone(manifest_cycle_from_key(model_id="gfs", key="manifests/icon/2026051106.json"))
        self.assertIsNone(manifest_cycle_from_key(model_id="gfs", key="manifests/gfs/not-a-cycle.json"))
        self.assertIsNone(
            manifest_cycle_from_key(
                model_id="gfs",
                key=f"manifests/gfs/cycles/2026051106/runs/{DEFAULT_RUN_ID}.json",
            )
        )

    def test_manifest_info_from_obj_extracts_tolerant_run_projection(self) -> None:
        info = manifest_info_from_obj(
            {
                "run": {
                    "cycle": "2026051106",
                    "runId": DEFAULT_RUN_ID,
                    "generatedAt": "2026-05-11T14:05:00Z",
                    "revision": "abc123",
                },
                "artifacts": {"malformed": object()},
            }
        )

        self.assertIsNotNone(info)
        assert info is not None
        self.assertEqual(info.cycle, "2026051106")
        self.assertEqual(info.run_id, DEFAULT_RUN_ID)
        self.assertIsNotNone(info.generated_at)
        assert info.generated_at is not None
        self.assertEqual(info.generated_at.isoformat(), "2026-05-11T14:05:00+00:00")
        self.assertEqual(info.revision, "abc123")

    def test_manifest_info_from_obj_returns_none_without_valid_cycle(self) -> None:
        self.assertIsNone(manifest_info_from_obj({"run": {"cycle": "20260511"}}))
        self.assertIsNone(manifest_info_from_obj({"artifacts": {}}))

    def test_manifest_info_read_helpers_use_store_and_artifact_paths(self) -> None:
        with temp_artifact_fixture() as artifacts:
            for cycle in ("2026051100", "2026051106"):
                artifacts.write_manifest(
                    model_id="gfs",
                    cycle=cycle,
                    generated_at=datetime(2026, 5, 11, 7, tzinfo=timezone.utc),
                    revision=cycle,
                )

            infos = list_manifest_infos(store=artifacts.store, paths=artifacts.paths, model_id="gfs", limit=1)
            latest = read_latest_manifest_info(store=artifacts.store, paths=artifacts.paths, model_id="gfs")

        self.assertEqual([info.cycle for info in infos], ["2026051106"])
        self.assertIsNotNone(latest)
        assert latest is not None
        self.assertEqual(latest.cycle, "2026051106")

    def test_latest_pointer_info_and_object_are_dereferenced(self) -> None:
        generated_at = datetime(2026, 5, 11, 7, tzinfo=timezone.utc)
        with temp_artifact_fixture() as artifacts:
            manifest = manifest_payload(cycle="2026051106", generated_at=generated_at, revision="abc123")
            public_uri = artifacts.repository.write_public_run_manifest(
                model_id="gfs",
                cycle="2026051106",
                run_id=DEFAULT_RUN_ID,
                manifest=manifest,
            )
            artifacts.repository.write_latest_pointer(
                model_id="gfs",
                pointer=manifest_pointer_dict(
                    schema_name=LATEST_POINTER_SCHEMA,
                    model_id="gfs",
                    cycle="2026051106",
                    run_id=DEFAULT_RUN_ID,
                    revision="abc123",
                    generated_at="2026-05-11T07:00:00+00:00",
                    manifest_path=artifacts.paths.relative_key(public_uri),
                ),
            )
            artifacts.repository.write_cycle_current_pointer(
                model_id="gfs",
                cycle="2026051106",
                pointer=manifest_pointer_dict(
                    schema_name=CURRENT_POINTER_SCHEMA,
                    model_id="gfs",
                    cycle="2026051106",
                    run_id=DEFAULT_RUN_ID,
                    revision="abc123",
                    generated_at="2026-05-11T07:00:00+00:00",
                    manifest_path=artifacts.paths.relative_key(public_uri),
                ),
            )

            infos = list_manifest_infos(store=artifacts.store, paths=artifacts.paths, model_id="gfs", limit=1)
            latest = read_latest_manifest_info(store=artifacts.store, paths=artifacts.paths, model_id="gfs")
            latest_obj = read_latest_manifest_object(artifact_repo=artifacts.repository, model_id="gfs")

        self.assertEqual([info.cycle for info in infos], ["2026051106"])
        self.assertIsNotNone(latest)
        assert latest is not None
        self.assertEqual(latest.cycle, "2026051106")
        self.assertEqual(latest.run_id, DEFAULT_RUN_ID)
        self.assertEqual(latest_obj, manifest)

    def test_latest_manifest_info_rejects_wrong_pointer_schema(self) -> None:
        with temp_artifact_fixture() as artifacts:
            artifacts.repository.write_latest_pointer(
                model_id="gfs",
                pointer=manifest_pointer_dict(
                    schema_name=CURRENT_POINTER_SCHEMA,
                    model_id="gfs",
                    cycle="2026051106",
                    run_id=DEFAULT_RUN_ID,
                    revision="abc123",
                    generated_at="2026-05-11T07:00:00+00:00",
                    manifest_path=f"manifests/gfs/cycles/2026051106/runs/{DEFAULT_RUN_ID}.json",
                ),
            )

            latest = read_latest_manifest_info(store=artifacts.store, paths=artifacts.paths, model_id="gfs")

        self.assertIsNone(latest)


if __name__ == "__main__":
    unittest.main()
