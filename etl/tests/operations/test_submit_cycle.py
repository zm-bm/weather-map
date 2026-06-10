from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from tests.fixtures.artifacts import DEFAULT_RUN_ID
from tests.fixtures.aws import FakeBatchClient, FakeDynamoClient
from tests.fixtures.cycle_plan import cycle_plan as build_cycle_plan
from tests.fixtures.cycle_plan import frame_state, frame_worker
from weather_etl.environment import EtlEnvironment
from weather_etl.operations.submit_cycle import submit_aws_batch_cycle
from weather_etl.state.manifest.submission_policy import CycleSubmissionDecision
from weather_etl.workers.launch import WorkerLaunchRecord, WorkerLaunchSummary


def _decision(*, allowed: bool) -> CycleSubmissionDecision:
    return CycleSubmissionDecision(
        dataset_id="gfs",
        cycle="2026021300",
        latest_status="valid",
        latest_cycle="2026021306",
        backfill_required=not allowed,
        force_backfill=False,
        allowed=allowed,
        message="allowed" if allowed else "blocked",
    )


def test_submit_cycle_stops_when_submission_policy_blocks(fake_env: EtlEnvironment) -> None:
    with (
        patch("weather_etl.operations.submit_cycle.check_cycle_submission_policy", return_value=_decision(allowed=False)),
        patch("weather_etl.environment.ensure_run_snapshot") as ensure_run_snapshot,
    ):
        with pytest.raises(SystemExit) as raised:
            submit_aws_batch_cycle(
                env=fake_env,
                dataset_id="gfs",
                cycle="2026021300",
                run_id=DEFAULT_RUN_ID,
                selected_frames=None,
                selected_artifacts=None,
                force_backfill=False,
                dry_run=False,
                batch=FakeBatchClient(),
                ddb=FakeDynamoClient(),
                frame_claim_table="frame-claims",
                queue="weather-etl",
                job_definition="weather-etl-worker:1",
                source_bucket="noaa-gfs-bdp-pds",
                job_name_prefix="weather-etl",
                submit_delay_seconds=0.0,
            )

    assert raised.value.code == 2
    ensure_run_snapshot.assert_not_called()


def test_submit_cycle_dry_run_builds_plan_without_submitting(
    fake_env: EtlEnvironment,
    loaded_product_config_factory,
) -> None:
    product_config = loaded_product_config_factory(frame_start=0, frame_end=0)
    source_uri = "s3://noaa-gfs-bdp-pds/gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f000"
    plan = build_cycle_plan(
        artifact_root_uri="s3://artifacts",
        source_pipeline_uri="s3://config/pipeline.json",
        source_catalog_uri="s3://config/catalog.json",
        snapshot_exists=False,
        workers=(
            frame_worker(
                frame_id="000",
                env={"GRIB_SOURCE_URI": source_uri},
                command=("weather-etl", "run-frame"),
                source_uri=source_uri,
            ),
        ),
        frame_states=(frame_state("000", "pending"),),
        frame_ids=("000",),
    )
    batch = FakeBatchClient()

    with (
        patch("weather_etl.operations.submit_cycle.check_cycle_submission_policy", return_value=_decision(allowed=True)),
        patch("weather_etl.environment.load_run_snapshot", side_effect=FileNotFoundError("missing run.json")),
        patch.object(fake_env, "load_product_config", return_value=product_config),
        patch("weather_etl.operations.submit_cycle.plan_cycle", return_value=plan) as plan_cycle,
    ):
        result = submit_aws_batch_cycle(
            env=fake_env,
            dataset_id="gfs",
            cycle="2026021300",
            run_id=DEFAULT_RUN_ID,
            selected_frames=("000",),
            selected_artifacts=("tmp_surface",),
            force_backfill=False,
            dry_run=True,
            batch=batch,
            ddb=FakeDynamoClient(),
            frame_claim_table="frame-claims",
            queue="weather-etl",
            job_definition="weather-etl-worker:1",
            source_bucket="noaa-gfs-bdp-pds",
            job_name_prefix="weather-etl",
            submit_delay_seconds=0.0,
            now=datetime(2026, 2, 13, tzinfo=timezone.utc),
        )

    assert result.ok
    assert result.workers_started == 0
    assert result.workers_skipped == 0
    assert batch.submissions == []
    assert plan_cycle.call_args.kwargs["selected_frames"] == ("000",)
    assert plan_cycle.call_args.kwargs["selected_artifacts"] == ("tmp_surface",)


def test_submit_cycle_submits_workers_and_leaves_validation_to_scheduled_publisher(
    fake_env: EtlEnvironment,
    loaded_run_snapshot_factory,
) -> None:
    snapshot = loaded_run_snapshot_factory(frame_start=0, frame_end=0)
    source_uri = "s3://noaa-gfs-bdp-pds/gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f000"
    plan = build_cycle_plan(
        artifact_root_uri="s3://artifacts",
        source_pipeline_uri="s3://config/pipeline.json",
        source_catalog_uri="s3://config/catalog.json",
        snapshot_exists=False,
        workers=(
            frame_worker(
                frame_id="000",
                env={"GRIB_SOURCE_URI": source_uri},
                command=("weather-etl", "run-frame"),
                source_uri=source_uri,
            ),
        ),
        frame_states=(frame_state("000", "pending"),),
        frame_ids=("000",),
    )
    phases: list[str] = []

    def check_cycle_submission_policy(**kwargs):
        del kwargs
        phases.append("submission-policy")
        return _decision(allowed=True)

    def ensure_run_snapshot(**kwargs):
        del kwargs
        phases.append("initialize-run")
        return snapshot

    def plan_cycle(**kwargs):
        del kwargs
        phases.append("plan-frames")
        return plan

    def launch_workers(**kwargs):
        phases.append("submit-worker")
        assert kwargs["plan"] is plan
        assert kwargs["plan"].workers[0] is plan.workers[0]
        return WorkerLaunchSummary(
            records=(
                WorkerLaunchRecord(
                    worker=kwargs["plan"].workers[0],
                    source_uri=kwargs["plan"].workers[0].source_uri,
                    started=True,
                    job_id="job-1",
                    job_name="job-1",
                ),
            )
        )

    with (
        patch(
            "weather_etl.operations.submit_cycle.check_cycle_submission_policy",
            side_effect=check_cycle_submission_policy,
        ),
        patch.object(fake_env, "ensure_run_snapshot", side_effect=ensure_run_snapshot),
        patch("weather_etl.operations.submit_cycle.plan_cycle", side_effect=plan_cycle),
        patch("weather_etl.operations.submit_cycle.launch_aws_batch_plan_workers", side_effect=launch_workers),
    ):
        result = submit_aws_batch_cycle(
            env=fake_env,
            dataset_id="gfs",
            cycle="2026021300",
            run_id=DEFAULT_RUN_ID,
            selected_frames=("000",),
            selected_artifacts=("tmp_surface",),
            force_backfill=False,
            dry_run=False,
            batch=FakeBatchClient(),
            ddb=FakeDynamoClient(),
            frame_claim_table="frame-claims",
            queue="weather-etl",
            job_definition="weather-etl-worker:1",
            source_bucket="noaa-gfs-bdp-pds",
            job_name_prefix="weather-etl",
            submit_delay_seconds=0.0,
            now=datetime(2026, 2, 13, tzinfo=timezone.utc),
        )

    assert phases == ["submission-policy", "initialize-run", "plan-frames", "submit-worker"]
    assert result.ok
    assert result.workers_started == 1
    assert result.workers_skipped == 0
