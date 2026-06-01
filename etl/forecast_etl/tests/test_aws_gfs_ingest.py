from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from forecast_etl.aws import gfs_ingest
from forecast_etl.config.load import LoadedPipelineConfig
from forecast_etl.run_snapshots import LoadedRunSnapshot
from forecast_etl.tests.fixtures.artifact_configs import wind_artifact_config
from forecast_etl.tests.fixtures.artifacts import DEFAULT_RUN_ID, temp_artifact_fixture
from forecast_etl.tests.fixtures.pipeline import add_model_artifact, minimal_pipeline_config


class _FakeBatchClient:
    def __init__(self) -> None:
        self.submissions: list[dict] = []

    def submit_job(self, **kwargs) -> None:
        self.submissions.append(kwargs)


class _FakeDynamoClient:
    def __init__(self) -> None:
        self.items: dict[str, dict[str, str]] = {}
        self.updates: list[dict] = []

    def update_item(self, **kwargs) -> dict:
        self.updates.append(kwargs)
        pk = kwargs["Key"]["pk"]["S"]
        item = dict(self.items.get(pk, {}))
        values = kwargs.get("ExpressionAttributeValues", {})
        item.setdefault("model", values[":model"]["S"])
        item.setdefault("cycle", values[":cycle"]["S"])
        item.setdefault("runId", DEFAULT_RUN_ID)
        item.setdefault("createdAt", values[":created_at"]["S"])
        item.setdefault("ttl", values[":ttl"]["N"])
        self.items[pk] = item
        return {
            "Attributes": {
                "runId": {"S": item["runId"]},
            }
        }


class _FakeWorkload:
    def __init__(self, *, forecast_hours: tuple[str, ...], artifacts: tuple[str, ...]) -> None:
        self.forecast_hours = forecast_hours
        self.artifacts = artifacts


class _FakePipelineConfig:
    def __init__(self, *, forecast_hours: tuple[str, ...], artifacts: tuple[str, ...]) -> None:
        self.workload = _FakeWorkload(forecast_hours=forecast_hours, artifacts=artifacts)

    def model(self, model_id: str) -> "_FakePipelineConfig":
        if model_id != "gfs":
            raise SystemExit(f"Unknown model {model_id!r}")
        return self


def _loaded_snapshot(cfg: _FakePipelineConfig) -> LoadedRunSnapshot:
    return LoadedRunSnapshot(
        run_id=DEFAULT_RUN_ID,
        config_digest="sha256:" + "1" * 64,
        pipeline_config_uri=f"s3://artifacts/runs/gfs/2026021300/{DEFAULT_RUN_ID}/config/pipeline_config.json",
        forecast_catalog_uri=f"s3://artifacts/runs/gfs/2026021300/{DEFAULT_RUN_ID}/config/forecast_catalog.json",
        loaded_config=LoadedPipelineConfig(raw={"models": {"gfs": {}}}, config=cfg),
        forecast_catalog={"catalogVersion": "test", "rasterLayers": []},
    )


def _sns_event(key: str) -> dict:
    return {
        "Records": [
            {
                "EventSource": "aws:sns",
                "Sns": {
                    "Message": json.dumps(
                        {
                            "Records": [
                                {
                                    "s3": {
                                        "bucket": {"name": "noaa-gfs-bdp-pds"},
                                        "object": {"key": key},
                                    }
                                }
                            ]
                        }
                    )
                },
            }
        ]
    }


