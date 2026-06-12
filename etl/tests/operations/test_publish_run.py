from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from tests.fixtures.artifacts import DEFAULT_RUN_ID
from tests.fixtures.pipeline import raw_pipeline_config
from weather_etl.config.pipeline import parse_pipeline_config
from weather_etl.config.sources import MRMS_AWS_S3_SOURCE_TYPE
from weather_etl.environment import EtlEnvironment
from weather_etl.operations.publish_run import publish_run, publish_run_candidate
from weather_etl.state.manifest.public_view import DatasetViewPublishResult
from weather_etl.state.manifest.publish import RunManifestPublishResult


def test_publish_run_uses_selected_run_snapshot_without_validation(
    fake_env: EtlEnvironment,
    loaded_run_snapshot_factory,
) -> None:
    loaded_snapshot = loaded_run_snapshot_factory(cycle="2026021300")

    with (
        patch("weather_etl.environment.load_run_snapshot", return_value=loaded_snapshot),
        patch(
            "weather_etl.operations.publish_run.publish_run_manifest",
            return_value=RunManifestPublishResult(ready=True, already_published=False),
        ) as publish_run_manifest,
        patch(
            "weather_etl.operations.publish_run.publish_dataset_view",
            return_value=DatasetViewPublishResult(ready=True, published=True),
        ) as publish_dataset_view,
        patch("weather_etl.operations.publish_run.refresh_status") as refresh_status,
    ):
        result = publish_run(
            env=fake_env,
            dataset_id="gfs",
            cycle="2026021300",
            required_run_id=DEFAULT_RUN_ID,
        )

    assert result.ready
    assert result.run_id == DEFAULT_RUN_ID
    publish_run_manifest.assert_called_once()
    product_config = publish_dataset_view.call_args.kwargs["product_config"]
    assert product_config.dataset("gfs").id == "gfs"
    assert product_config.catalog_version == "test"
    refresh_status.assert_called_once_with(env=fake_env)


def test_publish_run_rolls_observed_latest_for_lifecycle_dataset(
    fake_env: EtlEnvironment,
    loaded_run_snapshot_factory,
) -> None:
    raw = raw_pipeline_config(
        dataset_ids=("mrms",),
        source_types={"mrms": MRMS_AWS_S3_SOURCE_TYPE},
        artifacts=("tmp_surface",),
    )
    raw["datasets"]["mrms"]["workload"] = {"frames": ["20260611020000"]}
    raw["datasets"]["mrms"]["lifecycle"] = {
        "type": "rolling_observed",
        "display_window_minutes": 120,
        "publish_scan_minutes": 180,
    }
    pipeline_config = parse_pipeline_config(raw)
    loaded_snapshot = loaded_run_snapshot_factory(
        dataset_id="mrms",
        pipeline_config=pipeline_config,
        cycle="2026061102",
    )

    with (
        patch("weather_etl.operations.publish_run.select_run_id_for_cycle", return_value=(DEFAULT_RUN_ID, [])),
        patch("weather_etl.environment.load_run_snapshot", return_value=loaded_snapshot),
        patch(
            "weather_etl.operations.publish_run.publish_run_manifest",
            return_value=RunManifestPublishResult(ready=True, already_published=False),
        ) as publish_run_manifest,
        patch(
            "weather_etl.operations.publish_run.publish_dataset_view",
            return_value=DatasetViewPublishResult(
                ready=True,
                published=True,
            ),
        ) as publish_rolling,
        patch("weather_etl.operations.publish_run.refresh_status") as refresh_status,
    ):
        result = publish_run(
            env=fake_env,
            dataset_id="mrms",
            cycle="2026061102",
            required_run_id=DEFAULT_RUN_ID,
        )

    assert result.ready
    publish_run_manifest.assert_called_once()
    publish_rolling.assert_called_once()
    assert publish_rolling.call_args.kwargs["now"] == datetime(2026, 6, 11, 2, 0, tzinfo=timezone.utc)
    refresh_status.assert_called_once_with(env=fake_env)


def test_publish_run_collects_all_not_ready_publish_errors(
    fake_env: EtlEnvironment,
    loaded_run_snapshot_factory,
) -> None:
    loaded_snapshot = loaded_run_snapshot_factory(cycle="2026021300")

    with (
        patch("weather_etl.environment.load_run_snapshot", return_value=loaded_snapshot),
        patch(
            "weather_etl.operations.publish_run.publish_run_manifest",
            return_value=RunManifestPublishResult(
                ready=False,
                already_published=False,
                run_errors=("run problem",),
                validation_errors=("validation problem",),
                marker_errors=("marker problem",),
                missing_markers=("missing marker",),
            ),
        ),
        patch("weather_etl.operations.publish_run.refresh_status") as refresh_status,
    ):
        result = publish_run(
            env=fake_env,
            dataset_id="gfs",
            cycle="2026021300",
            required_run_id=DEFAULT_RUN_ID,
        )

    assert not result.ready
    assert result.errors == (
        "run problem",
        "validation problem",
        "marker problem",
        "missing marker",
    )
    refresh_status.assert_called_once_with(env=fake_env)


def test_publish_run_propagates_status_refresh_failure(
    fake_env: EtlEnvironment,
    loaded_run_snapshot_factory,
) -> None:
    loaded_snapshot = loaded_run_snapshot_factory(cycle="2026021300")

    with (
        patch("weather_etl.environment.load_run_snapshot", return_value=loaded_snapshot),
        patch(
            "weather_etl.operations.publish_run.publish_run_manifest",
            return_value=RunManifestPublishResult(ready=True, already_published=False),
        ),
        patch(
            "weather_etl.operations.publish_run.publish_dataset_view",
            return_value=DatasetViewPublishResult(ready=True, published=True),
        ),
        patch("weather_etl.operations.publish_run.refresh_status", side_effect=RuntimeError("status failed")),
    ):
        try:
            publish_run(
                env=fake_env,
                dataset_id="gfs",
                cycle="2026021300",
                required_run_id=DEFAULT_RUN_ID,
            )
        except RuntimeError as exc:
            assert str(exc) == "status failed"
        else:
            raise AssertionError("expected status refresh failure to propagate")


def test_scheduled_publisher_validates_missing_report_before_publishing(
    fake_env: EtlEnvironment,
    loaded_run_snapshot_factory,
) -> None:
    loaded_snapshot = loaded_run_snapshot_factory(cycle="2026021300")

    with (
        patch("weather_etl.operations.publish_run.select_run_id_for_cycle", return_value=(DEFAULT_RUN_ID, [])),
        patch("weather_etl.environment.load_run_snapshot", return_value=loaded_snapshot),
        patch(
            "weather_etl.operations.publish_run.validation_report_passed",
            return_value=(False, ["missing validation report"]),
        ),
        patch(
            "weather_etl.operations.publish_run.validate_run",
            return_value=SimpleNamespace(passed=True, errors=()),
        ) as validate_run,
        patch(
            "weather_etl.operations.publish_run.publish_run_manifest",
            return_value=RunManifestPublishResult(ready=True, already_published=False),
        ) as publish_run_manifest,
    ):
        result = publish_run_candidate(env=fake_env, dataset_id="gfs", cycle="2026021300")

    assert result.ready
    validate_run.assert_called_once()
    publish_run_manifest.assert_called_once()
