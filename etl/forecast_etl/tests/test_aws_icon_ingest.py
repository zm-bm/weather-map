from __future__ import annotations

import json
import os
import unittest
from dataclasses import dataclass
from unittest.mock import patch

from forecast_etl.artifacts.paths import ArtifactPaths, WorkItem
from forecast_etl.aws import icon_ingest
from forecast_etl.config.load import LoadedPipelineConfig
from forecast_etl.config.resolved import IconDwdConfig, IconDwdSourceConfig
from forecast_etl.run_snapshots import LoadedRunSnapshot
from forecast_etl.tests.fixtures.artifacts import DEFAULT_CONFIG_DIGEST, DEFAULT_RUN_ID, artifact_marker_payload


@dataclass(frozen=True)
class _FakeComponent:
    grib_match: dict[str, str] | None


@dataclass(frozen=True)
class _FakeEncoding:
    id: str = "encoding"
    format: str = "linear-i16-v1"
    dtype: str = "int16"


@dataclass(frozen=True)
class _FakeDerivationInput:
    id: str
    grib_match: dict[str, str]


@dataclass(frozen=True)
class _FakeArtifact:
    components: tuple[_FakeComponent, ...]
    derivation: object | None = None
    encoding: _FakeEncoding = _FakeEncoding()
    units: str = "C"
    parameter: str = "parameter"
    level: str = "level"

    @property
    def component_ids(self) -> tuple[str, ...]:
        return ("value",)


@dataclass(frozen=True)
class _FakeDerivation:
    type: str
    inputs: tuple[_FakeDerivationInput, ...] = ()


@dataclass(frozen=True)
class _FakeWorkload:
    frames: tuple[str, ...]
    artifacts: tuple[str, ...]


@dataclass(frozen=True)
class _FakeModel:
    id: str = "icon"
    label: str = "ICON"
    source: IconDwdSourceConfig = IconDwdSourceConfig(
        grid_id="icon_global_regridded_0p125",
        icon_dwd=IconDwdConfig(base_url="https://example.test/icon", rate_limit_seconds=0.0),
    )
    workload: _FakeWorkload = _FakeWorkload(frames=("001",), artifacts=("tmp_surface",))
    artifacts: dict[str, _FakeArtifact] | None = None

    def __post_init__(self) -> None:
        if self.artifacts is None:
            object.__setattr__(
                self,
                "artifacts",
                {"tmp_surface": _FakeArtifact(components=(_FakeComponent({"ICON_PARAM": "t_2m"}),))},
            )


class _FakePipelineConfig:
    def __init__(self, model: _FakeModel) -> None:
        self._model = model

    def dataset(self, dataset_id: str) -> _FakeModel:
        if dataset_id != "icon":
            raise SystemExit(f"Unknown dataset {dataset_id!r}")
        return self._model


def _loaded_snapshot(model: _FakeModel) -> LoadedRunSnapshot:
    return LoadedRunSnapshot(
        run_id=DEFAULT_RUN_ID,
        config_digest=DEFAULT_CONFIG_DIGEST,
        pipeline_config_uri=f"s3://artifacts/runs/icon/2026051112/{DEFAULT_RUN_ID}/config/pipeline_config.json",
        forecast_catalog_uri=f"s3://artifacts/runs/icon/2026051112/{DEFAULT_RUN_ID}/config/forecast_catalog.json",
        loaded_config=LoadedPipelineConfig(raw={"datasets": {"icon": {}}}, config=_FakePipelineConfig(model)),
        forecast_catalog={"catalogVersion": "test", "rasterLayers": []},
    )


class _FakeBatchClient:
    def __init__(self) -> None:
        self.submissions: list[dict] = []

    def submit_job(self, **kwargs) -> dict[str, str]:
        self.submissions.append(kwargs)
        return {"jobId": f"job-{len(self.submissions)}"}


class _ConditionalCheckFailedException(Exception):
    pass


