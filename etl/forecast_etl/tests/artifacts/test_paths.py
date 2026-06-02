from __future__ import annotations

import unittest

from forecast_etl.artifacts.paths import ArtifactPaths, WorkItem
from forecast_etl.tests.fixtures.artifacts import DEFAULT_RUN_ID


class ArtifactPathContractTest(unittest.TestCase):
    def test_field_payload_uri_uses_shared_weather_payload_layout(self) -> None:
        paths = ArtifactPaths("file:///tmp/weather-map-artifacts")
        item = WorkItem(
            dataset_id="gfs",
            cycle="2026041200",
            run_id=DEFAULT_RUN_ID,
            frame_id="003",
            artifact_id="wind10m_uv",
            source_uri="file:///dev/null",
        )

        uri = paths.output_field_payload_uri(item, dtype="int8")

        self.assertEqual(
            uri,
            "file:///tmp/weather-map-artifacts/"
            f"runs/gfs/2026041200/{DEFAULT_RUN_ID}/fields/003/wind10m_uv.field.i8.bin",
        )

    def test_validation_report_uri_is_run_scoped(self) -> None:
        paths = ArtifactPaths("file:///tmp/weather-map-artifacts")

        uri = paths.validation_report_uri(dataset_id="gfs", cycle="2026041200", run_id=DEFAULT_RUN_ID)

        self.assertEqual(
            uri,
            "file:///tmp/weather-map-artifacts/"
            f"runs/gfs/2026041200/{DEFAULT_RUN_ID}/validation.json",
        )

    def test_public_manifest_pointer_paths(self) -> None:
        paths = ArtifactPaths("file:///tmp/weather-map-artifacts")

        self.assertEqual(
            paths.public_run_manifest_key(dataset_id="gfs", cycle="2026041200", run_id=DEFAULT_RUN_ID),
            f"manifests/gfs/cycles/2026041200/runs/{DEFAULT_RUN_ID}.json",
        )
        self.assertEqual(
            paths.public_run_manifest_uri(dataset_id="gfs", cycle="2026041200", run_id=DEFAULT_RUN_ID),
            "file:///tmp/weather-map-artifacts/"
            f"manifests/gfs/cycles/2026041200/runs/{DEFAULT_RUN_ID}.json",
        )
        self.assertEqual(
            paths.cycle_current_pointer_uri(dataset_id="gfs", cycle="2026041200"),
            "file:///tmp/weather-map-artifacts/manifests/gfs/cycles/2026041200/current.json",
        )


if __name__ == "__main__":
    unittest.main()
