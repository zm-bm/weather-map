from __future__ import annotations

import unittest
from datetime import datetime, timezone

from forecast_etl.manifest.inspect import (
    list_manifest_infos,
    manifest_cycle_from_key,
    manifest_info_from_obj,
    read_latest_manifest_info,
)
from forecast_etl.tests.fixtures.artifacts import temp_artifact_fixture


class ManifestInspectTest(unittest.TestCase):
    def test_manifest_cycle_from_key_accepts_cycle_manifest(self) -> None:
        self.assertEqual(
            manifest_cycle_from_key(model_id="gfs", key="manifests/gfs/2026051106.json"),
            "2026051106",
        )

    def test_manifest_cycle_from_key_rejects_latest_and_non_matching_keys(self) -> None:
        self.assertIsNone(manifest_cycle_from_key(model_id="gfs", key="manifests/gfs/latest.json"))
        self.assertIsNone(manifest_cycle_from_key(model_id="gfs", key="manifests/icon/2026051106.json"))
        self.assertIsNone(manifest_cycle_from_key(model_id="gfs", key="manifests/gfs/not-a-cycle.json"))

    def test_manifest_info_from_obj_extracts_tolerant_run_projection(self) -> None:
        info = manifest_info_from_obj(
            {
                "run": {
                    "cycle": "2026051106",
                    "generatedAt": "2026-05-11T14:05:00Z",
                    "revision": "abc123",
                },
                "products": {"malformed": object()},
            }
        )

        self.assertIsNotNone(info)
        assert info is not None
        self.assertEqual(info.cycle, "2026051106")
        self.assertIsNotNone(info.generated_at)
        assert info.generated_at is not None
        self.assertEqual(info.generated_at.isoformat(), "2026-05-11T14:05:00+00:00")
        self.assertEqual(info.revision, "abc123")

    def test_manifest_info_from_obj_uses_fallback_cycle(self) -> None:
        info = manifest_info_from_obj(
            {"run": {"generatedAt": "not-a-date", "revision": "abc123"}},
            fallback_cycle="2026051106",
        )

        self.assertIsNotNone(info)
        assert info is not None
        self.assertEqual(info.cycle, "2026051106")
        self.assertIsNone(info.generated_at)
        self.assertEqual(info.revision, "abc123")

    def test_manifest_info_from_obj_returns_none_without_valid_cycle(self) -> None:
        self.assertIsNone(manifest_info_from_obj({"run": {"cycle": "20260511"}}))
        self.assertIsNone(manifest_info_from_obj({"products": {}}))

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


if __name__ == "__main__":
    unittest.main()
