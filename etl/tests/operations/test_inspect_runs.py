from __future__ import annotations

from unittest.mock import patch

from tests.fixtures.artifacts import DEFAULT_RUN_ID
from weather_etl.environment import EtlEnvironment
from weather_etl.operations.inspect_runs import inspect_runs, inspect_status


def test_inspect_runs_delegates_to_runs_report(fake_env: EtlEnvironment) -> None:
    report = {"schema": "weather-map.etl-operator-runs", "runs": []}

    with patch("weather_etl.operations.inspect_runs.runs_report", return_value=report) as runs_report:
        result = inspect_runs(env=fake_env, dataset_id="gfs", cycle="2026021300")

    assert result is report
    assert runs_report.call_args.kwargs["artifact_repo"] is fake_env.artifact_repo
    assert runs_report.call_args.kwargs["store"] is fake_env.store
    assert runs_report.call_args.kwargs["dataset_id"] == "gfs"


def test_inspect_status_normalizes_optional_run_id(fake_env: EtlEnvironment) -> None:
    report = {"schema": "weather-map.etl-operator-status", "run": None}

    with patch("weather_etl.operations.inspect_runs.status_report", return_value=report) as status_report:
        result = inspect_status(
            env=fake_env,
            dataset_id="gfs",
            cycle="2026021300",
            run_id=f" {DEFAULT_RUN_ID} ",
        )

    assert result is report
    assert status_report.call_args.kwargs["run_id"] == DEFAULT_RUN_ID
