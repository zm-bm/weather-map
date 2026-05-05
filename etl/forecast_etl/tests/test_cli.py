from __future__ import annotations

import io
import os
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from forecast_etl import cli
from forecast_etl.config.schema import ExecutionContext, ProductGroup


class _FakeWorkload:
    def __init__(self, *, forecast_hours: tuple[str, ...], products: tuple[str, ...]) -> None:
        self.forecast_hours = forecast_hours
        self.products = products


class _FakeNomads:
    def __init__(self, *, rate_limit_seconds: float) -> None:
        self.base_url = "https://example.test/filter"
        self.vars_levels = {"all_var": "on"}
        self.rate_limit_seconds = rate_limit_seconds


class _FakeSource:
    def __init__(self, *, source_type: str = "gfs_nomads") -> None:
        self.type = source_type


class _FakePipelineConfig:
    def __init__(
        self,
        *,
        forecast_hours: tuple[str, ...] = ("000", "003"),
        products: tuple[str, ...] = ("tmp_surface",),
        rate_limit_seconds: float = 0.0,
    ) -> None:
        self.workload = _FakeWorkload(forecast_hours=forecast_hours, products=products)
        self.nomads = _FakeNomads(rate_limit_seconds=rate_limit_seconds)
        self.products = {
            name: {
                "style": {
                    "layer_id": "scalar",
                    "palette_id": "temperature.air.c.v1",
                },
            }
            for name in products
        }
        self.product_groups = (
            ProductGroup(
                id="products",
                label="Products",
                layer_id="scalar",
                default_product=products[0],
                products=products,
            ),
        ) if products else ()
        self.id = "gfs"
        self.label = "GFS"
        self.source = _FakeSource()

    def model(self, model_id: str) -> "_FakePipelineConfig":
        if model_id != "gfs":
            raise SystemExit(f"Unknown model {model_id!r}")
        return self

    def to_execution_context(self, artifact_root_uri: str) -> ExecutionContext:
        return ExecutionContext(
            model_id="gfs",
            artifact_root_uri=artifact_root_uri,
            forecast_hours=self.workload.forecast_hours,
        )


class _FakePool:
    def __init__(self, *, processes=None) -> None:
        self.processes = processes

    def __enter__(self) -> "_FakePool":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def imap_unordered(self, fn, iterable):
        for item in iterable:
            yield fn(item)


