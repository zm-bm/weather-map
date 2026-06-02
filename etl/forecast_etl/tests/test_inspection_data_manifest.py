from __future__ import annotations

import unittest

from forecast_etl.inspection.data_manifest import data_manifest_summary
from forecast_etl.manifest.data_manifest_contract import DATA_MANIFEST_SCHEMA, DATA_MANIFEST_SCHEMA_VERSION
from forecast_etl.tests.fixtures.artifacts import DEFAULT_RUN_ID, temp_artifact_fixture


class InspectionDataManifestTest(unittest.TestCase):
    def test_missing_data_manifest_reports_missing(self) -> None:
        with temp_artifact_fixture() as artifacts:
            summary = data_manifest_summary(artifact_repo=artifacts.repository)

        self.assertEqual(summary["schema"], "weather-map.data-manifest-summary")
        self.assertEqual(summary["status"], "missing")
        self.assertEqual(summary["path"], "manifests/data-manifest.json")

    def test_valid_data_manifest_reports_dataset_and_latest_summary(self) -> None:
        with temp_artifact_fixture() as artifacts:
            artifacts.repository.write_data_manifest(
                manifest={
                    "schema": DATA_MANIFEST_SCHEMA,
                    "schema_version": DATA_MANIFEST_SCHEMA_VERSION,
                    "generated_at": "2026-06-01T12:00:00Z",
                    "catalog_version": "test",
                    "payload_contract": "weather-map.data-binary/v1",
                    "datasets": {
                        "gfs": {
                            "label": "GFS",
                            "latest": {
                                "run": {
                                    "cycle": "2026060112",
                                    "run_id": DEFAULT_RUN_ID,
                                }
                            },
                        },
                        "icon": {
                            "label": "ICON",
                            "latest": None,
                        },
                    },
                    "layers": {"tmp_surface": {"datasets": {}}},
                }
            )

            summary = data_manifest_summary(artifact_repo=artifacts.repository)

        self.assertEqual(summary["status"], "valid")
        self.assertEqual(summary["dataset_count"], 2)
        self.assertEqual(summary["latest_dataset_count"], 1)
        self.assertEqual(summary["layer_count"], 1)
        self.assertEqual(summary["datasets"]["gfs"]["latest_run_id"], DEFAULT_RUN_ID)
        self.assertEqual(summary["datasets"]["icon"]["latest_present"], False)

    def test_malformed_data_manifest_reports_diagnostics(self) -> None:
        with temp_artifact_fixture() as artifacts:
            artifacts.store.write_bytes(uri=artifacts.paths.data_manifest_uri(), data=b"{not-json")

            summary = data_manifest_summary(artifact_repo=artifacts.repository)

        self.assertEqual(summary["status"], "malformed")
        self.assertIn("unable to read JSON", summary["diagnostics"][0])


if __name__ == "__main__":
    unittest.main()
