from __future__ import annotations

import unittest

from forecast_etl.artifacts.published_schema import parse_published_marker, published_marker_dict


class PublishedMarkerTest(unittest.TestCase):
    def test_published_marker_dict_preserves_wire_shape(self) -> None:
        marker = published_marker_dict(
            cycle="2026051106",
            model="icon",
            generated_at="2026-05-11T14:05:00+00:00",
            revision="abc123",
            manifest_uri="s3://artifacts/manifests/icon/2026051106.json",
        )

        self.assertEqual(
            marker,
            {
                "cycle": "2026051106",
                "generated_at": "2026-05-11T14:05:00+00:00",
                "manifest_uri": "s3://artifacts/manifests/icon/2026051106.json",
                "model": "icon",
                "revision": "abc123",
            },
        )

    def test_parse_published_marker_validates_required_fields(self) -> None:
        marker = parse_published_marker(
            {
                "cycle": "2026051106",
                "model": "icon",
                "generated_at": "2026-05-11T14:05:00+00:00",
                "revision": "abc123",
                "manifest_uri": "s3://artifacts/manifests/icon/2026051106.json",
            },
            uri="s3://artifacts/status/icon/2026051106/_PUBLISHED.json",
        )

        self.assertEqual(marker.cycle, "2026051106")
        self.assertEqual(marker.model, "icon")
        self.assertEqual(marker.revision, "abc123")

    def test_parse_published_marker_rejects_missing_revision(self) -> None:
        with self.assertRaises(SystemExit):
            parse_published_marker(
                {
                    "cycle": "2026051106",
                    "model": "icon",
                    "generated_at": "2026-05-11T14:05:00+00:00",
                    "manifest_uri": "s3://artifacts/manifests/icon/2026051106.json",
                },
                uri="s3://artifacts/status/icon/2026051106/_PUBLISHED.json",
            )

    def test_parse_published_marker_rejects_invalid_cycle(self) -> None:
        with self.assertRaises(SystemExit):
            parse_published_marker(
                {
                    "cycle": "20260511",
                    "model": "icon",
                    "generated_at": "2026-05-11T14:05:00+00:00",
                    "revision": "abc123",
                    "manifest_uri": "s3://artifacts/manifests/icon/2026051106.json",
                }
            )


if __name__ == "__main__":
    unittest.main()