class _FakeDynamoClient:
    class exceptions:
        ConditionalCheckFailedException = _ConditionalCheckFailedException

    def __init__(self) -> None:
        self.items: dict[str, dict[str, int | str]] = {}
        self.updates: list[dict] = []

    def update_item(self, **kwargs) -> dict:
        self.updates.append(kwargs)
        pk = kwargs["Key"]["pk"]["S"]
        now = int(kwargs.get("ExpressionAttributeValues", {}).get(":now", {"N": "0"})["N"])
        existing = self.items.get(pk)
        if kwargs.get("ConditionExpression") and existing is not None:
            expires_at = int(existing.get("expires_at_epoch", 0))
            state = str(existing.get("state", ""))
            if expires_at >= now and state == "claimed":
                raise _ConditionalCheckFailedException()

        values = kwargs.get("ExpressionAttributeValues", {})
        update_expression = kwargs.get("UpdateExpression", "")
        item = dict(existing or {})
        if ":dataset_id" in values:
            item.setdefault("dataset_id", values[":dataset_id"]["S"])
        if ":cycle" in values:
            if "if_not_exists(#cycle" in update_expression:
                item.setdefault("cycle", values[":cycle"]["S"])
            else:
                item["cycle"] = values[":cycle"]["S"]
        if ":frame_id" in values:
            item["frame_id"] = values[":frame_id"]["S"]
        if ":run_id" in values:
            if "if_not_exists(run_id" in update_expression:
                item.setdefault("run_id", DEFAULT_RUN_ID)
            else:
                item["run_id"] = values[":run_id"]["S"]
        if ":created_at" in values:
            item.setdefault("created_at", values[":created_at"]["S"])
        if ":ttl" in values:
            if "#ttl = if_not_exists" in update_expression:
                item.setdefault("ttl", int(values[":ttl"]["N"]))
            else:
                item["ttl"] = int(values[":ttl"]["N"])
        if ":expires_at_epoch" in values:
            item["expires_at_epoch"] = int(values[":expires_at_epoch"]["N"])
        if ":artifact_ids" in values:
            item["artifact_ids"] = values[":artifact_ids"]["S"]
        if ":worker_spec_hash" in values:
            item["worker_spec_hash"] = values[":worker_spec_hash"]["S"]
        if ":job_id" in values:
            item["job_id"] = values[":job_id"]["S"]
        if ":claimed" in values and ":claimed" in update_expression:
            item["state"] = values[":claimed"]["S"]
            item["attempt"] = int(item.get("attempt", 0)) + 1
        if ":submitted" in values and ":submitted" in update_expression:
            item["state"] = values[":submitted"]["S"]
        if ":complete" in values and ":complete" in update_expression:
            item["state"] = values[":complete"]["S"]
        self.items[pk] = item
        return {
            "Attributes": {
                "attempt": {"N": str(item.get("attempt", 1))},
                "run_id": {"S": str(item.get("run_id", DEFAULT_RUN_ID))},
            }
        }

    def get_item(self, **kwargs) -> dict:
        pk = kwargs["Key"]["pk"]["S"]
        item = self.items.get(pk)
        if item is None:
            return {}
        return {"Item": self._dynamo_item(item)}

    def _dynamo_item(self, item: dict[str, int | str]) -> dict:
        result = {}
        for key, value in item.items():
            if isinstance(value, int):
                result[key] = {"N": str(value)}
            else:
                result[key] = {"S": str(value)}
        return result


class _FakeStore:
    def __init__(self, listed: set[str] | None = None, objects: dict[str, bytes] | None = None) -> None:
        self.listed = listed or set()
        self.objects = objects or {}

    def list_prefix(self, *, prefix_uri: str) -> list[str]:
        return sorted(
            uri
            for uri in {*self.listed, *self.objects}
            if uri.startswith(prefix_uri)
        )

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
        "PIPELINE_CONFIG_URI": "file:///tmp/config.json",
        "RUN_COORDINATOR_TABLE": "run-coordinator",
    }


