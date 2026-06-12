from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from tests.fixtures.artifacts import DEFAULT_RUN_ID
from weather_etl.environment import EtlEnvironment
from weather_etl.operations.validate_run import validate_run


def test_validate_run_returns_not_ready_for_missing_run_selection(fake_env: EtlEnvironment) -> None:
    with (
        patch("weather_etl.operations.validate_run.select_run_id_for_cycle", return_value=(None, ["multiple runs"])),
        patch("weather_etl.operations.validate_run.validate_processed_run") as validate_processed_run,
    ):
        result = validate_run(env=fake_env, dataset_id="gfs", cycle="2026021300")

    assert not result.ready
    assert not result.passed
    assert result.errors == ("multiple runs",)
    validate_processed_run.assert_not_called()


def test_validate_run_passes_through_validation_result(
    fake_env: EtlEnvironment,
    loaded_run_snapshot_factory,
) -> None:
    validation = SimpleNamespace(passed=True, errors=())
    loaded_snapshot = loaded_run_snapshot_factory(cycle="2026021300")

    with (
        patch("weather_etl.environment.load_run_snapshot", return_value=loaded_snapshot),
        patch("weather_etl.operations.validate_run.validate_processed_run", return_value=validation) as validate_processed_run,
    ):
        result = validate_run(
            env=fake_env,
            dataset_id="gfs",
            cycle="2026021300",
            required_run_id=DEFAULT_RUN_ID,
        )

    assert result.ready
    assert result.passed
    assert result.validation_result is validation
    assert validate_processed_run.call_args.kwargs["cycle"] == "2026021300"
    assert validate_processed_run.call_args.kwargs["run_id"] == DEFAULT_RUN_ID