class CliTest(unittest.TestCase):
    def test_run_hour_requires_model(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("003",))

        with (
            patch.dict(os.environ, {}, clear=True),
            patch("forecast_etl.cli.load_pipeline_config", return_value=fake_cfg),
        ):
            with self.assertRaises(SystemExit):
                cli.main(
                    [
                        "run-hour",
                        "--cycle",
                        "2026021300",
                        "--fhour",
                        "003",
                        "--source-uri",
                        "file:///tmp/input.grib2",
                    ]
                )

    def test_run_hour_processes_and_publishes_by_default(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("003",))

        with (
            patch("forecast_etl.cli.load_pipeline_config", return_value=fake_cfg),
            patch("forecast_etl.pipeline.run.run_process_hour") as run_process_hour,
            patch("forecast_etl.pipeline.run.run_publish") as run_publish,
        ):
            result = cli.main(
                [
                    "run-hour",
                    "--model",
                    "gfs",
                    "--cycle",
                    "2026021300",
                    "--fhour",
                    "003",
                    "--source-uri",
                    "s3://noaa-gfs-bdp-pds/gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003",
                ]
            )

        self.assertEqual(result, 0)
        self.assertEqual(run_process_hour.call_args.kwargs["cycle"], "2026021300")
        self.assertEqual(run_process_hour.call_args.kwargs["fhour"], "003")
        self.assertEqual(
            run_process_hour.call_args.kwargs["source_uri"],
            "s3://noaa-gfs-bdp-pds/gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003",
        )
        self.assertEqual(run_process_hour.call_args.kwargs["product_ids"], ("tmp_surface",))
        self.assertEqual(
            run_process_hour.call_args.kwargs["products"],
            {"tmp_surface": {"style": {"layer_id": "scalar", "palette_id": "temperature.air.c.v1"}}},
        )
        run_publish.assert_called_once()

    def test_run_hour_no_publish_skips_publish(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("003",))

        with (
            patch("forecast_etl.cli.load_pipeline_config", return_value=fake_cfg),
            patch("forecast_etl.pipeline.run.run_process_hour"),
            patch("forecast_etl.pipeline.run.run_publish") as run_publish,
        ):
            result = cli.main(
                [
                    "run-hour",
                    "--model",
                    "gfs",
                    "--cycle",
                    "2026021300",
                    "--fhour",
                    "003",
                    "--source-uri",
                    "file:///tmp/input.grib2",
                    "--no-publish",
                ]
            )

        self.assertEqual(result, 0)
        run_publish.assert_not_called()

    def test_run_hour_uses_env_fallbacks(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("006",))

        with (
            patch.dict(
                os.environ,
                {
                    "CYCLE": "2026021300",
                    "FHOUR": "006",
                    "GRIB_SOURCE_URI": "https://example.test/gfs.t00z.pgrb2.0p25.f006",
                    "MODEL": "gfs",
                },
                clear=False,
            ),
            patch("forecast_etl.cli.load_pipeline_config", return_value=fake_cfg),
            patch("forecast_etl.pipeline.run.run_process_hour") as run_process_hour,
            patch("forecast_etl.pipeline.run.run_publish") as run_publish,
        ):
            result = cli.main(["run-hour"])

        self.assertEqual(result, 0)
        self.assertEqual(run_process_hour.call_args.kwargs["cycle"], "2026021300")
        self.assertEqual(run_process_hour.call_args.kwargs["fhour"], "006")
        self.assertEqual(
            run_process_hour.call_args.kwargs["source_uri"],
            "https://example.test/gfs.t00z.pgrb2.0p25.f006",
        )
        self.assertEqual(run_process_hour.call_args.kwargs["product_ids"], ("tmp_surface",))
        run_publish.assert_called_once()

    def test_run_cycle_processes_all_hours_and_publishes_once(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000", "003"), rate_limit_seconds=0.0)

        with (
            patch("forecast_etl.cli.load_pipeline_config", return_value=fake_cfg),
            patch("forecast_etl.pipeline.run.run_process_hour") as run_process_hour,
            patch("forecast_etl.pipeline.run.run_publish") as run_publish,
            patch("forecast_etl.pipeline.run.Pool", _FakePool),
        ):
            result = cli.main(["run-cycle", "--model", "gfs", "--cycle", "2026021300"])

        self.assertEqual(result, 0)
        self.assertEqual(run_process_hour.call_count, 2)
        processed_hours = [call.kwargs["fhour"] for call in run_process_hour.call_args_list]
        self.assertEqual(processed_hours, ["000", "003"])
        for call in run_process_hour.call_args_list:
            self.assertEqual(call.kwargs["product_ids"], ("tmp_surface",))
        run_publish.assert_called_once()

    def test_run_cycle_no_publish_skips_publish(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000",))

        with (
            patch("forecast_etl.cli.load_pipeline_config", return_value=fake_cfg),
            patch("forecast_etl.pipeline.run.run_process_hour"),
            patch("forecast_etl.pipeline.run.run_publish") as run_publish,
            patch("forecast_etl.pipeline.run.Pool", _FakePool),
        ):
            result = cli.main(["run-cycle", "--model", "gfs", "--cycle", "2026021300", "--no-publish"])

        self.assertEqual(result, 0)
        run_publish.assert_not_called()

    def test_run_cycle_wraps_worker_errors_with_hour_context(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000",))

        with (
            patch("forecast_etl.cli.load_pipeline_config", return_value=fake_cfg),
            patch("forecast_etl.pipeline.run.run_process_hour", side_effect=ValueError("boom")),
            patch("forecast_etl.pipeline.run.run_publish"),
            patch("forecast_etl.pipeline.run.Pool", _FakePool),
        ):
            with self.assertRaises(SystemExit) as raised:
                cli.main(["run-cycle", "--model", "gfs", "--cycle", "2026021300"])

        message = str(raised.exception)
        self.assertIn("Failed processing model=gfs cycle=2026021300 fhour=000", message)
        self.assertIn("ValueError: boom", message)

    def test_run_cycle_defaults_icon_to_serial_processing(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000", "003"))
        fake_cfg.source = _FakeSource(source_type="icon_dwd_icosahedral")

        with (
            patch("forecast_etl.cli.load_pipeline_config", return_value=fake_cfg),
            patch("forecast_etl.pipeline.run.run_process_hour") as run_process_hour,
            patch("forecast_etl.pipeline.run.Pool") as pool,
        ):
            result = cli.main(["run-cycle", "--model", "gfs", "--cycle", "2026021300", "--no-publish"])

        self.assertEqual(result, 0)
        self.assertEqual(run_process_hour.call_count, 2)
        pool.assert_not_called()

    def test_smoke_prints_hello_world(self) -> None:
        out = io.StringIO()
        with redirect_stdout(out):
            result = cli.main(["smoke"])

        self.assertEqual(result, 0)
        self.assertEqual(out.getvalue().strip(), "hello world")


if __name__ == "__main__":
    unittest.main()