class IconIngestTest(unittest.TestCase):
    def setUp(self) -> None:
        self.batch = _FakeBatchClient()
        self.ddb = _FakeDynamoClient()
        self.store = _FakeStore()
        self.model = _FakeModel()

    def _run(self, *, ready) -> dict:
        def fake_client(name: str):
            if name == "batch":
                return self.batch
            if name == "dynamodb":
                return self.ddb
            raise AssertionError(f"unexpected boto3 client: {name}")

        with (
            patch.dict(os.environ, _env(), clear=False),
            patch("forecast_etl.workflows.context.ensure_or_load_run_snapshot", return_value=_loaded_snapshot(self.model)),
            patch("forecast_etl.aws.icon_ingest._url_ready", side_effect=ready),
            patch("forecast_etl.aws.icon_ingest.make_store", return_value=self.store),
            patch("forecast_etl.aws.icon_ingest.boto3.client", side_effect=fake_client),
        ):
            return icon_ingest.handler(_event(), None)

    def test_missing_sentinel_does_not_submit(self) -> None:
        result = self._run(ready=lambda url, min_bytes: False)

        self.assertEqual(result["submitted"], 0)
        self.assertEqual(result["skipped_cycles"], 1)
        self.assertEqual(self.batch.submissions, [])

    def test_partial_target_hour_does_not_submit(self) -> None:
        def ready(url, min_bytes):
            return "_000_" in url

        result = self._run(ready=ready)

        self.assertEqual(result["submitted"], 0)
        self.assertEqual(result["pending"], 1)
        self.assertEqual(self.batch.submissions, [])

    def test_derived_rate_waits_for_previous_hour_source(self) -> None:
        self.model = _FakeModel(
            workload=_FakeWorkload(frames=("003",), artifacts=("prate_surface",)),
            artifacts={
                "prate_surface": _FakeArtifact(
                    components=(_FakeComponent(None),),
                    derivation=_FakeDerivation(
                        type="icon_tot_prec_delta_rate",
                        inputs=(
                            _FakeDerivationInput(id="total", grib_match={"ICON_PARAM": "tot_prec"}),
                        ),
                    ),
                )
            },
        )
        checked_urls: list[str] = []

        def ready(url, min_bytes):
            checked_urls.append(url)
            return "_002_" not in url

        result = self._run(ready=ready)

        self.assertEqual(result["submitted"], 0)
        self.assertEqual(result["pending"], 1)
        self.assertEqual(self.batch.submissions, [])
        self.assertTrue(any("_003_TOT_PREC" in url for url in checked_urls))
        self.assertTrue(any("_002_TOT_PREC" in url for url in checked_urls))

    def test_ready_hour_submits_icon_batch_job(self) -> None:
        result = self._run(ready=lambda url, min_bytes: True)

        self.assertEqual(result["submitted"], 1)
        submission = self.batch.submissions[0]
        self.assertEqual(submission["jobQueue"], "weather-etl")
        self.assertEqual(submission["jobDefinition"], "weather-etl-worker-icon:1")
        env = {item["name"]: item["value"] for item in submission["containerOverrides"]["environment"]}
        self.assertEqual(env["DATASET_ID"], "icon")
        self.assertEqual(env["CYCLE"], "2026051112")
        self.assertEqual(env["RUN_ID"], DEFAULT_RUN_ID)
        self.assertEqual(env["FRAME_ID"], "001")
        self.assertEqual(
            env["PIPELINE_CONFIG_URI"],
            f"s3://artifacts/runs/icon/2026051112/{DEFAULT_RUN_ID}/config/pipeline_config.json",
        )
        self.assertEqual(
            env["FORECAST_CATALOG_URI"],
            f"s3://artifacts/runs/icon/2026051112/{DEFAULT_RUN_ID}/config/forecast_catalog.json",
        )
        self.assertNotIn("GRIB_SOURCE_URI", env)
        claim_update = next(
            update for update in self.ddb.updates if "#state = :claimed" in update["UpdateExpression"]
        )
        self.assertIn("#cycle = :cycle", claim_update["UpdateExpression"])
        self.assertEqual(claim_update["ExpressionAttributeNames"]["#cycle"], "cycle")
        self.assertEqual(self.ddb.items["icon#2026051112"]["run_id"], DEFAULT_RUN_ID)

    def test_active_claim_blocks_duplicate_submit(self) -> None:
        self.ddb.items[f"icon#2026051112#{DEFAULT_RUN_ID}#001"] = {
            "expires_at_epoch": 2000000000,
            "attempt": 1,
            "state": "claimed",
        }

        result = self._run(ready=lambda url, min_bytes: True)

        self.assertEqual(result["submitted"], 0)
        self.assertEqual(result["claimed"], 1)
        self.assertEqual(self.batch.submissions, [])

    def test_stale_claim_allows_resubmission(self) -> None:
        self.ddb.items[f"icon#2026051112#{DEFAULT_RUN_ID}#001"] = {
            "expires_at_epoch": 1,
            "attempt": 1,
            "state": "claimed",
        }

        result = self._run(ready=lambda url, min_bytes: True)

        self.assertEqual(result["submitted"], 1)
        self.assertEqual(self.ddb.items[f"icon#2026051112#{DEFAULT_RUN_ID}#001"]["attempt"], 2)

    def test_completed_markers_skip_work(self) -> None:
        paths = ArtifactPaths("s3://artifacts")
        marker_uri = paths.success_marker_uri_parts(
            dataset_id="icon",
            cycle="2026051112",
            run_id=DEFAULT_RUN_ID,
            frame_id="001",
            artifact_id="tmp_surface",
        )
        payload_uri = paths.output_field_payload_uri(
            WorkItem(
                dataset_id="icon",
                cycle="2026051112",
                run_id=DEFAULT_RUN_ID,
                frame_id="001",
                artifact_id="tmp_surface",
                source_uri="test://icon",
            ),
            dtype="int16",
        )
        self.store = _FakeStore(
            objects={
                marker_uri: json.dumps(
                    {
                        "dataset_id": "icon",
                        "cycle": "2026051112",
                        "run_id": DEFAULT_RUN_ID,
                        "frame_id": "001",
                        "artifact_id": "tmp_surface",
                        "code_revision": "test",
                        "image_identity": "test",
                        "config_digest": DEFAULT_CONFIG_DIGEST,
                        "artifact": artifact_marker_payload(payload_uri=payload_uri),
                    }
                ).encode("utf-8")
            }
        )

        result = self._run(ready=lambda url, min_bytes: True)

        self.assertEqual(result["submitted"], 0)
        self.assertEqual(result["completed"], 1)
        self.assertEqual(self.ddb.items[f"icon#2026051112#{DEFAULT_RUN_ID}#001"]["state"], "complete")
        complete_update = next(
            update for update in self.ddb.updates if "#state = :complete" in update["UpdateExpression"]
        )
        self.assertIn("#cycle = :cycle", complete_update["UpdateExpression"])
        self.assertEqual(complete_update["ExpressionAttributeNames"]["#cycle"], "cycle")

    def test_older_than_latest_cycle_skips_before_run_coordination(self) -> None:
        self.store = _FakeStore(
            objects={
                "s3://artifacts/manifests/icon/latest.json": json.dumps(
                    {"run": {"cycle": "2026051118"}}
                ).encode("utf-8")
            }
        )

        result = self._run(ready=lambda url, min_bytes: True)

        self.assertEqual(result["submitted"], 0)
        self.assertEqual(result["skipped_cycles"], 1)
        self.assertEqual(self.batch.submissions, [])
        self.assertEqual(self.ddb.updates, [])

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

        self.assertNotIn("published", result)


if __name__ == "__main__":
    unittest.main()
