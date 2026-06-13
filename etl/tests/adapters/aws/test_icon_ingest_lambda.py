from __future__ import annotations

import json
import os
from unittest.mock import patch

import pytest
from tests.fixtures.artifacts import (
    DEFAULT_PRODUCT_CONFIG_DIGEST,
    DEFAULT_RUN_ID,
    artifact_marker_payload,
)
from tests.fixtures.aws import FakeBatchClient, FakeDynamoClient
from weather_etl.adapters.aws import icon_ingest_lambda
from weather_etl.config.sources import ICON_DWD_SOURCE_TYPE
from weather_etl.sources.submission import SourceSubmissionOutcome, SourceSubmissionResult
from weather_etl.state.artifacts.identity import ArtifactWorkItem
from weather_etl.state.artifacts.paths import ArtifactPaths


class _FakeStore:
    def __init__(self, listed: set[str] | None = None, objects: dict[str, bytes] | None = None) -> None:
        self.listed = listed or set()
        self.objects = objects or {}

    def list_prefix(self, *, prefix_uri: str) -> list[str]:
        return sorted(uri for uri in {*self.listed, *self.objects} if uri.startswith(prefix_uri))

    def read_bytes(self, *, uri: str) -> bytes:
        if uri in self.objects:
            return self.objects[uri]
        raise FileNotFoundError(uri)

    def write_bytes(self, *, uri: str, data: bytes) -> None:
        raise AssertionError(f"unexpected write: {uri}")

    def exists(self, *, uri: str) -> bool:
        return uri in self.listed or uri in self.objects

    def get_to_file(self, *, uri: str, dst) -> None:
        raise AssertionError(f"unexpected get_to_file: {uri}")

    def put_file(self, *, uri: str, src) -> None:
        raise AssertionError(f"unexpected put_file: {uri}")


def _event() -> dict[str, str]:
    return {"time": "2026-05-11T12:00:00Z"}


def _env() -> dict[str, str]:
    return {
        "ARTIFACT_ROOT_URI": "s3://artifacts",
        "BATCH_JOB_QUEUE": "weather-etl",
        "BATCH_JOB_DEFINITION": "weather-etl-worker-icon:1",
        "ICON_POLL_CYCLE_COUNT": "1",
        "ICON_READY_MIN_BYTES": "1",
        "ICON_SENTINEL_PARAMS": "t_2m",
        "FRAME_CLAIM_TABLE": "frame-claims",
        "PIPELINE_URI": "file:///tmp/config.json",
        "RUN_COORDINATOR_TABLE": "run-coordinator",
    }


