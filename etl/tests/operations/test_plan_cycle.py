from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from tests.fixtures.artifact_configs import minimal_artifact_config
from tests.fixtures.artifacts import (
    DEFAULT_CODE_REVISION,
    DEFAULT_IMAGE_IDENTITY,
    DEFAULT_PRODUCT_CONFIG_DIGEST,
    DEFAULT_RUN_ID,
)
from tests.fixtures.catalog import catalog_for_dataset
from tests.fixtures.pipeline import add_dataset_artifact, loaded_product_config, minimal_pipeline_config
from tests.fixtures.publish import publish_fixture
from weather_etl.config.pipeline import parse_pipeline_config
from weather_etl.environment import EtlEnvironment
from weather_etl.operations.plan_cycle import plan_cycle
from weather_etl.state.runs.metadata import RunMetadata
from weather_etl.state.runs.snapshots import LoadedRunSnapshot
from weather_etl.workers.claims.store import FrameClaim, FrameClaimStore
from weather_etl.workers.plan import PLAN_SCHEMA, PLAN_SCHEMA_VERSION, CyclePlan


class _FakeClaimStore(FrameClaimStore):
    def __init__(self, claim: FrameClaim | None = None) -> None:
        self.claim = claim

    def get(self, *, dataset_id: str, cycle: str, run_id: str, frame_id: str) -> FrameClaim | None:
        if self.claim and self.claim.frame_id == frame_id:
            return self.claim
        return None


def _snapshot(
    *,
    cycle: str,
    frames_end: int = 3,
    artifact_ids: tuple[str, ...] | None = None,
) -> LoadedRunSnapshot:
    raw = minimal_pipeline_config()
    raw["datasets"]["gfs"]["workload"]["frame_end"] = frames_end
    if artifact_ids is not None:
        raw["datasets"]["gfs"]["workload"]["artifacts"] = list(artifact_ids)
        raw["datasets"]["gfs"]["artifacts"] = {}
        for artifact_id in artifact_ids:
            add_dataset_artifact(
                raw,
                dataset_id="gfs",
                artifact_id=artifact_id,
                artifact_config=minimal_artifact_config(),
            )
    cfg = parse_pipeline_config(raw)
    product_config = loaded_product_config(
        pipeline_config=cfg,
        catalog=catalog_for_dataset(cfg.dataset("gfs")),
    )
    return LoadedRunSnapshot(
        run_id=DEFAULT_RUN_ID,
        product_config_digest=DEFAULT_PRODUCT_CONFIG_DIGEST,
        pipeline_uri=f"file:///artifacts/runs/gfs/{cycle}/{DEFAULT_RUN_ID}/config/pipeline.json",
        catalog_uri=f"file:///artifacts/runs/gfs/{cycle}/{DEFAULT_RUN_ID}/config/catalog.json",
        metadata=RunMetadata(
            code_revision=DEFAULT_CODE_REVISION,
            image_identity=DEFAULT_IMAGE_IDENTITY,
            product_config_digest=DEFAULT_PRODUCT_CONFIG_DIGEST,
        ),
        product_config=product_config,
    )


def test_plan_uses_loaded_snapshot_run_id_when_no_run_id_is_supplied() -> None:
    with publish_fixture(prefix="weather-map-plan-loaded-run-id-", frames=("003",)) as fx:
        env = EtlEnvironment(
            artifact_root_uri=fx.artifact_root_uri,
            pipeline_uri="file:///config/pipeline.json",
            catalog_uri="file:///config/catalog.json",
            store=fx.store,
        )

        plan = plan_cycle(
            env=env,
            dataset_id="gfs",
            cycle=fx.cycle,
            run_id=None,
            selected_frames=("003",),
            selected_artifacts=("tmp_surface",),
            publish=False,
            loaded_snapshot=_snapshot(cycle=fx.cycle),
        )

    assert isinstance(plan, CyclePlan)
    assert plan.run_id == DEFAULT_RUN_ID
    assert plan.workers[0].env["RUN_ID"] == DEFAULT_RUN_ID
    assert plan.to_operator_dict()["schema"] == PLAN_SCHEMA
    assert plan.to_operator_dict()["schema_version"] == PLAN_SCHEMA_VERSION


def test_plan_rejects_loaded_snapshot_run_id_mismatch() -> None:
    with publish_fixture(prefix="weather-map-plan-run-id-mismatch-", frames=("003",)) as fx:
        env = EtlEnvironment(
            artifact_root_uri=fx.artifact_root_uri,
            pipeline_uri="file:///config/pipeline.json",
            catalog_uri="file:///config/catalog.json",
            store=fx.store,
        )

        with pytest.raises(SystemExit, match="Loaded run snapshot mismatch"):
            plan_cycle(
                env=env,
                dataset_id="gfs",
                cycle=fx.cycle,
                run_id="20260213T010203Z-deadbeef",
                selected_frames=("003",),
                selected_artifacts=("tmp_surface",),
                publish=False,
                loaded_snapshot=_snapshot(cycle=fx.cycle),
            )