class AwsGfsIngestTest(unittest.TestCase):
    def setUp(self) -> None:
        self.batch = _FakeBatchClient()
        self.ddb = _FakeDynamoClient()
        self.artifact_root = tempfile.TemporaryDirectory()
        self.addCleanup(self.artifact_root.cleanup)
        self.env_patch = patch.dict(
            os.environ,
            {
                "ARTIFACT_ROOT_URI": f"file://{Path(self.artifact_root.name).as_posix()}",
                "BATCH_JOB_QUEUE": "weather-etl",
                "BATCH_JOB_DEFINITION": "weather-etl-worker:1",
                "RUN_COORDINATOR_TABLE": "run-coordinator",
            },
            clear=False,
        )
        self.env_patch.start()

    def tearDown(self) -> None:
        self.env_patch.stop()

    def test_handler_submits_job_for_current_pipeline_config_schema(self) -> None:
        payload = minimal_pipeline_config()
        wind_config = wind_artifact_config()
        add_model_artifact(
            payload,
            model_id="gfs",
            artifact_id="wind10m_uv",
            artifact_config=wind_config,
        )
        payload["models"]["gfs"]["workload"]["forecast_hour_end"] = 6
        payload["models"]["gfs"]["workload"]["artifacts"] = ["tmp_surface", "wind10m_uv"]

        with tempfile.TemporaryDirectory(prefix="weather-map-aws-ingest-") as td:
            cfg_path = Path(td) / "pipeline_config.json"
            catalog_path = Path(td) / "forecast_catalog.json"
            artifact_root = Path(td) / "artifacts"
            cfg_path.write_text(json.dumps(payload), encoding="utf-8")
            catalog_path.write_text('{"catalogVersion":"test","rasterLayers":[]}\n', encoding="utf-8")
            with (
                patch.dict(
                    os.environ,
                    {
                        "ARTIFACT_ROOT_URI": f"file://{artifact_root.as_posix()}",
                        "PIPELINE_CONFIG_URI": f"file://{cfg_path.as_posix()}",
                        "FORECAST_CATALOG_URI": f"file://{catalog_path.as_posix()}",
                    },
                    clear=False,
                ),
                patch("forecast_etl.aws.gfs_ingest.boto3.client", side_effect=self._client),
            ):
                result = gfs_ingest.handler(
                    _sns_event("gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003"),
                    None,
                )

        self.assertEqual(result, {"ok": True, "submitted": 1, "seen": 1})
        self.assertEqual(len(self.batch.submissions), 1)
        submission = self.batch.submissions[0]
        self.assertEqual(submission["jobQueue"], "weather-etl")
        self.assertEqual(submission["jobDefinition"], "weather-etl-worker:1")
        env = {item["name"]: item["value"] for item in submission["containerOverrides"]["environment"]}
        self.assertEqual(env["CYCLE"], "2026021300")
        self.assertEqual(env["RUN_ID"], DEFAULT_RUN_ID)
        self.assertEqual(env["FHOUR"], "003")
        self.assertEqual(env["MODEL"], "gfs")
        self.assertEqual(
            env["GRIB_SOURCE_URI"],
            "s3://noaa-gfs-bdp-pds/gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003",
        )
        self.assertEqual(
            env["PIPELINE_CONFIG_URI"],
            f"file://{artifact_root.as_posix()}/runs/gfs/2026021300/{DEFAULT_RUN_ID}/config/pipeline_config.json",
        )
        self.assertEqual(
            env["FORECAST_CATALOG_URI"],
            f"file://{artifact_root.as_posix()}/runs/gfs/2026021300/{DEFAULT_RUN_ID}/config/forecast_catalog.json",
        )
        self.assertEqual(self.ddb.items["gfs#2026021300"]["runId"], DEFAULT_RUN_ID)

    def test_handler_filters_by_forecast_hour(self) -> None:
        fake_cfg = _FakePipelineConfig(
            forecast_hours=("000", "003"),
            artifacts=("tmp_surface",),
        )
        with (
            patch("forecast_etl.aws.gfs_ingest.ensure_or_load_run_snapshot", return_value=_loaded_snapshot(fake_cfg)),
            patch("forecast_etl.aws.gfs_ingest.boto3.client", side_effect=self._client),
        ):
            result = gfs_ingest.handler(
                _sns_event("gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f006"),
                None,
            )

        self.assertEqual(result, {"ok": True, "submitted": 0, "seen": 1})
        self.assertEqual(self.batch.submissions, [])

    def test_handler_skips_when_no_work_items_are_configured(self) -> None:
        fake_cfg = _FakePipelineConfig(
            forecast_hours=("000",),
            artifacts=(),
        )
        with (
            patch("forecast_etl.aws.gfs_ingest.ensure_or_load_run_snapshot", return_value=_loaded_snapshot(fake_cfg)),
            patch("forecast_etl.aws.gfs_ingest.boto3.client", side_effect=self._client),
        ):
            result = gfs_ingest.handler(
                _sns_event("gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f000"),
                None,
            )

        self.assertEqual(result, {"ok": True, "submitted": 0, "seen": 1})
        self.assertEqual(self.batch.submissions, [])

    def test_handler_preserves_cycle_cadence_filter(self) -> None:
        fake_cfg = _FakePipelineConfig(
            forecast_hours=("000",),
            artifacts=("tmp_surface", "wind10m_uv"),
        )
        with (
            patch("forecast_etl.aws.gfs_ingest.ensure_or_load_run_snapshot", return_value=_loaded_snapshot(fake_cfg)),
            patch("forecast_etl.aws.gfs_ingest.boto3.client", side_effect=self._client),
        ):
            result = gfs_ingest.handler(
                _sns_event("gfs.20260213/03/atmos/gfs.t03z.pgrb2.0p25.f000"),
                None,
            )

        self.assertEqual(result, {"ok": True, "submitted": 0, "seen": 1})
        self.assertEqual(self.batch.submissions, [])

    def test_handler_skips_unknown_key_formats(self) -> None:
        fake_cfg = _FakePipelineConfig(
            forecast_hours=("000",),
            artifacts=("tmp_surface", "wind10m_uv"),
        )
        with (
            patch("forecast_etl.aws.gfs_ingest.ensure_or_load_run_snapshot", return_value=_loaded_snapshot(fake_cfg)),
            patch("forecast_etl.aws.gfs_ingest.boto3.client", side_effect=self._client),
        ):
            result = gfs_ingest.handler(
                _sns_event("gfs.20260213/00/atmos/not-a-match.grib2"),
                None,
            )

        self.assertEqual(result, {"ok": True, "submitted": 0, "seen": 1})
        self.assertEqual(self.batch.submissions, [])

    def test_handler_reuses_existing_run_id_for_same_cycle(self) -> None:
        self.ddb.items["gfs#2026021300"] = {"runId": "20260213T010203Z-abcdef12"}
        fake_cfg = _FakePipelineConfig(
            forecast_hours=("000", "003"),
            artifacts=("tmp_surface",),
        )
        with (
            patch("forecast_etl.aws.gfs_ingest.ensure_or_load_run_snapshot", return_value=_loaded_snapshot(fake_cfg)),
            patch("forecast_etl.aws.gfs_ingest.boto3.client", side_effect=self._client),
        ):
            result = gfs_ingest.handler(
                _sns_event("gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003"),
                None,
            )

        self.assertEqual(result["submitted"], 1)
        env = {
            item["name"]: item["value"]
            for item in self.batch.submissions[0]["containerOverrides"]["environment"]
        }
        self.assertEqual(env["RUN_ID"], "20260213T010203Z-abcdef12")

    def test_handler_skips_older_than_latest_cycle(self) -> None:
        with temp_artifact_fixture() as artifacts:
            artifacts.write_manifest(
                model_id="gfs",
                cycle="2026021306",
                generated_at=datetime(2026, 2, 13, 6, tzinfo=timezone.utc),
            )
            with (
                patch.dict(os.environ, {"ARTIFACT_ROOT_URI": artifacts.paths.artifact_root_uri}, clear=False),
                patch("forecast_etl.aws.gfs_ingest.ensure_or_load_run_snapshot") as ensure_snapshot,
                patch("forecast_etl.aws.gfs_ingest.boto3.client", side_effect=self._client),
            ):
                result = gfs_ingest.handler(
                    _sns_event("gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003"),
                    None,
                )

        self.assertEqual(result, {"ok": True, "submitted": 0, "seen": 1})
        self.assertEqual(self.batch.submissions, [])
        self.assertEqual(self.ddb.updates, [])
        ensure_snapshot.assert_not_called()

    def _client(self, name: str):
        if name == "batch":
            return self.batch
        if name == "dynamodb":
            return self.ddb
        raise AssertionError(f"unexpected boto3 client: {name}")
