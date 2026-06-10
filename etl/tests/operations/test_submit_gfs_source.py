from __future__ import annotations

from unittest.mock import patch

from tests.fixtures.aws import FakeBatchClient, FakeDynamoClient
from weather_etl.environment import EtlEnvironment
from weather_etl.operations.submit_gfs_source import GfsSourceObject, submit_gfs_source_object
from weather_etl.state.manifest.submission_policy import CycleSubmissionDecision


def test_submit_gfs_source_stops_when_submission_policy_blocks(fake_env: EtlEnvironment) -> None:
    with (
        patch(
            "weather_etl.operations.submit_gfs_source.check_cycle_submission_policy",
            return_value=_decision(allowed=False),
        ),
        patch.object(fake_env, "ensure_or_load_run_snapshot") as ensure_snapshot,
    ):
        result = submit_gfs_source_object(
            batch=FakeBatchClient(),
            ddb=FakeDynamoClient(),
            queue="weather-etl",
            job_definition="weather-etl-worker:1",
            run_coordinator_table="run-coordinator",
            frame_claim_table="frame-claims",
            env=fake_env,
            source_object=GfsSourceObject(
                bucket="noaa-gfs-bdp-pds",
                key="gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f000",
            ),
        )

    assert result.submitted == 0
    assert result.blocked == 1
    assert result.outcomes[0].status == "blocked"
    assert result.outcomes[0].scope == "cycle"
    assert result.outcomes[0].reason == "submission_policy"
    ensure_snapshot.assert_not_called()


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
