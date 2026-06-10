from __future__ import annotations

from unittest.mock import patch

from tests.fixtures.artifacts import DEFAULT_RUN_ID
from weather_etl.environment import EtlEnvironment
from weather_etl.operations.init_run import init_run


def test_init_run_creates_or_verifies_snapshot(fake_env: EtlEnvironment, loaded_run_snapshot_factory) -> None:
    loaded_snapshot = loaded_run_snapshot_factory(cycle="2026021300")

    with patch("weather_etl.environment.ensure_run_snapshot", return_value=loaded_snapshot) as ensure_run_snapshot:
        result = init_run(
            env=fake_env,
            dataset_id="gfs",
            cycle="2026021300",
            run_id=DEFAULT_RUN_ID,
        )

    assert result is loaded_snapshot
    assert ensure_run_snapshot.call_args.kwargs["dataset_id"] == "gfs"
    assert ensure_run_snapshot.call_args.kwargs["cycle"] == "2026021300"
    assert ensure_run_snapshot.call_args.kwargs["run_id"] == DEFAULT_RUN_ID
