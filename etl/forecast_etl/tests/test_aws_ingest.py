from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from forecast_etl.aws import ingest


class _FakeBatchClient:
    def __init__(self) -> None:
        self.submissions: list[dict] = []

    def submit_job(self, **kwargs) -> None:
        self.submissions.append(kwargs)


class _FakeWorkload:
    def __init__(self, *, forecast_hours: tuple[str, ...], products: tuple[str, ...]) -> None:
        self.forecast_hours = forecast_hours
        self.products = products


class _FakePipelineConfig:
    def __init__(self, *, forecast_hours: tuple[str, ...], products: tuple[str, ...]) -> None:
        self.workload = _FakeWorkload(forecast_hours=forecast_hours, products=products)

    def model(self, model_id: str) -> "_FakePipelineConfig":
        if model_id != "gfs":
            raise SystemExit(f"Unknown model {model_id!r}")
        return self


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
            "version": 2,
            "product_catalog": {
                "tmp_surface": {
                    "kind": "scalar",
                    "parameter": "tmp",
                    "level": "surface",
                    "units": "C",
                    "valid_min": -45,
                    "valid_max": 50,
                    "source_transform": "identity",
                    "encoding": {
                        "id": "tmp_surface_i16_v1",
                        "dtype": "int16",
                        "byte_order": "little",
                        "scale": 0.01,
                        "offset": 0.0,
                        "nodata": -32768,
                    },
                    "components": [{"id": "value"}],
                },
                "wind10m_uv": {
                    "kind": "vector",
                    "parameter": "wind_uv",
                    "level": "10m_above_ground",
                    "units": "m/s",
                    "valid_min": -64.0,
                    "valid_max": 63.5,
                    "encoding": {
                        "id": "wind10m_uv_vector_i8_v1",
                        "format": "uv-i8-q0p5-v1",
                        "dtype": "int8",
                        "byte_order": "none",
                        "scale": 0.5,
                        "offset": 0.0,
                        "component_order": "u_then_v",
                    },
                    "components": [{"id": "u"}, {"id": "v"}],
                },
            },
            "models": {
                "gfs": {
                    "label": "GFS",
                    "source": {
                        "type": "gfs_nomads",
                        "grid_id": "gfs_0p25_global",
                        "base_url": "https://example.test",
                        "vars_levels": {},
                        "rate_limit_seconds": 0.0,
                    },
                    "workload": {
                        "forecast_hours": ["000", "003", "006"],
                        "products": ["tmp_surface", "wind10m_uv"],
                    },
                    "product_bindings": {
                        "tmp_surface": {
                            "components": [
                                {"id": "value", "grib_match": {"GRIB_ELEMENT": "TMP"}}
                            ],
                        },
                        "wind10m_uv": {
                            "components": [
                                {"id": "u", "grib_match": {"GRIB_ELEMENT": "UGRD"}},
                                {"id": "v", "grib_match": {"GRIB_ELEMENT": "VGRD"}},
                            ],
                        },
                    },
                },
            },
        }

        with tempfile.TemporaryDirectory(prefix="weather-map-aws-ingest-") as td:
            cfg_path = Path(td) / "forecast.etl_config.json"
            cfg_path.write_text(json.dumps(payload), encoding="utf-8")
            with (
                patch.dict(os.environ, {"PIPELINE_CONFIG_URI": f"file://{cfg_path.as_posix()}"}, clear=False),
                patch("forecast_etl.aws.ingest.boto3.client", return_value=self.batch),
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
        self.assertEqual(env["MODEL"], "gfs")
        self.assertEqual(
            env["GRIB_SOURCE_URI"],
            "s3://noaa-gfs-bdp-pds/gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003",
        )
        self.assertNotIn("PIPELINE_CONFIG_URI", env)

    def test_handler_filters_by_forecast_hour(self) -> None:
        fake_cfg = _FakePipelineConfig(
            forecast_hours=("000", "003"),
            products=("tmp_surface",),
        )
        with (
            patch("forecast_etl.aws.ingest.load_pipeline_config", return_value=fake_cfg),
            patch("forecast_etl.aws.ingest.boto3.client", return_value=self.batch),
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
            products=(),
        )
        with (
            patch("forecast_etl.aws.ingest.load_pipeline_config", return_value=fake_cfg),
            patch("forecast_etl.aws.ingest.boto3.client", return_value=self.batch),
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
            products=("tmp_surface", "wind10m_uv"),
        )
        with (
            patch("forecast_etl.aws.ingest.load_pipeline_config", return_value=fake_cfg),
            patch("forecast_etl.aws.ingest.boto3.client", return_value=self.batch),
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
            products=("tmp_surface", "wind10m_uv"),
        )
        with (
            patch("forecast_etl.aws.ingest.load_pipeline_config", return_value=fake_cfg),
            patch("forecast_etl.aws.ingest.boto3.client", return_value=self.batch),
        ):
            result = ingest.handler(
                _sns_event("gfs.20260213/00/atmos/not-a-match.grib2"),
                None,
            )

        self.assertEqual(result, {"ok": True, "submitted": 0, "seen": 1})
        self.assertEqual(self.batch.submissions, [])
