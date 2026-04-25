from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from gfs_pipeline.aws import ingest


class _FakeBatchClient:
    def __init__(self) -> None:
        self.submissions: list[dict] = []

    def submit_job(self, **kwargs) -> None:
        self.submissions.append(kwargs)


class _FakeWorkload:
    def __init__(self, *, forecast_hours: tuple[str, ...], variables: tuple[str, ...]) -> None:
        self.forecast_hours = forecast_hours
        self.variables = variables


class _FakePipelineConfig:
    def __init__(self, *, forecast_hours: tuple[str, ...], variables: tuple[str, ...], vector_variables: dict) -> None:
        self.workload = _FakeWorkload(forecast_hours=forecast_hours, variables=variables)
        self.vector_variables = vector_variables


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


class AwsIngestTest(unittest.TestCase):
    def setUp(self) -> None:
        ingest._FILTERS_CACHE_BY_URI.clear()
        self.batch = _FakeBatchClient()
        self.env_patch = patch.dict(
            os.environ,
            {
                "BATCH_JOB_QUEUE": "weather-etl",
                "BATCH_JOB_DEFINITION": "weather-etl-worker:1",
            },
            clear=False,
        )
        self.env_patch.start()

    def tearDown(self) -> None:
        self.env_patch.stop()

    def test_handler_submits_job_for_current_pipeline_config_schema(self) -> None:
        payload = {
            "version": 1,
            "workload": {
                "forecast_hours": ["000", "003", "006"],
                "variables": ["tmp_surface"],
            },
            "nomads": {
                "base_url": "https://example.test",
                "vars_levels": {},
                "rate_limit_seconds": 0.0,
            },
            "scalar_variables": {
                "tmp_surface": {
                    "parameter": "tmp",
                    "level": "surface",
                    "grib_match": {"GRIB_ELEMENT": "TMP"},
                    "units": "C",
                    "scale_min": -45,
                    "scale_max": 50,
                    "scalar_source_transform": "identity",
                    "scalar_encoding": {
                        "encoding_id": "tmp_surface_i16_v1",
                        "dtype": "int16",
                        "byte_order": "little",
                        "scale": 0.01,
                        "offset": 0.0,
                        "nodata": -32768,
                    },
                }
            },
            "vector_variables": {
                "wind10m_uv": {
                    "u_grib_match": {"GRIB_ELEMENT": "UGRD"},
                    "v_grib_match": {"GRIB_ELEMENT": "VGRD"},
                }
            },
        }

        with tempfile.TemporaryDirectory(prefix="weather-map-aws-ingest-") as td:
            cfg_path = Path(td) / "gfs.etl_config.json"
            cfg_path.write_text(json.dumps(payload), encoding="utf-8")
            with (
                patch.dict(os.environ, {"PIPELINE_CONFIG_URI": f"file://{cfg_path.as_posix()}"}, clear=False),
                patch("gfs_pipeline.aws.ingest.boto3.client", return_value=self.batch),
            ):
                result = ingest.handler(
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
        self.assertEqual(env["FHOUR"], "003")
        self.assertEqual(
            env["GRIB_SOURCE_URI"],
            "s3://noaa-gfs-bdp-pds/gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003",
        )
        self.assertNotIn("PIPELINE_CONFIG_URI", env)

    def test_handler_filters_by_forecast_hour(self) -> None:
        fake_cfg = _FakePipelineConfig(
            forecast_hours=("000", "003"),
            variables=("tmp_surface",),
            vector_variables={},
        )
        with (
            patch("gfs_pipeline.aws.ingest.PipelineConfig.from_uri", return_value=fake_cfg),
            patch("gfs_pipeline.aws.ingest.boto3.client", return_value=self.batch),
        ):
            result = ingest.handler(
                _sns_event("gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f006"),
                None,
            )

        self.assertEqual(result, {"ok": True, "submitted": 0, "seen": 1})
        self.assertEqual(self.batch.submissions, [])

    def test_handler_skips_when_no_work_items_are_configured(self) -> None:
        fake_cfg = _FakePipelineConfig(
            forecast_hours=("000",),
            variables=(),
            vector_variables={},
        )
        with (
            patch("gfs_pipeline.aws.ingest.PipelineConfig.from_uri", return_value=fake_cfg),
            patch("gfs_pipeline.aws.ingest.boto3.client", return_value=self.batch),
        ):
            result = ingest.handler(
                _sns_event("gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f000"),
                None,
            )

        self.assertEqual(result, {"ok": True, "submitted": 0, "seen": 1})
        self.assertEqual(self.batch.submissions, [])

    def test_handler_preserves_cycle_cadence_filter(self) -> None:
        fake_cfg = _FakePipelineConfig(
            forecast_hours=("000",),
            variables=("tmp_surface",),
            vector_variables={"wind10m_uv": {}},
        )
        with (
            patch("gfs_pipeline.aws.ingest.PipelineConfig.from_uri", return_value=fake_cfg),
            patch("gfs_pipeline.aws.ingest.boto3.client", return_value=self.batch),
        ):
            result = ingest.handler(
                _sns_event("gfs.20260213/03/atmos/gfs.t03z.pgrb2.0p25.f000"),
                None,
            )

        self.assertEqual(result, {"ok": True, "submitted": 0, "seen": 1})
        self.assertEqual(self.batch.submissions, [])

    def test_handler_skips_unknown_key_formats(self) -> None:
        fake_cfg = _FakePipelineConfig(
            forecast_hours=("000",),
            variables=("tmp_surface",),
            vector_variables={"wind10m_uv": {}},
        )
        with (
            patch("gfs_pipeline.aws.ingest.PipelineConfig.from_uri", return_value=fake_cfg),
            patch("gfs_pipeline.aws.ingest.boto3.client", return_value=self.batch),
        ):
            result = ingest.handler(
                _sns_event("gfs.20260213/00/atmos/not-a-match.grib2"),
                None,
            )

        self.assertEqual(result, {"ok": True, "submitted": 0, "seen": 1})
        self.assertEqual(self.batch.submissions, [])
