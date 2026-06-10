from __future__ import annotations

from datetime import datetime, timezone

from weather_etl.state.manifest.submission_policy import check_cycle_submission_policy

from tests.fixtures.artifacts import manifest_payload, temp_artifact_fixture
from tests.fixtures.manifests import write_latest_manifest


def test_missing_latest_allows_bootstrap_submit() -> None:
    with temp_artifact_fixture() as artifacts:
        result = check_cycle_submission_policy(
            artifact_repo=artifacts.repository,
            dataset_id="gfs",
            cycle="2026051100",
        )

    assert result.allowed
    assert result.latest_status == "missing"
    assert not result.backfill_required


def test_equal_or_newer_cycle_allows_submit() -> None:
    with temp_artifact_fixture() as artifacts:
        artifacts.write_manifest(
            dataset_id="gfs",
            cycle="2026051100",
            generated_at=datetime(2026, 5, 11, tzinfo=timezone.utc),
        )

        equal = check_cycle_submission_policy(
            artifact_repo=artifacts.repository,
            dataset_id="gfs",
            cycle="2026051100",
        )
        newer = check_cycle_submission_policy(
            artifact_repo=artifacts.repository,
            dataset_id="gfs",
            cycle="2026051106",
        )

    assert equal.allowed
    assert newer.allowed
    assert not equal.backfill_required
    assert not newer.backfill_required


def test_older_cycle_requires_force_backfill() -> None:
    with temp_artifact_fixture() as artifacts:
        artifacts.write_manifest(
            dataset_id="gfs",
            cycle="2026051106",
            generated_at=datetime(2026, 5, 11, tzinfo=timezone.utc),
        )

        blocked = check_cycle_submission_policy(
            artifact_repo=artifacts.repository,
            dataset_id="gfs",
            cycle="2026051100",
        )
        allowed = check_cycle_submission_policy(
            artifact_repo=artifacts.repository,
            dataset_id="gfs",
            cycle=" 2026051100 ",
            force_backfill=True,
        )

    assert not blocked.allowed
    assert blocked.latest_cycle == "2026051106"
    assert blocked.backfill_required
    assert allowed.allowed
    assert allowed.cycle == "2026051100"
    assert allowed.backfill_required
    assert allowed.force_backfill


def test_latest_manifest_cycle_is_used_for_submission_policy() -> None:
    generated_at = datetime(2026, 5, 11, tzinfo=timezone.utc)
    with temp_artifact_fixture() as artifacts:
        manifest = manifest_payload(cycle="2026051106", generated_at=generated_at, revision="abc123")
        write_latest_manifest(artifacts.repository, dataset_id="gfs", manifest=manifest)

        result = check_cycle_submission_policy(
            artifact_repo=artifacts.repository,
            dataset_id="gfs",
            cycle="2026051100",
        )

    assert not result.allowed
    assert result.latest_cycle == "2026051106"
    assert result.backfill_required


def test_malformed_latest_blocks_submit() -> None:
    with temp_artifact_fixture() as artifacts:
        artifacts.store.write_bytes(
            uri=artifacts.paths.latest_manifest_uri(dataset_id="gfs"),
            data=b'{"run": {"cycle": "not-a-cycle"}}\n',
        )

        result = check_cycle_submission_policy(
            artifact_repo=artifacts.repository,
            dataset_id="gfs",
            cycle="2026051100",
            force_backfill=True,
        )

    assert not result.allowed
    assert result.latest_status == "invalid"
    assert result.force_backfill
