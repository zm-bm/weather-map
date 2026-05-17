from __future__ import annotations

import io
import os
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from forecast_etl import cli
from forecast_etl.config.resolved import (
    GfsNomadsSourceConfig,
    IconDwdConfig,
    IconDwdSourceConfig,
    NomadsConfig,
)


class _FakeWorkload:
    def __init__(self, *, forecast_hours: tuple[str, ...], artifacts: tuple[str, ...]) -> None:
        self.forecast_hours = forecast_hours
        self.artifacts = artifacts


class _FakePipelineConfig:
    def __init__(
        self,
        *,
        forecast_hours: tuple[str, ...] = ("000", "003"),
        artifacts: tuple[str, ...] = ("tmp_surface",),
        rate_limit_seconds: float = 0.0,
    ) -> None:
        self.workload = _FakeWorkload(forecast_hours=forecast_hours, artifacts=artifacts)
        self.source: GfsNomadsSourceConfig | IconDwdSourceConfig = GfsNomadsSourceConfig(
            grid_id="gfs_0p25",
            nomads=NomadsConfig(
                base_url="https://example.test/filter",
                vars_levels={"all_var": "on"},
                rate_limit_seconds=rate_limit_seconds,
            )
        )
        self.nomads = self.source.nomads
        self.artifacts = {
            name: {"kind": "scalar"}
            for name in artifacts
        }
        self.id = "gfs"
        self.label = "GFS"

    def model(self, model_id: str) -> "_FakePipelineConfig":
        if model_id != "gfs":
            raise SystemExit(f"Unknown model {model_id!r}")
        return self


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
            patch("forecast_etl.commands.run_hour.run_process_hour") as run_process_hour,
            patch("forecast_etl.commands.publish_cycle.run_publish") as run_publish,
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
        self.assertEqual(run_process_hour.call_args.kwargs["artifact_ids"], ("tmp_surface",))
        self.assertEqual(
            run_process_hour.call_args.kwargs["artifact_specs"],
            {"tmp_surface": {"kind": "scalar"}},
        )
        run_publish.assert_called_once()

    def test_run_hour_no_publish_skips_publish(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("003",))

        with (
            patch("forecast_etl.cli.load_pipeline_config", return_value=fake_cfg),
            patch("forecast_etl.commands.run_hour.run_process_hour"),
            patch("forecast_etl.commands.publish_cycle.run_publish") as run_publish,
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
            patch("forecast_etl.commands.run_hour.run_process_hour") as run_process_hour,
            patch("forecast_etl.commands.publish_cycle.run_publish") as run_publish,
        ):
            result = cli.main(["run-hour"])

        self.assertEqual(result, 0)
        self.assertEqual(run_process_hour.call_args.kwargs["cycle"], "2026021300")
        self.assertEqual(run_process_hour.call_args.kwargs["fhour"], "006")
        self.assertEqual(
            run_process_hour.call_args.kwargs["source_uri"],
            "https://example.test/gfs.t00z.pgrb2.0p25.f006",
        )
        self.assertEqual(run_process_hour.call_args.kwargs["artifact_ids"], ("tmp_surface",))
        run_publish.assert_called_once()

    def test_run_cycle_processes_all_hours_and_publishes_once(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000", "003"), rate_limit_seconds=0.0)

        with (
            patch("forecast_etl.cli.load_pipeline_config", return_value=fake_cfg),
            patch("forecast_etl.commands.run_cycle.run_process_hour") as run_process_hour,
            patch("forecast_etl.commands.publish_cycle.run_publish") as run_publish,
            patch("forecast_etl.commands.run_cycle.Pool", _FakePool),
        ):
            result = cli.main(["run-cycle", "--model", "gfs", "--cycle", "2026021300"])

        self.assertEqual(result, 0)
        self.assertEqual(run_process_hour.call_count, 2)
        processed_hours = [call.kwargs["fhour"] for call in run_process_hour.call_args_list]
        self.assertEqual(processed_hours, ["000", "003"])
        for call in run_process_hour.call_args_list:
            self.assertEqual(call.kwargs["artifact_ids"], ("tmp_surface",))
        run_publish.assert_called_once()

    def test_run_cycle_no_publish_skips_publish(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000",))

        with (
            patch("forecast_etl.cli.load_pipeline_config", return_value=fake_cfg),
            patch("forecast_etl.commands.run_cycle.run_process_hour"),
            patch("forecast_etl.commands.publish_cycle.run_publish") as run_publish,
            patch("forecast_etl.commands.run_cycle.Pool", _FakePool),
        ):
            result = cli.main(["run-cycle", "--model", "gfs", "--cycle", "2026021300", "--no-publish"])

        self.assertEqual(result, 0)
        run_publish.assert_not_called()

    def test_run_cycle_wraps_worker_errors_with_hour_context(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000",))

        with (
            patch("forecast_etl.cli.load_pipeline_config", return_value=fake_cfg),
            patch("forecast_etl.commands.run_cycle.run_process_hour", side_effect=ValueError("boom")),
            patch("forecast_etl.commands.publish_cycle.run_publish"),
            patch("forecast_etl.commands.run_cycle.Pool", _FakePool),
        ):
            with self.assertRaises(SystemExit) as raised:
                cli.main(["run-cycle", "--model", "gfs", "--cycle", "2026021300"])

        message = str(raised.exception)
        self.assertIn("Failed processing model=gfs cycle=2026021300 fhour=000", message)
        self.assertIn("ValueError: boom", message)

    def test_run_cycle_defaults_icon_to_serial_processing(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000", "003"))
        fake_cfg.source = IconDwdSourceConfig(
            grid_id="icon_global_regridded_0p125",
            icon_dwd=IconDwdConfig(
                base_url="https://example.test/icon",
                rate_limit_seconds=0.0,
            ),
        )

        with (
            patch("forecast_etl.cli.load_pipeline_config", return_value=fake_cfg),
            patch("forecast_etl.commands.run_cycle.run_process_hour") as run_process_hour,
            patch("forecast_etl.commands.run_cycle.Pool") as pool,
        ):
            result = cli.main(["run-cycle", "--model", "gfs", "--cycle", "2026021300", "--no-publish"])

        self.assertEqual(result, 0)
        self.assertEqual(run_process_hour.call_count, 2)
        pool.assert_not_called()

    def test_list_forecast_hours_prints_configured_hours(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000", "003", "006"))
        out = io.StringIO()

        with (
            patch("forecast_etl.cli.load_pipeline_config", return_value=fake_cfg),
            redirect_stdout(out),
        ):
            result = cli.main(["list-forecast-hours", "--model", "gfs"])

        self.assertEqual(result, 0)
        self.assertEqual(out.getvalue(), "000\n003\n006\n")

    def test_pipeline_config_overlay_uri_is_passed_to_loader(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000",))
        out = io.StringIO()

        with (
            patch("forecast_etl.cli.load_pipeline_config", return_value=fake_cfg) as load_pipeline_config,
            redirect_stdout(out),
        ):
            result = cli.main([
                "list-forecast-hours",
                "--model",
                "gfs",
                "--pipeline-config-uri",
                "file:///tmp/base.json",
                "--pipeline-config-overlay-uri",
                "file:///tmp/local.json",
            ])

        self.assertEqual(result, 0)
        self.assertEqual(load_pipeline_config.call_args.args, ("file:///tmp/base.json",))
        self.assertEqual(load_pipeline_config.call_args.kwargs["overlay_uri"], "file:///tmp/local.json")

    def test_list_forecast_hours_uses_model_env_fallback(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("012",))
        out = io.StringIO()

        with (
            patch.dict(os.environ, {"MODEL": "gfs"}, clear=False),
            patch("forecast_etl.cli.load_pipeline_config", return_value=fake_cfg),
            redirect_stdout(out),
        ):
            result = cli.main(["list-forecast-hours"])

        self.assertEqual(result, 0)
        self.assertEqual(out.getvalue(), "012\n")

    def test_list_forecast_hours_rejects_unknown_model(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000",))

        with patch("forecast_etl.cli.load_pipeline_config", return_value=fake_cfg):
            with self.assertRaises(SystemExit) as raised:
                cli.main(["list-forecast-hours", "--model", "icon"])

        self.assertIn("Unknown model 'icon'", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
