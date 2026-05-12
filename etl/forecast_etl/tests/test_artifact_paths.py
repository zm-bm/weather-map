from __future__ import annotations

import unittest

from forecast_etl.artifacts.paths import ArtifactPaths, WorkItem


class ArtifactPathContractTest(unittest.TestCase):
    def test_field_payload_uri_uses_shared_weather_payload_layout(self) -> None:
        paths = ArtifactPaths("file:///tmp/weather-map-artifacts")
        item = WorkItem(
            model_id="gfs",
            cycle="2026041200",
            fhour="003",
            product_id="wind10m_uv",
            source_uri="file:///dev/null",
        )

        uri = paths.output_field_payload_uri(item, dtype="int8")

        self.assertEqual(
            uri,
            "file:///tmp/weather-map-artifacts/fields/gfs/2026041200/003/wind10m_uv.field.i8.bin",
        )


if __name__ == "__main__":
    unittest.main()
