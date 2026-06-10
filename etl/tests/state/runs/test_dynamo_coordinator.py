from __future__ import annotations

from datetime import datetime, timezone

from weather_etl.state.runs.dynamo_coordinator import coordinated_run_id, run_pk

from tests.fixtures.aws import FakeDynamoClient


def test_coordinated_run_id_writes_and_reuses_cycle_run_id() -> None:
    ddb = FakeDynamoClient()
    now = datetime(2026, 2, 13, tzinfo=timezone.utc)

    first = coordinated_run_id(
        ddb=ddb,
        table_name="run-coordinator",
        dataset_id="gfs",
        cycle="2026021300",
        now=now,
        new_run_id="20260213T000000Z-aaaaaaaa",
    )
    second = coordinated_run_id(
        ddb=ddb,
        table_name="run-coordinator",
        dataset_id="gfs",
        cycle="2026021300",
        now=now,
        new_run_id="20260213T000001Z-bbbbbbbb",
    )

    assert first == "20260213T000000Z-aaaaaaaa"
    assert second == first
    assert ddb.items[run_pk(dataset_id="gfs", cycle="2026021300")]["run_id"] == first