def test_plan_skips_marker_backed_complete_frames_and_submits_pending_frames() -> None:
    with publish_fixture(prefix="weather-map-plan-complete-", frames=("000", "003")) as fx:
        fx.write_scalar_marker(frame_id="000")
        env = EtlEnvironment(
            artifact_root_uri=fx.artifact_root_uri,
            pipeline_uri="file:///config/pipeline.json",
            catalog_uri="file:///config/catalog.json",
            store=fx.store,
        )

        plan = plan_cycle(
            env=env,
            dataset_id="gfs",
            cycle=fx.cycle,
            run_id=DEFAULT_RUN_ID,
            selected_frames=("003", "000"),
            selected_artifacts=("tmp_surface",),
            publish=True,
            loaded_snapshot=_snapshot(cycle=fx.cycle),
            source_uris_by_frame={"003": "s3://source/gfs.f003"},
        )

    assert plan.frame_ids == ("000", "003")
    assert [state.state for state in plan.frame_states] == ["complete", "pending"]
    assert [worker.frame_id for worker in plan.workers] == ["003"]
    assert plan.workers[0].source_uri == "s3://source/gfs.f003"
    assert plan.workers[0].env["GRIB_SOURCE_URI"] == "s3://source/gfs.f003"
    assert "source_uri" not in plan.workers[0].to_plan_dict()
    assert plan.workers[0].command[:2] == ("weather-etl", "run-frame")
    assert plan.validation.command[:2] == ("weather-etl", "validate-cycle")
    assert plan.publish is not None
    assert plan.publish.command[:2] == ("weather-etl", "publish-cycle")
    assert plan.to_operator_dict()["frame_ids"] == ["000", "003"]
    assert plan.to_operator_dict()["frames"] == ["000", "003"]


def test_frame_state_reports_total_missing_markers_and_sample() -> None:
    artifact_ids = tuple(f"tmp_surface_{index}" for index in range(7))
    with publish_fixture(prefix="weather-map-plan-missing-marker-sample-", frames=("003",)) as fx:
        env = EtlEnvironment(
            artifact_root_uri=fx.artifact_root_uri,
            pipeline_uri="file:///config/pipeline.json",
            catalog_uri="file:///config/catalog.json",
            store=fx.store,
        )

        plan = plan_cycle(
            env=env,
            dataset_id="gfs",
            cycle=fx.cycle,
            run_id=DEFAULT_RUN_ID,
            selected_frames=("003",),
            selected_artifacts=artifact_ids,
            publish=False,
            loaded_snapshot=_snapshot(cycle=fx.cycle, artifact_ids=artifact_ids),
        )

    frame_state = plan.frame_states[0]
    assert frame_state.expected_marker_count == 7
    assert frame_state.observed_marker_count == 0
    assert frame_state.missing_marker_count == 7
    assert len(frame_state.missing_markers) == 5
    assert len(plan.to_operator_dict()["frame_states"][0]["missing_markers"]) == 5


def test_plan_skips_active_claimed_frames() -> None:
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
        env = EtlEnvironment(
            artifact_root_uri=fx.artifact_root_uri,
            pipeline_uri="file:///config/pipeline.json",
            catalog_uri="file:///config/catalog.json",
            store=fx.store,
        )

        plan = plan_cycle(
            env=env,
            dataset_id="gfs",
            cycle=fx.cycle,
            run_id=DEFAULT_RUN_ID,
            selected_frames=("003",),
            selected_artifacts=("tmp_surface",),
            publish=False,
            claim_store=_FakeClaimStore(claim),
            loaded_snapshot=_snapshot(cycle=fx.cycle),
            now=now,
        )

    assert plan.frame_states[0].state == "claimed"
    assert plan.frame_states[0].claim["job_id"] == "job-1"
    assert plan.workers == ()


def test_plan_marks_expired_claimed_frames_pending() -> None:
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
        env = EtlEnvironment(
            artifact_root_uri=fx.artifact_root_uri,
            pipeline_uri="file:///config/pipeline.json",
            catalog_uri="file:///config/catalog.json",
            store=fx.store,
        )

        plan = plan_cycle(
            env=env,
            dataset_id="gfs",
            cycle=fx.cycle,
            run_id=DEFAULT_RUN_ID,
            selected_frames=("003",),
            selected_artifacts=("tmp_surface",),
            publish=False,
            claim_store=_FakeClaimStore(claim),
            loaded_snapshot=_snapshot(cycle=fx.cycle),
            now=now,
        )

    assert plan.frame_states[0].state == "pending"
    assert [worker.frame_id for worker in plan.workers] == ["003"]


def test_plan_does_not_treat_complete_claim_as_frame_completion() -> None:
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
        env = EtlEnvironment(
            artifact_root_uri=fx.artifact_root_uri,
            pipeline_uri="file:///config/pipeline.json",
            catalog_uri="file:///config/catalog.json",
            store=fx.store,
        )

        plan = plan_cycle(
            env=env,
            dataset_id="gfs",
            cycle=fx.cycle,
            run_id=DEFAULT_RUN_ID,
            selected_frames=("003",),
            selected_artifacts=("tmp_surface",),
            publish=False,
            claim_store=_FakeClaimStore(claim),
            loaded_snapshot=_snapshot(cycle=fx.cycle),
            now=now,
        )

    assert plan.frame_states[0].state == "pending"
    assert [worker.frame_id for worker in plan.workers] == ["003"]
