from __future__ import annotations

import io
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from gfs_pipeline import cli
from gfs_pipeline.config import ExecutionContext


class _FakeWorkload:
    def __init__(self, *, forecast_hours: tuple[str, ...], variables: tuple[str, ...]) -> None:
        self.forecast_hours = forecast_hours
        self.variables = variables


class _FakeNomads:
    def __init__(self, *, rate_limit_seconds: float) -> None:
        self.base_url = "https://example.test/filter"
        self.vars_levels = {"all_var": "on"}
        self.rate_limit_seconds = rate_limit_seconds


class _FakePipelineConfig:
    def __init__(
        self,
        *,
        forecast_hours: tuple[str, ...] = ("000", "003"),
        variables: tuple[str, ...] = ("tmp_surface",),
        vector_variables: dict[str, dict] | None = None,
        rate_limit_seconds: float = 0.0,
    ) -> None:
        self.workload = _FakeWorkload(forecast_hours=forecast_hours, variables=variables)
        self.nomads = _FakeNomads(rate_limit_seconds=rate_limit_seconds)
        self.scalar_variables = {name: {} for name in variables}
        self.vector_variables = vector_variables or {}

    def to_execution_context(self, artifact_root_uri: str) -> ExecutionContext:
        return ExecutionContext(
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
    def test_run_hour_processes_and_publishes_by_default(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("003",))

        with (
            patch("gfs_pipeline.cli.PipelineConfig.from_uri", return_value=fake_cfg),
            patch("gfs_pipeline.cli.run_process_hour") as run_process_hour,
            patch("gfs_pipeline.cli.run_publish") as run_publish,
        ):
            result = cli.main(
                [
                    "run-hour",
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
        run_publish.assert_called_once()

    def test_run_hour_no_publish_skips_publish(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("003",))

        with (
            patch("gfs_pipeline.cli.PipelineConfig.from_uri", return_value=fake_cfg),
            patch("gfs_pipeline.cli.run_process_hour"),
            patch("gfs_pipeline.cli.run_publish") as run_publish,
        ):
            result = cli.main(
                [
                    "run-hour",
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
                },
                clear=False,
            ),
            patch("gfs_pipeline.cli.PipelineConfig.from_uri", return_value=fake_cfg),
            patch("gfs_pipeline.cli.run_process_hour") as run_process_hour,
            patch("gfs_pipeline.cli.run_publish") as run_publish,
        ):
            result = cli.main(["run-hour"])

        self.assertEqual(result, 0)
        self.assertEqual(run_process_hour.call_args.kwargs["cycle"], "2026021300")
        self.assertEqual(run_process_hour.call_args.kwargs["fhour"], "006")
        self.assertEqual(
            run_process_hour.call_args.kwargs["source_uri"],
            "https://example.test/gfs.t00z.pgrb2.0p25.f006",
        )
        run_publish.assert_called_once()

    def test_run_cycle_processes_all_hours_and_publishes_once(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000", "003"), rate_limit_seconds=0.0)

        def _download(url: str, out_path: Path, *, force: bool = False) -> bool:
            del url, force
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(b"grib")
            return True

        with tempfile.TemporaryDirectory(prefix="weather-map-cli-run-cycle-") as td:
            etl_dir = Path(td)
            with (
                patch("gfs_pipeline.cli.PipelineConfig.from_uri", return_value=fake_cfg),
                patch("gfs_pipeline.cli.default_etl_dir", return_value=etl_dir),
                patch("gfs_pipeline.cli.nomads.nomads_url", return_value="https://example.test/grib"),
                patch("gfs_pipeline.cli.nomads.download_if_needed", side_effect=_download),
                patch("gfs_pipeline.cli.run_process_hour") as run_process_hour,
                patch("gfs_pipeline.cli.run_publish") as run_publish,
                patch("gfs_pipeline.cli.Pool", _FakePool),
                patch("gfs_pipeline.cli.time.sleep"),
            ):
                result = cli.main(["run-cycle", "--cycle", "2026021300"])

        self.assertEqual(result, 0)
        self.assertEqual(run_process_hour.call_count, 2)
        processed_hours = [call.kwargs["fhour"] for call in run_process_hour.call_args_list]
        self.assertEqual(processed_hours, ["000", "003"])
        run_publish.assert_called_once()

    def test_run_cycle_no_publish_skips_publish(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000",))

        def _download(url: str, out_path: Path, *, force: bool = False) -> bool:
            del url, force
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(b"grib")
            return True

        with tempfile.TemporaryDirectory(prefix="weather-map-cli-run-cycle-no-publish-") as td:
            etl_dir = Path(td)
            with (
                patch("gfs_pipeline.cli.PipelineConfig.from_uri", return_value=fake_cfg),
                patch("gfs_pipeline.cli.default_etl_dir", return_value=etl_dir),
                patch("gfs_pipeline.cli.nomads.nomads_url", return_value="https://example.test/grib"),
                patch("gfs_pipeline.cli.nomads.download_if_needed", side_effect=_download),
                patch("gfs_pipeline.cli.run_process_hour"),
                patch("gfs_pipeline.cli.run_publish") as run_publish,
                patch("gfs_pipeline.cli.Pool", _FakePool),
                patch("gfs_pipeline.cli.time.sleep"),
            ):
                result = cli.main(["run-cycle", "--cycle", "2026021300", "--no-publish"])

        self.assertEqual(result, 0)
        run_publish.assert_not_called()

    def test_smoke_prints_hello_world(self) -> None:
        out = io.StringIO()
        with redirect_stdout(out):
            result = cli.main(["smoke"])

        self.assertEqual(result, 0)
        self.assertEqual(out.getvalue().strip(), "hello world")


if __name__ == "__main__":
    unittest.main()
