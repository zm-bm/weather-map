from __future__ import annotations

import io
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone

from forecast_etl import cli
from forecast_etl.backfill import check_backfill_safety
from forecast_etl.manifest.pointers import LATEST_POINTER_SCHEMA, manifest_pointer_dict
from forecast_etl.tests.fixtures.artifacts import DEFAULT_RUN_ID, manifest_payload, temp_artifact_fixture


class BackfillSafetyTest(unittest.TestCase):
    def test_missing_latest_allows_bootstrap_submit(self) -> None:
        with temp_artifact_fixture() as artifacts:
            result = check_backfill_safety(
                artifact_repo=artifacts.repository,
                dataset_id="gfs",
                cycle="2026051100",
            )

        self.assertTrue(result.ok)
        self.assertEqual(result.latest_status, "missing")
        self.assertFalse(result.backfill_required)

    def test_equal_or_newer_cycle_allows_submit(self) -> None:
        with temp_artifact_fixture() as artifacts:
            artifacts.write_manifest(
                dataset_id="gfs",
                cycle="2026051100",
                generated_at=datetime(2026, 5, 11, tzinfo=timezone.utc),
            )

            equal = check_backfill_safety(
                artifact_repo=artifacts.repository,
                dataset_id="gfs",
                cycle="2026051100",
            )
            newer = check_backfill_safety(
                artifact_repo=artifacts.repository,
                dataset_id="gfs",
                cycle="2026051106",
            )

        self.assertTrue(equal.ok)
        self.assertTrue(newer.ok)
        self.assertFalse(equal.backfill_required)
        self.assertFalse(newer.backfill_required)

    def test_older_cycle_requires_backfill_flag(self) -> None:
        with temp_artifact_fixture() as artifacts:
            artifacts.write_manifest(
                dataset_id="gfs",
                cycle="2026051106",
                generated_at=datetime(2026, 5, 11, tzinfo=timezone.utc),
            )

            blocked = check_backfill_safety(
                artifact_repo=artifacts.repository,
                dataset_id="gfs",
                cycle="2026051100",
            )
            allowed = check_backfill_safety(
                artifact_repo=artifacts.repository,
                dataset_id="gfs",
                cycle="2026051100",
                allow_backfill=True,
            )

        self.assertFalse(blocked.ok)
        self.assertEqual(blocked.latest_cycle, "2026051106")
        self.assertTrue(blocked.backfill_required)
        self.assertTrue(allowed.ok)
        self.assertTrue(allowed.backfill_required)
        self.assertTrue(allowed.backfill_allowed)

    def test_latest_pointer_cycle_is_supported_without_dereferencing(self) -> None:
        generated_at = datetime(2026, 5, 11, tzinfo=timezone.utc)
        with temp_artifact_fixture() as artifacts:
            manifest = manifest_payload(cycle="2026051106", generated_at=generated_at, revision="abc123")
            public_uri = artifacts.repository.write_public_run_manifest(
                dataset_id="gfs",
                cycle="2026051106",
                run_id=DEFAULT_RUN_ID,
                manifest=manifest,
            )
            artifacts.repository.write_latest_pointer(
                dataset_id="gfs",
                pointer=manifest_pointer_dict(
                    schema_name=LATEST_POINTER_SCHEMA,
                    dataset_id="gfs",
                    cycle="2026051106",
                    run_id=DEFAULT_RUN_ID,
                    revision="abc123",
                    generated_at="2026-05-11T00:00:00Z",
                    manifest_path=artifacts.paths.relative_key(public_uri),
                ),
            )

            result = check_backfill_safety(
                artifact_repo=artifacts.repository,
                dataset_id="gfs",
                cycle="2026051100",
            )

        self.assertFalse(result.ok)
        self.assertEqual(result.latest_cycle, "2026051106")
        self.assertTrue(result.backfill_required)

    def test_malformed_latest_blocks_submit(self) -> None:
        with temp_artifact_fixture() as artifacts:
            artifacts.store.write_bytes(
                uri=artifacts.paths.manifest_latest_uri(dataset_id="gfs"),
                data=b'{"run": {"cycle": "not-a-cycle"}}\n',
            )

            result = check_backfill_safety(
                artifact_repo=artifacts.repository,
                dataset_id="gfs",
                cycle="2026051100",
            )

        self.assertFalse(result.ok)
        self.assertEqual(result.latest_status, "invalid")

    def test_cli_check_backfill_returns_not_ready_for_older_cycle(self) -> None:
        out = io.StringIO()
        with temp_artifact_fixture() as artifacts:
            artifacts.write_manifest(
                dataset_id="gfs",
                cycle="2026051106",
                generated_at=datetime(2026, 5, 11, tzinfo=timezone.utc),
            )

            with redirect_stdout(out):
                result = cli.main(
                    [
                        "check-backfill",
                        "--dataset-id",
                        "gfs",
                        "--cycle",
                        "2026051100",
                        "--artifact-root-uri",
                        artifacts.paths.artifact_root_uri,
                    ]
                )

        self.assertEqual(result, 2)
        self.assertIn("latest_cycle=2026051106", out.getvalue())
        self.assertIn("backfill_required=true", out.getvalue())
        self.assertIn("ok=false", out.getvalue())

    def test_cli_check_backfill_allows_explicit_backfill(self) -> None:
        out = io.StringIO()
        with temp_artifact_fixture() as artifacts:
            artifacts.write_manifest(
                dataset_id="gfs",
                cycle="2026051106",
                generated_at=datetime(2026, 5, 11, tzinfo=timezone.utc),
            )

            with redirect_stdout(out):
                result = cli.main(
                    [
                        "check-backfill",
                        "--dataset-id",
                        "gfs",
                        "--cycle",
                        "2026051100",
                        "--artifact-root-uri",
                        artifacts.paths.artifact_root_uri,
                        "--backfill",
                    ]
                )

        self.assertEqual(result, 0)
        self.assertIn("latest_cycle=2026051106", out.getvalue())
        self.assertIn("backfill_allowed=true", out.getvalue())
        self.assertIn("ok=true", out.getvalue())


if __name__ == "__main__":
    unittest.main()
