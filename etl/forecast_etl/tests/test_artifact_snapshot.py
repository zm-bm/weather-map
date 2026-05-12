from __future__ import annotations

import unittest
from datetime import datetime, timezone

from forecast_etl.artifacts.snapshot import (
    PublishLagPolicy,
    estimate_publish_lag,
    read_model_artifact_snapshot,
    select_target_cycle,
)
from forecast_etl.config.parse import parse_pipeline_config
from forecast_etl.manifest.inspect import ManifestInfo
from forecast_etl.tests.fixtures.artifacts import temp_artifact_fixture
from forecast_etl.tests.fixtures.pipeline import minimal_pipeline_config

NOW = datetime(2026, 5, 11, 18, 30, tzinfo=timezone.utc)


class ArtifactSnapshotTest(unittest.TestCase):
    def test_estimate_publish_lag_uses_recent_manifest_history(self) -> None:
        estimate = estimate_publish_lag(
            manifest_infos=(
                ManifestInfo(cycle="2026051106", generated_at=datetime(2026, 5, 11, 8, tzinfo=timezone.utc)),
                ManifestInfo(cycle="2026051112", generated_at=datetime(2026, 5, 11, 13, tzinfo=timezone.utc)),
            ),
            policy=_policy(),
        )

        self.assertEqual(estimate.source, "recent-history")
        self.assertEqual(estimate.hours, 3)

    def test_estimate_publish_lag_falls_back_without_history(self) -> None:
        estimate = estimate_publish_lag(manifest_infos=(), policy=_policy())

        self.assertEqual(estimate.source, "fallback")
        self.assertEqual(estimate.hours, 9)

    def test_select_target_cycle_prefers_newer_observed_cycle(self) -> None:
        self.assertEqual(
            select_target_cycle(
                expected_cycle="2026051112",
                latest_observed_cycle="2026051118",
                latest_published_cycle="2026051106",
            ),
            "2026051118",
        )

    def test_read_model_artifact_snapshot_reads_complete_cycle(self) -> None:
        with temp_artifact_fixture() as artifacts:
            model = parse_pipeline_config(minimal_pipeline_config()).model("gfs")
            cycle = "2026051112"
            generated_at = datetime(2026, 5, 11, 13, tzinfo=timezone.utc)
            manifest_uri = artifacts.write_manifest(
                model_id=model.id,
                cycle=cycle,
                generated_at=generated_at,
            )
            artifacts.write_success_marker(
                model_id=model.id,
                cycle=cycle,
                product_id="tmp_surface",
                fhour="000",
            )
            artifacts.write_published_marker(
                model_id=model.id,
                cycle=cycle,
                generated_at=generated_at,
                manifest_uri=manifest_uri,
            )

            snapshot = read_model_artifact_snapshot(
                store=artifacts.store,
                paths=artifacts.paths,
                model=model,
                now=NOW,
                history_cycle_count=4,
                status_cycle_count=4,
                publish_lag_policy=_policy(),
            )

        self.assertEqual(snapshot.expected_cycle, cycle)
        self.assertEqual(snapshot.latest_observed_cycle, cycle)
        self.assertEqual(snapshot.latest_published_cycle, cycle)
        self.assertEqual(snapshot.latest_published_generated_at, generated_at)
        self.assertTrue(snapshot.progress.complete)
        self.assertTrue(snapshot.progress.published)
        self.assertTrue(snapshot.progress.manifest_present)
        self.assertEqual(snapshot.publish_lag.source, "recent-history")


def _policy() -> PublishLagPolicy:
    return PublishLagPolicy(
        fallback_hours=9,
        cushion_hours=1,
        min_hours=3,
        max_hours=12,
    )


if __name__ == "__main__":
    unittest.main()
