from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from tests.fixtures.artifacts import DEFAULT_RUN_ID
from weather_etl.environment import EtlEnvironment
from weather_etl.operations.publish_cycle import publish_candidate, publish_cycle
from weather_etl.state.manifest.publish import PublishResult


def test_publish_cycle_uses_selected_run_snapshot_without_validation(
    fake_env: EtlEnvironment,
    loaded_run_snapshot_factory,
) -> None:
    loaded_snapshot = loaded_run_snapshot_factory(cycle="2026021300")

    with (
        patch("weather_etl.environment.load_run_snapshot", return_value=loaded_snapshot),
        patch(
            "weather_etl.operations.publish_cycle.run_publish",
            return_value=PublishResult(ready=True, already_published=False),
        ) as run_publish,
        patch("weather_etl.operations.publish_cycle.refresh_status") as refresh_status,
    ):
        result = publish_cycle(
            env=fake_env,
            dataset_id="gfs",
            cycle="2026021300",
            required_run_id=DEFAULT_RUN_ID,
        )

    assert result.ready
    assert result.run_id == DEFAULT_RUN_ID
    product_config = run_publish.call_args.kwargs["product_config"]
    assert product_config.dataset("gfs").id == "gfs"
    assert product_config.catalog_version == "test"
    refresh_status.assert_called_once_with(env=fake_env)


def test_publish_cycle_collects_all_not_ready_publish_errors(
    fake_env: EtlEnvironment,
    loaded_run_snapshot_factory,
) -> None:
    loaded_snapshot = loaded_run_snapshot_factory(cycle="2026021300")

    with (
        patch("weather_etl.environment.load_run_snapshot", return_value=loaded_snapshot),
        patch(
            "weather_etl.operations.publish_cycle.run_publish",
            return_value=PublishResult(
                ready=False,
                already_published=False,
                run_errors=("run problem",),
                validation_errors=("validation problem",),
                marker_errors=("marker problem",),
                missing_markers=("missing marker",),
            ),
        ),
        patch("weather_etl.operations.publish_cycle.refresh_status") as refresh_status,
    ):
        result = publish_cycle(
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


def test_publish_cycle_propagates_status_refresh_failure(
    fake_env: EtlEnvironment,
    loaded_run_snapshot_factory,
) -> None:
    loaded_snapshot = loaded_run_snapshot_factory(cycle="2026021300")

    with (
        patch("weather_etl.environment.load_run_snapshot", return_value=loaded_snapshot),
        patch(
            "weather_etl.operations.publish_cycle.run_publish",
            return_value=PublishResult(ready=True, already_published=False),
        ),
        patch("weather_etl.operations.publish_cycle.refresh_status", side_effect=RuntimeError("status failed")),
    ):
        try:
            publish_cycle(
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
        patch("weather_etl.operations.publish_cycle.select_run_id_for_cycle", return_value=(DEFAULT_RUN_ID, [])),
        patch("weather_etl.environment.load_run_snapshot", return_value=loaded_snapshot),
        patch(
            "weather_etl.operations.publish_cycle.validation_report_passed",
            return_value=(False, ["missing validation report"]),
        ),
        patch(
            "weather_etl.operations.publish_cycle.validate_run",
            return_value=SimpleNamespace(passed=True, errors=()),
        ) as validate_run,
        patch(
            "weather_etl.operations.publish_cycle.run_publish",
            return_value=PublishResult(ready=True, already_published=False),
        ) as run_publish,
    ):
        result = publish_candidate(env=fake_env, dataset_id="gfs", cycle="2026021300")

    assert result.ready
    validate_run.assert_called_once()
    run_publish.assert_called_once()
