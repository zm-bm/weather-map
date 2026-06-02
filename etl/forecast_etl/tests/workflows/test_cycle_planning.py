from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from forecast_etl.config.load import LoadedPipelineConfig, parse_pipeline_config
from forecast_etl.frame_claims import FrameClaim, FrameClaimStore
from forecast_etl.run_snapshots import LoadedRunSnapshot
from forecast_etl.tests.fixtures.artifacts import DEFAULT_CONFIG_DIGEST, DEFAULT_RUN_ID
from forecast_etl.tests.fixtures.pipeline import minimal_pipeline_config
from forecast_etl.tests.fixtures.publish import publish_fixture
from forecast_etl.workflows.context import ApplicationContext
from forecast_etl.workflows.planning import plan_cycle


class _FakeClaimStore(FrameClaimStore):
    def __init__(self, claim: FrameClaim | None = None) -> None:
        self.claim = claim

    def get(self, *, dataset_id: str, cycle: str, run_id: str, frame_id: str) -> FrameClaim | None:
        if self.claim and self.claim.frame_id == frame_id:
            return self.claim
        return None


def _snapshot(*, cycle: str, frames_end: int = 3) -> LoadedRunSnapshot:
    raw = minimal_pipeline_config()
    raw["datasets"]["gfs"]["workload"]["frame_end"] = frames_end
    loaded = LoadedPipelineConfig(raw=raw, config=parse_pipeline_config(raw))
    return LoadedRunSnapshot(
        run_id=DEFAULT_RUN_ID,
        config_digest=DEFAULT_CONFIG_DIGEST,
        pipeline_config_uri=f"file:///artifacts/runs/gfs/{cycle}/{DEFAULT_RUN_ID}/config/pipeline_config.json",
        forecast_catalog_uri=f"file:///artifacts/runs/gfs/{cycle}/{DEFAULT_RUN_ID}/config/forecast_catalog.json",
        loaded_config=loaded,
        forecast_catalog={"catalogVersion": "test", "rasterLayers": []},
    )


class CyclePlanningTest(unittest.TestCase):
    def test_plan_skips_marker_backed_complete_frames_and_submits_pending_frames(self) -> None:
        with publish_fixture(prefix="weather-map-plan-complete-", frames=("000", "003")) as fx:
            fx.write_scalar_marker(frame_id="000")
            app_context = ApplicationContext(
                artifact_root_uri=fx.artifact_root_uri,
                pipeline_config_uri="file:///config/pipeline.json",
                forecast_catalog_uri="file:///config/catalog.json",
                store=fx.store,
            )

            plan = plan_cycle(
                app_context=app_context,
                dataset_id="gfs",
                cycle=fx.cycle,
                run_id=DEFAULT_RUN_ID,
                selected_frames=("003", "000"),
                selected_artifacts=("tmp_surface",),
                publish=True,
                loaded_snapshot=_snapshot(cycle=fx.cycle),
            ).plan

        self.assertEqual(plan["frame_ids"], ["000", "003"])
        self.assertEqual([state["state"] for state in plan["frame_states"]], ["complete", "pending"])
        self.assertEqual([worker["frame_id"] for worker in plan["workers"]], ["003"])

    def test_plan_skips_active_claimed_frames(self) -> None:
        now = datetime(2026, 5, 31, 1, 0, tzinfo=timezone.utc)
        claim = FrameClaim(
            dataset_id="gfs",
            cycle="2026041100",
            run_id=DEFAULT_RUN_ID,
            frame_id="003",
            state="claimed",
            attempt=1,
            expires_at_epoch=int((now + timedelta(minutes=10)).timestamp()),
            job_id="job-1",
        )
        with publish_fixture(prefix="weather-map-plan-claimed-", frames=("003",)) as fx:
            app_context = ApplicationContext(
                artifact_root_uri=fx.artifact_root_uri,
                pipeline_config_uri="file:///config/pipeline.json",
                forecast_catalog_uri="file:///config/catalog.json",
                store=fx.store,
            )

            plan = plan_cycle(
                app_context=app_context,
                dataset_id="gfs",
                cycle=fx.cycle,
                run_id=DEFAULT_RUN_ID,
                selected_frames=("003",),
                selected_artifacts=("tmp_surface",),
                publish=False,
                claim_store=_FakeClaimStore(claim),
                loaded_snapshot=_snapshot(cycle=fx.cycle),
                now=now,
            ).plan

        self.assertEqual(plan["frame_states"][0]["state"], "claimed")
        self.assertEqual(plan["frame_states"][0]["claim"]["job_id"], "job-1")
        self.assertEqual(plan["workers"], [])

    def test_plan_marks_expired_claimed_frames_pending(self) -> None:
        now = datetime(2026, 5, 31, 1, 0, tzinfo=timezone.utc)
        claim = FrameClaim(
            dataset_id="gfs",
            cycle="2026041100",
            run_id=DEFAULT_RUN_ID,
            frame_id="003",
            state="claimed",
            attempt=1,
            expires_at_epoch=int((now - timedelta(minutes=10)).timestamp()),
            job_id="job-1",
        )
        with publish_fixture(prefix="weather-map-plan-expired-claim-", frames=("003",)) as fx:
            app_context = ApplicationContext(
                artifact_root_uri=fx.artifact_root_uri,
                pipeline_config_uri="file:///config/pipeline.json",
                forecast_catalog_uri="file:///config/catalog.json",
                store=fx.store,
            )

            plan = plan_cycle(
                app_context=app_context,
                dataset_id="gfs",
                cycle=fx.cycle,
                run_id=DEFAULT_RUN_ID,
                selected_frames=("003",),
                selected_artifacts=("tmp_surface",),
                publish=False,
                claim_store=_FakeClaimStore(claim),
                loaded_snapshot=_snapshot(cycle=fx.cycle),
                now=now,
            ).plan

        self.assertEqual(plan["frame_states"][0]["state"], "pending")
        self.assertEqual([worker["frame_id"] for worker in plan["workers"]], ["003"])

    def test_plan_does_not_treat_complete_claim_as_completion_evidence(self) -> None:
        now = datetime(2026, 5, 31, 1, 0, tzinfo=timezone.utc)
        claim = FrameClaim(
            dataset_id="gfs",
            cycle="2026041100",
            run_id=DEFAULT_RUN_ID,
            frame_id="003",
            state="complete",
            attempt=1,
            expires_at_epoch=int((now + timedelta(days=1)).timestamp()),
            job_id="job-1",
        )
        with publish_fixture(prefix="weather-map-plan-complete-claim-", frames=("003",)) as fx:
            app_context = ApplicationContext(
                artifact_root_uri=fx.artifact_root_uri,
                pipeline_config_uri="file:///config/pipeline.json",
                forecast_catalog_uri="file:///config/catalog.json",
                store=fx.store,
            )

            plan = plan_cycle(
                app_context=app_context,
                dataset_id="gfs",
                cycle=fx.cycle,
                run_id=DEFAULT_RUN_ID,
                selected_frames=("003",),
                selected_artifacts=("tmp_surface",),
                publish=False,
                claim_store=_FakeClaimStore(claim),
                loaded_snapshot=_snapshot(cycle=fx.cycle),
                now=now,
            ).plan

        self.assertEqual(plan["frame_states"][0]["state"], "pending")
        self.assertEqual([worker["frame_id"] for worker in plan["workers"]], ["003"])


if __name__ == "__main__":
    unittest.main()
