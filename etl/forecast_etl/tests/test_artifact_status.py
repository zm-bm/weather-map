from __future__ import annotations

import unittest
from datetime import datetime, timezone

from forecast_etl.artifacts.status import (
    read_cycle_progress,
    success_marker_id_from_key,
    summarize_cycle_progress,
)
from forecast_etl.config.parse import parse_pipeline_config
from forecast_etl.stores.base import UriObject
from forecast_etl.tests.fixtures.artifacts import (
    invalid_success_marker_payload,
    success_marker_payload_from_uri,
    temp_artifact_fixture,
)
from forecast_etl.tests.fixtures.pipeline import minimal_pipeline_config


class CycleStatusTest(unittest.TestCase):
    def test_success_marker_id_from_key_accepts_valid_marker(self) -> None:
        marker_id = success_marker_id_from_key(
            model_id="gfs",
            cycle="2026051106",
            key="status/gfs/2026051106/tmp_surface/003._SUCCESS.json",
        )

        self.assertEqual(marker_id, "tmp_surface/003")

    def test_success_marker_id_from_key_rejects_non_matching_keys(self) -> None:
        self.assertIsNone(
            success_marker_id_from_key(
                model_id="gfs",
                cycle="2026051106",
                key="status/icon/2026051106/tmp_surface/003._SUCCESS.json",
            )
        )
        self.assertIsNone(
            success_marker_id_from_key(
                model_id="gfs",
                cycle="2026051106",
                key="status/gfs/2026051106/tmp_surface/003.json",
            )
        )
        self.assertIsNone(
            success_marker_id_from_key(
                model_id="gfs",
                cycle="2026051106",
                key="status/gfs/2026051106/_PUBLISHED.json",
            )
        )

    def test_summarize_cycle_progress_reports_complete_published_cycle(self) -> None:
        modified = datetime(2026, 5, 11, 14, 0, tzinfo=timezone.utc)
        objects = [
            _obj("status/gfs/2026051106/tmp/000._SUCCESS.json", modified),
            _obj("status/gfs/2026051106/tmp/003._SUCCESS.json", modified),
            _obj("status/gfs/2026051106/_PUBLISHED.json", modified),
        ]

        progress = summarize_cycle_progress(
            artifact_root_uri="file:///artifacts",
            model_id="gfs",
            cycle="2026051106",
            product_ids=("tmp",),
            fhours=("000", "003"),
            objects=objects,
            read_json=success_marker_payload_from_uri,
            manifest_present=True,
        )

        self.assertTrue(progress.complete)
        self.assertTrue(progress.published)
        self.assertTrue(progress.manifest_present)
        self.assertEqual(progress.expected_markers, 2)
        self.assertEqual(progress.found_markers, 2)
        self.assertEqual(progress.missing_markers, 0)
        self.assertEqual(progress.last_progress_at, modified)

    def test_summarize_cycle_progress_reports_missing_markers(self) -> None:
        objects = [_obj("status/gfs/2026051106/tmp/000._SUCCESS.json", None)]

        progress = summarize_cycle_progress(
            artifact_root_uri="file:///artifacts",
            model_id="gfs",
            cycle="2026051106",
            product_ids=("tmp", "rh"),
            fhours=("000", "003"),
            objects=objects,
            read_json=success_marker_payload_from_uri,
            missing_sample_limit=2,
        )

        self.assertFalse(progress.complete)
        self.assertFalse(progress.published)
        self.assertEqual(progress.expected_markers, 4)
        self.assertEqual(progress.found_markers, 1)
        self.assertEqual(progress.missing_markers, 3)
        self.assertEqual(progress.missing_sample, ("rh/000", "rh/003"))

    def test_summarize_cycle_progress_reports_invalid_marker_sample(self) -> None:
        objects = [_obj("status/gfs/2026051106/tmp/000._SUCCESS.json", None)]

        progress = summarize_cycle_progress(
            artifact_root_uri="file:///artifacts",
            model_id="gfs",
            cycle="2026051106",
            product_ids=("tmp",),
            fhours=("000",),
            objects=objects,
            read_json=lambda uri: invalid_success_marker_payload(cycle="2026051106", fhour="000"),
        )

        self.assertFalse(progress.complete)
        self.assertEqual(progress.invalid_marker_sample, ("tmp/000",))

    def test_read_cycle_progress_uses_store_and_artifact_paths(self) -> None:
        with temp_artifact_fixture() as artifacts:
            model = parse_pipeline_config(minimal_pipeline_config()).model("gfs")
            cycle = "2026051106"
            artifacts.write_success_marker(
                model_id=model.id,
                cycle=cycle,
                product_id="tmp_surface",
                fhour="000",
            )
            artifacts.write_published_marker(
                model_id=model.id,
                cycle=cycle,
                generated_at=datetime(2026, 5, 11, 7, tzinfo=timezone.utc),
            )

            progress = read_cycle_progress(
                store=artifacts.store,
                paths=artifacts.paths,
                model=model,
                cycle=cycle,
                manifest_present=True,
            )

        self.assertTrue(progress.complete)
        self.assertTrue(progress.published)
        self.assertTrue(progress.manifest_present)


def _obj(key: str, modified: datetime | None) -> UriObject:
    return UriObject(uri=f"file:///artifacts/{key}", last_modified=modified)


if __name__ == "__main__":
    unittest.main()
