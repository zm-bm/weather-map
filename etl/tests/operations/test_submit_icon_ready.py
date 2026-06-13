from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch

from tests.fixtures.aws import FakeBatchClient, FakeDynamoClient
from tests.fixtures.publish import publish_fixture
from tests.fixtures.run_plan import frame_state, frame_worker
from tests.fixtures.run_plan import run_plan as build_run_plan
from weather_etl.config.sources import ICON_DWD_SOURCE_TYPE
from weather_etl.environment import EtlEnvironment
from weather_etl.operations.submit_icon_ready import submit_ready_icon_cycles
from weather_etl.workers.launch import WorkerLaunchRecord, WorkerLaunchSummary


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


def test_submit_ready_icon_cycles_uses_plan_state_for_frame_eligibility(loaded_run_snapshot_factory) -> None:
    cycle = "2026051112"
    with publish_fixture(
        prefix="weather-map-icon-ready-plan-state-",
        dataset_id="icon",
        dataset_label="ICON",
        cycle=cycle,
        frames=("001", "002", "003", "004", "005", "006"),
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
            frame_end=6,
            cycle=cycle,
            run_id=fx.run_id,
            artifact_root_uri=fx.artifact_root_uri,
        )
        workers = (frame_worker("001", dataset_id="icon"), frame_worker("002", dataset_id="icon"))
        plan = build_run_plan(
            dataset_id="icon",
            cycle=cycle,
            run_id=fx.run_id,
            workers=workers,
            frame_states=(
                frame_state("001", "pending"),
                frame_state("002", "pending"),
                frame_state("003", "complete"),
                frame_state("004", "claimed"),
                frame_state("005", "invalid"),
                frame_state("006", "pending"),
            ),
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

        checked_urls: list[str] = []

        def url_ready(url, min_bytes):
            checked_urls.append(url)
            return True

        with (
            patch("weather_etl.operations.submit_icon_ready.generate_run_id", return_value=fx.run_id),
            patch.object(env, "ensure_or_load_run_snapshot", return_value=loaded_snapshot),
            patch("weather_etl.operations.submit_icon_ready.plan_run", return_value=plan),
            patch("weather_etl.operations.submit_icon_ready._url_ready", side_effect=url_ready),
            patch("weather_etl.operations.submit_icon_ready.launch_aws_batch_plan_workers", side_effect=launch_workers),
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

    assert len(checked_urls) == 1
    assert "_000_T_2M" in checked_urls[0]
    assert [(outcome.frame_id, outcome.status, outcome.reason) for outcome in result.outcomes[1:]] == [
        ("001", "submitted", "batch_submitted"),
        ("002", "submitted", "batch_submitted"),
        ("003", "completed", "complete"),
        ("004", "claimed", "claimed"),
        ("005", "pending", "invalid_completion_markers"),
        ("006", "pending", "no_worker"),
    ]
