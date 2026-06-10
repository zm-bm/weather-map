from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch

from tests.fixtures.aws import FakeBatchClient, FakeDynamoClient
from tests.fixtures.cycle_plan import cycle_plan as build_cycle_plan
from tests.fixtures.cycle_plan import frame_state, frame_worker
from tests.fixtures.publish import publish_fixture
from weather_etl.config.sources import ICON_DWD_SOURCE_TYPE
from weather_etl.environment import EtlEnvironment
from weather_etl.operations.submit_icon_ready import submit_ready_icon_cycles
from weather_etl.state.manifest.submission_policy import CycleSubmissionDecision
from weather_etl.workers.launch import WorkerLaunchRecord, WorkerLaunchSummary


def test_submit_ready_icon_cycles_stops_when_submission_policy_blocks(fake_env: EtlEnvironment) -> None:
    with (
        patch(
            "weather_etl.operations.submit_icon_ready.check_cycle_submission_policy",
            return_value=_decision(allowed=False),
        ),
        patch.object(fake_env, "ensure_or_load_run_snapshot") as ensure_snapshot,
    ):
        result = submit_ready_icon_cycles(
            batch=FakeBatchClient(),
            ddb=FakeDynamoClient(),
            queue="weather-etl",
            job_definition="weather-etl-worker-icon:1",
            frame_claim_table="frame-claims",
            run_coordinator_table="run-coordinator",
            env=fake_env,
            cycles=("2026021300",),
            sentinel_params=("t_2m",),
            min_bytes=1,
            now=datetime(2026, 2, 13, tzinfo=timezone.utc),
        )

    assert result.submitted == 0
    assert result.skipped_cycles == 1
    assert result.blocked == 1
    assert result.outcomes[0].status == "blocked"
    assert result.outcomes[0].scope == "cycle"
    assert result.outcomes[0].reason == "submission_policy"
    ensure_snapshot.assert_not_called()


def test_submit_ready_icon_cycles_reports_pending_sentinel(loaded_run_snapshot_factory) -> None:
    cycle = "2026051112"
    with publish_fixture(
        prefix="weather-map-icon-ready-pending-sentinel-",
        dataset_id="icon",
        dataset_label="ICON",
        cycle=cycle,
        frames=("001",),
    ) as fx:
        env = EtlEnvironment(
            artifact_root_uri=fx.artifact_root_uri,
            pipeline_uri="file:///config/pipeline.json",
            catalog_uri="file:///config/catalog.json",
            store=fx.store,
        )
        loaded_snapshot = loaded_run_snapshot_factory(
            dataset_id="icon",
            source_types={"icon": ICON_DWD_SOURCE_TYPE},
            frame_start=1,
            frame_end=1,
            cycle=cycle,
            artifact_root_uri=fx.artifact_root_uri,
        )

        with (
            patch(
                "weather_etl.operations.submit_icon_ready.check_cycle_submission_policy",
                return_value=_decision(allowed=True),
            ),
            patch("weather_etl.operations.submit_icon_ready.generate_run_id", return_value=fx.run_id),
            patch.object(env, "ensure_or_load_run_snapshot", return_value=loaded_snapshot),
            patch("weather_etl.operations.submit_icon_ready._url_ready", return_value=False),
        ):
            result = submit_ready_icon_cycles(
                batch=FakeBatchClient(),
                ddb=FakeDynamoClient(),
                queue="weather-etl",
                job_definition="weather-etl-worker-icon:1",
                frame_claim_table="frame-claims",
                run_coordinator_table="run-coordinator",
                env=env,
                cycles=(cycle,),
                sentinel_params=("t_2m",),
                min_bytes=1,
                now=datetime(2026, 5, 11, 12, tzinfo=timezone.utc),
            )

    assert result.pending == 1
    assert result.skipped_cycles == 1
    assert result.outcomes[0].status == "pending"
    assert result.outcomes[0].scope == "cycle"
    assert result.outcomes[0].reason == "sentinel_not_ready"


def test_submit_ready_icon_cycles_launches_ready_workers_once(loaded_run_snapshot_factory) -> None:
    cycle = "2026051112"
    with publish_fixture(
        prefix="weather-map-icon-ready-workers-",
        dataset_id="icon",
        dataset_label="ICON",
        cycle=cycle,
        frames=("001", "002"),
    ) as fx:
        env = EtlEnvironment(
            artifact_root_uri=fx.artifact_root_uri,
            pipeline_uri="file:///config/pipeline.json",
            catalog_uri="file:///config/catalog.json",
            store=fx.store,
        )
        loaded_snapshot = loaded_run_snapshot_factory(
            dataset_id="icon",
            source_types={"icon": ICON_DWD_SOURCE_TYPE},
            frame_start=1,
            frame_end=2,
            cycle=cycle,
            run_id=fx.run_id,
            artifact_root_uri=fx.artifact_root_uri,
        )
        plan = build_cycle_plan(
            dataset_id="icon",
            cycle=cycle,
            run_id=fx.run_id,
            workers=(frame_worker("001", dataset_id="icon"), frame_worker("002", dataset_id="icon")),
            frame_states=(frame_state("001", "pending"), frame_state("002", "pending")),
        )

        def launch_workers(**kwargs):
            assert kwargs["plan"] is plan
            assert tuple(worker.frame_id for worker in kwargs["workers"]) == ("001", "002")
            return WorkerLaunchSummary(
                records=tuple(
                    WorkerLaunchRecord(
                        worker=worker,
                        source_uri=worker.source_uri,
                        started=True,
                        job_id=f"job-{worker.frame_id}",
                        job_name=f"icon-job-{worker.frame_id}",
                    )
                    for worker in kwargs["workers"]
                )
            )

        with (
            patch(
                "weather_etl.operations.submit_icon_ready.check_cycle_submission_policy",
                return_value=_decision(allowed=True),
            ),
            patch("weather_etl.operations.submit_icon_ready.generate_run_id", return_value=fx.run_id),
            patch.object(env, "ensure_or_load_run_snapshot", return_value=loaded_snapshot),
            patch("weather_etl.operations.submit_icon_ready.plan_cycle", return_value=plan),
            patch("weather_etl.operations.submit_icon_ready._url_ready", return_value=True),
            patch(
                "weather_etl.operations.submit_icon_ready.launch_aws_batch_plan_workers",
                side_effect=launch_workers,
            ) as launch_aws_batch_plan_workers,
        ):
            result = submit_ready_icon_cycles(
                batch=FakeBatchClient(),
                ddb=FakeDynamoClient(),
                queue="weather-etl",
                job_definition="weather-etl-worker-icon:1",
                frame_claim_table="frame-claims",
                run_coordinator_table="run-coordinator",
                env=env,
                cycles=(cycle,),
                sentinel_params=("t_2m",),
                min_bytes=1,
                now=datetime(2026, 5, 11, 12, tzinfo=timezone.utc),
            )

    assert launch_aws_batch_plan_workers.call_count == 1
    assert result.submitted == 2
    assert [(outcome.frame_id, outcome.status, outcome.reason) for outcome in result.outcomes[1:]] == [
        ("001", "submitted", "batch_submitted"),
        ("002", "submitted", "batch_submitted"),
    ]


def _decision(*, allowed: bool) -> CycleSubmissionDecision:
    return CycleSubmissionDecision(
        dataset_id="icon",
        cycle="2026021300",
        latest_status="valid",
        latest_cycle="2026021306",
        backfill_required=not allowed,
        force_backfill=False,
        allowed=allowed,
        message="allowed" if allowed else "blocked",
    )
