from __future__ import annotations

import unittest

from forecast_etl.artifacts.published_schema import parse_published_marker, published_marker_dict
from forecast_etl.tests.fixtures.artifacts import DEFAULT_RUN_ID


class PublishedMarkerTest(unittest.TestCase):
    def test_published_marker_dict_preserves_wire_shape(self) -> None:
        marker = published_marker_dict(
            cycle="2026051106",
            dataset_id="icon",
            generated_at="2026-05-11T14:05:00+00:00",
            revision="abc123",
            manifest_uri=f"s3://artifacts/manifests/icon/cycles/2026051106/runs/{DEFAULT_RUN_ID}.json",
        )

        self.assertEqual(
            marker,
            {
                "cycle": "2026051106",
                "dataset_id": "icon",
                "generated_at": "2026-05-11T14:05:00+00:00",
                "manifest_uri": f"s3://artifacts/manifests/icon/cycles/2026051106/runs/{DEFAULT_RUN_ID}.json",
                "revision": "abc123",
            },
        )

    def test_parse_published_marker_validates_required_fields(self) -> None:
        marker = parse_published_marker(
            {
                "cycle": "2026051106",
                "dataset_id": "icon",
                "generated_at": "2026-05-11T14:05:00+00:00",
                "revision": "abc123",
                "manifest_uri": f"s3://artifacts/manifests/icon/cycles/2026051106/runs/{DEFAULT_RUN_ID}.json",
            },
            uri=f"s3://artifacts/runs/icon/2026051106/{DEFAULT_RUN_ID}/_PUBLISHED.json",
        )

        self.assertEqual(marker.cycle, "2026051106")
        self.assertEqual(marker.dataset_id, "icon")
        self.assertEqual(marker.revision, "abc123")

    def test_parse_published_marker_rejects_missing_revision(self) -> None:
        with self.assertRaises(SystemExit):
            parse_published_marker(
                {
                    "cycle": "2026051106",
                    "dataset_id": "icon",
                    "generated_at": "2026-05-11T14:05:00+00:00",
                    "manifest_uri": f"s3://artifacts/manifests/icon/cycles/2026051106/runs/{DEFAULT_RUN_ID}.json",
                },
                uri=f"s3://artifacts/runs/icon/2026051106/{DEFAULT_RUN_ID}/_PUBLISHED.json",
            )

    def test_parse_published_marker_rejects_invalid_cycle(self) -> None:
        with self.assertRaises(SystemExit):
            parse_published_marker(
                {
                    "cycle": "20260511",
                    "dataset_id": "icon",
                    "generated_at": "2026-05-11T14:05:00+00:00",
                    "revision": "abc123",
                    "manifest_uri": f"s3://artifacts/manifests/icon/cycles/2026051106/runs/{DEFAULT_RUN_ID}.json",
                }
            )


if __name__ == "__main__":
    unittest.main()
