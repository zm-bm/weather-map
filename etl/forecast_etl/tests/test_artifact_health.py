from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from forecast_etl.artifacts.health import read_model_artifact_health
from forecast_etl.artifacts.snapshot import PublishLagPolicy
from forecast_etl.config.load import parse_pipeline_config
from forecast_etl.cycles import cycle_datetime
from forecast_etl.tests.fixtures.artifacts import temp_artifact_fixture
from forecast_etl.tests.fixtures.pipeline import minimal_pipeline_config
from forecast_etl.tests.fixtures.stores import CountingStore

NOW = datetime(2026, 5, 11, 18, 30, tzinfo=timezone.utc)
CURRENT_CYCLE = "2026051112"
STALE_CYCLE = "2026051106"


class ArtifactHealthTest(unittest.TestCase):
    def test_current_latest_manifest_returns_fresh_without_reading_status_markers(self) -> None:
        with temp_artifact_fixture() as artifacts:
            model = _model()
            artifacts.write_manifest(
                model_id=model.id,
                cycle=CURRENT_CYCLE,
                generated_at=cycle_datetime(CURRENT_CYCLE) + timedelta(hours=1),
            )
            store = CountingStore(artifacts.store)

            health = read_model_artifact_health(
                store=store,
                paths=artifacts.paths,
                model=model,
                now=NOW,
                history_cycle_count=4,
                status_cycle_count=4,
                publish_lag_policy=_policy(),
                recent_progress_hours=2,
            )

        self.assertEqual(health.status, "fresh")
        self.assertEqual(health.reason, "Latest expected cycle is published.")
        self.assertEqual(health.expected_cycle, CURRENT_CYCLE)
        self.assertIsNone(health.progress)
        self.assertEqual(health.publish_lag.source, "latest-manifest")
        self.assertFalse([prefix for prefix in store.list_object_prefixes if "/status/" in prefix])

    def test_stale_latest_with_recent_partial_markers_returns_building(self) -> None:
        with temp_artifact_fixture() as artifacts:
            model = _model()
            artifacts.write_manifest(
                model_id=model.id,
                cycle=STALE_CYCLE,
                generated_at=cycle_datetime(STALE_CYCLE) + timedelta(hours=1),
            )
            _write_success_markers(artifacts, model=model, cycle=CURRENT_CYCLE, count=2, modified=NOW - timedelta(minutes=10))

            health = _read_health(artifacts, model=model)

        self.assertEqual(health.status, "building")
        self.assertEqual(health.progress.found_markers if health.progress else None, 2)
        self.assertEqual(health.progress.missing_markers if health.progress else None, 2)

    def test_stale_latest_with_old_partial_markers_returns_stalled(self) -> None:
        with temp_artifact_fixture() as artifacts:
            model = _model()
            artifacts.write_manifest(
                model_id=model.id,
                cycle=STALE_CYCLE,
                generated_at=cycle_datetime(STALE_CYCLE) + timedelta(hours=1),
            )
            _write_success_markers(artifacts, model=model, cycle=CURRENT_CYCLE, count=2, modified=NOW - timedelta(hours=4))

            health = _read_health(artifacts, model=model)

        self.assertEqual(health.status, "stalled")

    def test_stale_latest_with_invalid_current_marker_returns_incomplete(self) -> None:
        with temp_artifact_fixture() as artifacts:
            model = _model()
            artifacts.write_manifest(
                model_id=model.id,
                cycle=STALE_CYCLE,
                generated_at=cycle_datetime(STALE_CYCLE) + timedelta(hours=1),
            )
            artifacts.write_invalid_success_marker(
                model_id=model.id,
                cycle=CURRENT_CYCLE,
                product_id="tmp_surface",
                fhour="000",
                modified=NOW,
            )

            health = _read_health(artifacts, model=model)

        self.assertEqual(health.status, "incomplete")
        self.assertEqual(health.reason, "One or more success markers could not be parsed.")
        self.assertEqual(health.progress.invalid_marker_sample if health.progress else (), ("tmp_surface/000",))

    def test_stale_latest_without_current_progress_returns_stale(self) -> None:
        with temp_artifact_fixture() as artifacts:
            model = _model()
            artifacts.write_manifest(
                model_id=model.id,
                cycle=STALE_CYCLE,
                generated_at=cycle_datetime(STALE_CYCLE) + timedelta(hours=1),
            )

            health = _read_health(artifacts, model=model)

        self.assertEqual(health.status, "stale")

    def test_no_latest_history_or_status_returns_unavailable(self) -> None:
        with temp_artifact_fixture() as artifacts:
            model = _model()

            health = _read_health(artifacts, model=model)

        self.assertEqual(health.status, "unavailable")
        self.assertEqual(health.reason, "No latest manifest or status artifacts were found.")
        self.assertEqual(health.publish_lag.source, "fallback")


def _model():
    cfg = minimal_pipeline_config()
    cfg["models"]["gfs"]["workload"]["forecast_hour_end"] = 3
    return parse_pipeline_config(cfg).model("gfs")


def _read_health(artifacts, *, model):
    return read_model_artifact_health(
        store=artifacts.store,
        paths=artifacts.paths,
        model=model,
        now=NOW,
        history_cycle_count=4,
        status_cycle_count=4,
        publish_lag_policy=_policy(),
        recent_progress_hours=2,
    )


def _write_success_markers(artifacts, *, model, cycle: str, count: int, modified: datetime) -> None:
    marker_ids = [
        (product_id, fhour)
        for product_id in model.workload.products
        for fhour in model.workload.forecast_hours
    ]
    for product_id, fhour in marker_ids[:count]:
        artifacts.write_success_marker(
            model_id=model.id,
            cycle=cycle,
            product_id=product_id,
            fhour=fhour,
            modified=modified,
        )


def _policy() -> PublishLagPolicy:
    return PublishLagPolicy(
        fallback_hours=9,
        cushion_hours=1,
        min_hours=3,
        max_hours=12,
    )


if __name__ == "__main__":
    unittest.main()
