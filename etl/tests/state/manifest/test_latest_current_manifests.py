from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from tests.fixtures.artifacts import DEFAULT_RUN_ID, manifest_payload, temp_artifact_fixture

GENERATED_AT = datetime(2026, 5, 11, 8, tzinfo=timezone.utc)


def test_latest_manifest_reads_full_cycle_manifest() -> None:
    with temp_artifact_fixture() as artifacts:
        manifest_uri = artifacts.write_manifest(cycle="2026051106", generated_at=GENERATED_AT)

        latest = artifacts.repository.read_latest_manifest(dataset_id="gfs")
        stored_manifest = artifacts.repository.read_json_uri(manifest_uri)
        stored_latest = artifacts.repository.read_json_uri(artifacts.paths.latest_manifest_uri(dataset_id="gfs"))

    assert latest.cycle == "2026051106"
    assert latest.run_id == DEFAULT_RUN_ID
    assert latest.revision == "abc123"
    assert latest.generated_at_utc == GENERATED_AT
    assert stored_latest == stored_manifest


def test_current_manifest_reads_full_cycle_manifest() -> None:
    with temp_artifact_fixture() as artifacts:
        artifacts.write_manifest(
            cycle="2026051106",
            generated_at=GENERATED_AT,
        )

        current = artifacts.repository.read_cycle_current_manifest(dataset_id="gfs", cycle="2026051106")

    assert current.cycle == "2026051106"
    assert current.run_id == DEFAULT_RUN_ID


def test_malformed_latest_manifest_is_rejected() -> None:
    with temp_artifact_fixture() as artifacts:
        artifacts.store.write_bytes(
            uri=artifacts.paths.latest_manifest_uri(dataset_id="gfs"),
            data=b"{not-json",
        )

        with pytest.raises(ValueError):
            artifacts.repository.read_latest_manifest(dataset_id="gfs")


def test_current_manifest_with_wrong_cycle_is_rejected() -> None:
    with temp_artifact_fixture() as artifacts:
        manifest = manifest_payload(
            cycle="2026051106",
            generated_at=GENERATED_AT,
        )
        artifacts.store.write_bytes(
            uri=artifacts.paths.cycle_current_manifest_uri(dataset_id="gfs", cycle="2026051112"),
            data=json.dumps(manifest).encode("utf-8"),
        )

        with pytest.raises(SystemExit, match="current manifest cycle mismatch"):
            artifacts.repository.read_cycle_current_manifest(dataset_id="gfs", cycle="2026051112")