class TestIconIngest:
    @pytest.fixture(autouse=True)
    def setup_handler(self, loaded_run_snapshot_factory, monkeypatch: pytest.MonkeyPatch) -> None:
        self.batch = FakeBatchClient()
        self.ddb = FakeDynamoClient()
        self.store = _FakeStore()
        monkeypatch.setattr(
            "weather_etl.operations.submit_icon_ready.generate_run_id",
            lambda *, now=None: DEFAULT_RUN_ID,
        )
        self.loaded_snapshot = loaded_run_snapshot_factory(
            dataset_id="icon",
            source_types={"icon": ICON_DWD_SOURCE_TYPE},
            frame_start=1,
            frame_end=1,
            cycle="2026051112",
        )

    def _run(self, *, ready) -> dict:
        def fake_client(name: str):
            if name == "batch":
                return self.batch
            if name == "dynamodb":
                return self.ddb
            raise AssertionError(f"unexpected boto3 client: {name}")

        with (
            patch.dict(os.environ, _env(), clear=False),
            patch("weather_etl.environment.ensure_or_load_run_snapshot", return_value=self.loaded_snapshot),
            patch("weather_etl.operations.submit_icon_ready._url_ready", side_effect=ready),
            patch("weather_etl.adapters.aws.icon_ingest_lambda.make_store", return_value=self.store),
            patch("weather_etl.adapters.aws.icon_ingest_lambda.boto3.client", side_effect=fake_client),
        ):
            return icon_ingest_lambda.handler(_event(), None)

    def test_handler_delegates_poll_settings_to_command(self) -> None:
        def fake_client(name: str):
            if name == "batch":
                return self.batch
            if name == "dynamodb":
                return self.ddb
            raise AssertionError(f"unexpected boto3 client: {name}")

        with (
            patch.dict(os.environ, _env(), clear=False),
            patch("weather_etl.adapters.aws.icon_ingest_lambda.make_store", return_value=self.store),
            patch("weather_etl.adapters.aws.icon_ingest_lambda.boto3.client", side_effect=fake_client),
            patch(
                "weather_etl.adapters.aws.icon_ingest_lambda.submit_ready_icon_cycles",
                return_value=SourceSubmissionResult.from_outcomes(
                    SourceSubmissionOutcome(
                        status="submitted",
                        scope="frame",
                        dataset_id="icon",
                        cycle="2026051112",
                        run_id=DEFAULT_RUN_ID,
                        frame_id="001",
                    ),
                    cycles=1,
                ),
            ) as submit_ready,
        ):
            result = icon_ingest_lambda.handler(_event(), None)

        assert result["submitted"] == 1
        assert submit_ready.call_args.kwargs["queue"] == "weather-etl"
        assert submit_ready.call_args.kwargs["cycles"] == ("2026051112",)
        assert submit_ready.call_args.kwargs["sentinel_params"] == ("t_2m",)
        assert submit_ready.call_args.kwargs["min_bytes"] == 1

    def test_missing_sentinel_does_not_submit(self) -> None:
        result = self._run(ready=lambda url, min_bytes: False)

        assert result["submitted"] == 0
        assert result["pending"] == 0
        assert result["skipped_cycles"] == 1
        assert self.batch.submissions == []

    def test_ready_hour_submits_icon_batch_job(self) -> None:
        result = self._run(ready=lambda url, min_bytes: True)

        assert result["submitted"] == 1
        submission = self.batch.submissions[0]
        assert submission["jobQueue"] == "weather-etl"
        assert submission["jobDefinition"] == "weather-etl-worker-icon:1"
        env = {item["name"]: item["value"] for item in submission["containerOverrides"]["environment"]}
        assert env["DATASET_ID"] == "icon"
        assert env["CYCLE"] == "2026051112"
        assert env["RUN_ID"] == DEFAULT_RUN_ID
        assert env["FRAME_ID"] == "001"
        assert (
            env["PIPELINE_URI"]
            == f"s3://artifacts/runs/icon/2026051112/{DEFAULT_RUN_ID}/config/pipeline.json"
        )
        assert (
            env["CATALOG_URI"]
            == f"s3://artifacts/runs/icon/2026051112/{DEFAULT_RUN_ID}/config/catalog.json"
        )
        assert "GRIB_SOURCE_URI" not in env
        claim_update = next(update for update in self.ddb.updates if "#state = :claimed" in update["UpdateExpression"])
        assert "#cycle = :cycle" in claim_update["UpdateExpression"]
        assert claim_update["ExpressionAttributeNames"]["#cycle"] == "cycle"
        assert self.ddb.items["icon#2026051112"]["run_id"] == DEFAULT_RUN_ID

    def test_active_claim_blocks_duplicate_submit(self) -> None:
        self.ddb.items[f"icon#2026051112#{DEFAULT_RUN_ID}#001"] = {
            "expires_at_epoch": 2000000000,
            "attempt": 1,
            "state": "claimed",
        }

        result = self._run(ready=lambda url, min_bytes: True)

        assert result["submitted"] == 0
        assert result["claimed"] == 1
        assert self.batch.submissions == []

    def test_stale_claim_allows_resubmission(self) -> None:
        self.ddb.items[f"icon#2026051112#{DEFAULT_RUN_ID}#001"] = {
            "expires_at_epoch": 1,
            "attempt": 1,
            "state": "claimed",
        }

        result = self._run(ready=lambda url, min_bytes: True)

        assert result["submitted"] == 1
        assert self.ddb.items[f"icon#2026051112#{DEFAULT_RUN_ID}#001"]["attempt"] == 2

    def test_completed_markers_skip_work(self) -> None:
        paths = ArtifactPaths("s3://artifacts")
        marker_uri = paths.success_marker_uri_parts(
            dataset_id="icon",
            cycle="2026051112",
            run_id=DEFAULT_RUN_ID,
            frame_id="001",
            artifact_id="tmp_surface",
        )
        payload_uri = paths.payload_uri(
            ArtifactWorkItem(
                dataset_id="icon",
                cycle="2026051112",
                run_id=DEFAULT_RUN_ID,
                frame_id="001",
                artifact_id="tmp_surface",
                source_uri="test://icon",
                product_config_digest=DEFAULT_PRODUCT_CONFIG_DIGEST,
            ),
            dtype="int16",
        )
        self.store = _FakeStore(
            objects={
                marker_uri: json.dumps(
                    {
                        "schema": "weather-map.etl-artifact-success",
                        "schema_version": 2,
                        "dataset_id": "icon",
                        "cycle": "2026051112",
                        "run_id": DEFAULT_RUN_ID,
                        "frame_id": "001",
                        "artifact_id": "tmp_surface",
                        "generated_at": "2026-05-11T12:00:00Z",
                        "code_revision": "test",
                        "image_identity": "test",
                        "product_config_digest": DEFAULT_PRODUCT_CONFIG_DIGEST,
                        "artifact": artifact_marker_payload(
                            payload_uri=payload_uri,
                            encoding_id="tmp_surface_i16_v1",
                            parameter="tmp",
                            level="surface",
                        ),
                    }
                ).encode("utf-8")
            }
        )

        result = self._run(ready=lambda url, min_bytes: True)

        assert result["submitted"] == 0
        assert result["completed"] == 1
        assert self.ddb.items[f"icon#2026051112#{DEFAULT_RUN_ID}#001"]["state"] == "complete"
        complete_update = next(
            update for update in self.ddb.updates if "#state = :complete" in update["UpdateExpression"]
        )
        assert "#cycle = :cycle" in complete_update["UpdateExpression"]
        assert complete_update["ExpressionAttributeNames"]["#cycle"] == "cycle"

    def test_complete_cycle_response_omits_published_count(self) -> None:
        paths = ArtifactPaths("s3://artifacts")
        self.store = _FakeStore(
            {
                paths.success_marker_uri_parts(
                    dataset_id="icon",
                    cycle="2026051112",
                    run_id=DEFAULT_RUN_ID,
                    frame_id="001",
                    artifact_id="tmp_surface",
                )
            }
        )

        result = self._run(ready=lambda url, min_bytes: True)

        assert "published" not in result
