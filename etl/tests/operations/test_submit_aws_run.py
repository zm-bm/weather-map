from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch

from tests.fixtures.artifacts import DEFAULT_RUN_ID
from tests.fixtures.aws import FakeBatchClient, FakeDynamoClient
from tests.fixtures.run_plan import frame_state, frame_worker
from tests.fixtures.run_plan import run_plan as build_run_plan
from weather_etl.environment import EtlEnvironment
from weather_etl.operations.submit_aws_run import submit_aws_batch_run
from weather_etl.workers.launch import WorkerLaunchRecord, WorkerLaunchSummary


def test_submit_aws_run_dry_run_builds_plan_without_submitting(
    fake_env: EtlEnvironment,
    loaded_product_config_factory,
) -> None:
    product_config = loaded_product_config_factory(frame_start=0, frame_end=0)
    source_uri = "s3://noaa-gfs-bdp-pds/gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f000"
    plan = build_run_plan(
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
        patch("weather_etl.environment.load_run_snapshot", side_effect=FileNotFoundError("missing run.json")),
        patch.object(fake_env, "load_product_config", return_value=product_config),
        patch("weather_etl.operations.submit_aws_run.plan_run", return_value=plan) as plan_run,
    ):
        result = submit_aws_batch_run(
            env=fake_env,
            dataset_id="gfs",
            cycle="2026021300",
            run_id=DEFAULT_RUN_ID,
            selected_frames=("000",),
            selected_artifacts=("tmp_surface",),
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
    assert plan_run.call_args.kwargs["selected_frames"] == ("000",)
    assert plan_run.call_args.kwargs["selected_artifacts"] == ("tmp_surface",)


def test_submit_aws_run_submits_workers_and_leaves_validation_to_scheduled_publisher(
    fake_env: EtlEnvironment,
    loaded_run_snapshot_factory,
) -> None:
    snapshot = loaded_run_snapshot_factory(frame_start=0, frame_end=0)
    source_uri = "s3://noaa-gfs-bdp-pds/gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f000"
    plan = build_run_plan(
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
    def launch_workers(**kwargs):
        assert kwargs["plan"] is plan
        assert kwargs["plan"].workers[0] is plan.workers[0]
        return WorkerLaunchSummary(
            records=(
                WorkerLaunchRecord(
                    worker=kwargs["plan"].workers[0],
                    started=True,
                    job_id="job-1",
                    job_name="job-1",
                ),
            )
        )

    with (
        patch.object(fake_env, "ensure_run_snapshot", return_value=snapshot) as ensure_run_snapshot,
        patch("weather_etl.operations.submit_aws_run.plan_run", return_value=plan) as plan_run,
        patch("weather_etl.operations.submit_aws_run.launch_aws_batch_plan_workers", side_effect=launch_workers) as launch,
    ):
        result = submit_aws_batch_run(
            env=fake_env,
            dataset_id="gfs",
            cycle="2026021300",
            run_id=DEFAULT_RUN_ID,
            selected_frames=("000",),
            selected_artifacts=("tmp_surface",),
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

    assert result.ok
    assert result.workers_started == 1
    assert result.workers_skipped == 0
    ensure_run_snapshot.assert_called_once()
    plan_run.assert_called_once()
    launch.assert_called_once()
