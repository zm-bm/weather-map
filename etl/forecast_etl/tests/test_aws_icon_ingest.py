from __future__ import annotations

import os
import unittest
from dataclasses import dataclass
from unittest.mock import patch

from forecast_etl.artifacts.paths import ArtifactPaths
from forecast_etl.aws import icon_ingest
from forecast_etl.config.resolved import IconDwdConfig, IconDwdSourceConfig


@dataclass(frozen=True)
class _FakeComponent:
    grib_match: dict[str, str] | None


@dataclass(frozen=True)
class _FakeDerivationInput:
    id: str
    grib_match: dict[str, str]


@dataclass(frozen=True)
class _FakeArtifact:
    components: tuple[_FakeComponent, ...]
    derivation: object | None = None


@dataclass(frozen=True)
class _FakeDerivation:
    type: str
    inputs: tuple[_FakeDerivationInput, ...] = ()


@dataclass(frozen=True)
class _FakeWorkload:
    forecast_hours: tuple[str, ...]
    artifacts: tuple[str, ...]


@dataclass(frozen=True)
class _FakeModel:
    id: str = "icon"
    label: str = "ICON"
    source: IconDwdSourceConfig = IconDwdSourceConfig(
        grid_id="icon_global_regridded_0p125",
        icon_dwd=IconDwdConfig(base_url="https://example.test/icon", rate_limit_seconds=0.0),
    )
    workload: _FakeWorkload = _FakeWorkload(forecast_hours=("001",), artifacts=("tmp_surface",))
    artifacts: dict[str, _FakeArtifact] | None = None

    def __post_init__(self) -> None:
        if self.artifacts is None:
            object.__setattr__(
                self,
                "artifacts",
                {"tmp_surface": _FakeArtifact(components=(_FakeComponent({"ICON_PARAM": "t_2m"}),))},
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
            lease_until = int(existing.get("leaseUntil", 0))
            if lease_until >= now:
                raise _ConditionalCheckFailedException()

        values = kwargs.get("ExpressionAttributeValues", {})
        update_expression = kwargs.get("UpdateExpression", "")
        item = dict(existing or {})
        if ":cycle" in values:
            item["cycle"] = values[":cycle"]["S"]
        if ":fhour" in values:
            item["fhour"] = values[":fhour"]["S"]
        if ":lease_until" in values:
            item["leaseUntil"] = int(values[":lease_until"]["N"])
        if ":job_id" in values:
            item["jobId"] = values[":job_id"]["S"]
        if ":processing" in values and ":processing" in update_expression:
            item["state"] = values[":processing"]["S"]
            item["attempt"] = int(item.get("attempt", 0)) + 1
        if ":submitted" in values and ":submitted" in update_expression:
            item["state"] = values[":submitted"]["S"]
        if ":complete" in values and ":complete" in update_expression:
            item["state"] = values[":complete"]["S"]
        self.items[pk] = item
        return {"Attributes": {"attempt": {"N": str(item.get("attempt", 1))}}}


class _FakeStore:
    def __init__(self, listed: set[str] | None = None) -> None:
        self.listed = listed or set()

    def list_prefix(self, *, prefix_uri: str) -> list[str]:
        return sorted(uri for uri in self.listed if uri.startswith(prefix_uri))

    def read_bytes(self, *, uri: str) -> bytes:
        raise AssertionError(f"unexpected read: {uri}")

    def write_bytes(self, *, uri: str, data: bytes) -> None:
        raise AssertionError(f"unexpected write: {uri}")

    def exists(self, *, uri: str) -> bool:
        return uri in self.listed

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
        "ICON_STATE_TABLE": "icon-state",
        "PIPELINE_CONFIG_URI": "file:///tmp/config.json",
    }


class IconIngestTest(unittest.TestCase):
    def setUp(self) -> None:
        icon_ingest._CONFIG_CACHE_BY_URI.clear()
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
            patch("forecast_etl.aws.icon_ingest._model", return_value=self.model),
            patch("forecast_etl.aws.icon_ingest._url_ready", side_effect=ready),
            patch("forecast_etl.aws.icon_ingest.make_store", return_value=self.store),
            patch("forecast_etl.aws.icon_ingest.boto3.client", side_effect=fake_client),
        ):
            return icon_ingest.handler(_event(), None)

    def test_missing_sentinel_does_not_submit(self) -> None:
        result = self._run(ready=lambda url, min_bytes: False)

        self.assertEqual(result["submitted"], 0)
        self.assertEqual(result["skippedCycles"], 1)
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
            workload=_FakeWorkload(forecast_hours=("003",), artifacts=("prate_surface",)),
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
        self.assertEqual(env["MODEL"], "icon")
        self.assertEqual(env["CYCLE"], "2026051112")
        self.assertEqual(env["FHOUR"], "001")
        self.assertEqual(env["PIPELINE_CONFIG_URI"], "file:///tmp/config.json")
        self.assertNotIn("GRIB_SOURCE_URI", env)
        lease_update = self.ddb.updates[0]
        self.assertIn("#cycle = :cycle", lease_update["UpdateExpression"])
        self.assertEqual(lease_update["ExpressionAttributeNames"]["#cycle"], "cycle")

    def test_active_lease_blocks_duplicate_submit(self) -> None:
        self.ddb.items["icon#2026051112#001"] = {"leaseUntil": 2000000000, "attempt": 1}

        result = self._run(ready=lambda url, min_bytes: True)

        self.assertEqual(result["submitted"], 0)
        self.assertEqual(result["leased"], 1)
        self.assertEqual(self.batch.submissions, [])

    def test_stale_lease_allows_resubmission(self) -> None:
        self.ddb.items["icon#2026051112#001"] = {"leaseUntil": 1, "attempt": 1}

        result = self._run(ready=lambda url, min_bytes: True)

        self.assertEqual(result["submitted"], 1)
        self.assertEqual(self.ddb.items["icon#2026051112#001"]["attempt"], 2)

    def test_completed_markers_skip_work(self) -> None:
        paths = ArtifactPaths("s3://artifacts")
        self.store = _FakeStore(
            {
                paths.success_marker_uri_parts(
                    model_id="icon",
                    cycle="2026051112",
                    fhour="001",
                    artifact_id="tmp_surface",
                )
            }
        )

        result = self._run(ready=lambda url, min_bytes: True)

        self.assertEqual(result["submitted"], 0)
        self.assertEqual(result["completed"], 1)
        self.assertEqual(self.ddb.items["icon#2026051112#001"]["state"], "complete")
        complete_update = self.ddb.updates[0]
        self.assertIn("#cycle = :cycle", complete_update["UpdateExpression"])
        self.assertEqual(complete_update["ExpressionAttributeNames"]["#cycle"], "cycle")

    def test_complete_cycle_response_omits_published_count(self) -> None:
        paths = ArtifactPaths("s3://artifacts")
        self.store = _FakeStore(
            {
                paths.success_marker_uri_parts(
                    model_id="icon",
                    cycle="2026051112",
                    fhour="001",
                    artifact_id="tmp_surface",
                )
            }
        )

        result = self._run(ready=lambda url, min_bytes: True)

        self.assertNotIn("published", result)


if __name__ == "__main__":
    unittest.main()
