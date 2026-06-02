from __future__ import annotations

import io
import os
import unittest
from contextlib import redirect_stderr, redirect_stdout
from types import SimpleNamespace
from unittest.mock import patch

from forecast_etl import cli
from forecast_etl.config.resolved import IconDwdConfig, IconDwdSourceConfig
from forecast_etl.manifest.publish import PublishResult
from forecast_etl.tests.cli.helpers import (
    DEFAULT_RUN_ID,
    FakePipelineConfig,
    FakePool,
    loaded_cfg,
    loaded_run_snapshot,
    passed_validation,
)


class CliLifecycleTest(unittest.TestCase):
    def test_run_frame_requires_dataset_id(self) -> None:
        fake_cfg = FakePipelineConfig(frames=("003",))

        with (
            patch.dict(os.environ, {}, clear=True),
            patch("forecast_etl.workflows.context.load_pipeline_config_document", return_value=loaded_cfg(fake_cfg)),
        ):
            with self.assertRaises(SystemExit):
                cli.main(
                    [
                        "run-frame",
                        "--cycle",
                        "2026021300",
                        "--run-id",
                        DEFAULT_RUN_ID,
                        "--frame-id",
                        "003",
                        "--source-uri",
                        "file:///tmp/input.grib2",
                    ]
                )

    def test_run_frame_processes_without_publishing(self) -> None:
        fake_cfg = FakePipelineConfig(frames=("003",))

        with (
            patch("forecast_etl.workflows.context.load_pipeline_config_document", return_value=loaded_cfg(fake_cfg)),
            patch("forecast_etl.commands.run_frame.run_process_frame") as run_process_frame,
            patch("forecast_etl.commands.publish_cycle.run_publish") as run_publish,
        ):
            result = cli.main(
                [
                    "run-frame",
                    "--dataset-id",
                    "gfs",
                    "--cycle",
                    "2026021300",
                    "--run-id",
                    DEFAULT_RUN_ID,
                    "--frame-id",
                    "003",
                    "--source-uri",
                    "s3://noaa-gfs-bdp-pds/gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003",
                ]
            )

        self.assertEqual(result, 0)
        self.assertEqual(run_process_frame.call_args.kwargs["cycle"], "2026021300")
        self.assertEqual(run_process_frame.call_args.kwargs["run_id"], DEFAULT_RUN_ID)
        self.assertEqual(run_process_frame.call_args.kwargs["frame_id"], "003")
        self.assertEqual(
            run_process_frame.call_args.kwargs["source_uri"],
            "s3://noaa-gfs-bdp-pds/gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003",
        )
        self.assertEqual(run_process_frame.call_args.kwargs["artifact_ids"], ("tmp_surface",))
        self.assertEqual(
            run_process_frame.call_args.kwargs["artifact_specs"],
            {"tmp_surface": {"kind": "scalar"}},
        )
        run_publish.assert_not_called()

    def test_run_frame_requires_run_id(self) -> None:
        fake_cfg = FakePipelineConfig(frames=("003",))

        with (
            patch.dict(os.environ, {}, clear=True),
            patch("forecast_etl.workflows.context.load_pipeline_config_document", return_value=loaded_cfg(fake_cfg)),
            patch("forecast_etl.commands.run_frame.run_process_frame") as run_process_frame,
        ):
            with self.assertRaises(SystemExit) as raised:
                cli.main(
                    [
                        "run-frame",
                        "--dataset-id",
                        "gfs",
                        "--cycle",
                        "2026021300",
                        "--frame-id",
                        "003",
                    ]
                )

        self.assertIn("--run-id", str(raised.exception))
        run_process_frame.assert_not_called()

    def test_run_frame_filters_selected_artifacts(self) -> None:
        fake_cfg = FakePipelineConfig(artifacts=("tmp_surface", "rh_surface"))

        with (
            patch("forecast_etl.workflows.context.load_pipeline_config_document", return_value=loaded_cfg(fake_cfg)),
            patch("forecast_etl.commands.run_frame.run_process_frame") as run_process_frame,
            patch("forecast_etl.commands.publish_cycle.run_publish"),
        ):
            result = cli.main(
                [
                    "run-frame",
                    "--dataset-id",
                    "gfs",
                    "--cycle",
                    "2026021300",
                    "--run-id",
                    DEFAULT_RUN_ID,
                    "--frame-id",
                    "003",
                    "--artifact",
                    "rh_surface",
                ]
            )

        self.assertEqual(result, 0)
        self.assertEqual(run_process_frame.call_args.kwargs["artifact_ids"], ("rh_surface",))

    def test_run_frame_rejects_removed_no_publish_flag(self) -> None:
        err = io.StringIO()

        with redirect_stderr(err), self.assertRaises(SystemExit) as raised:
            cli.main(
                [
                    "run-frame",
                    "--dataset-id",
                    "gfs",
                    "--cycle",
                    "2026021300",
                    "--run-id",
                    DEFAULT_RUN_ID,
                    "--frame-id",
                    "003",
                    "--source-uri",
                    "file:///tmp/input.grib2",
                    "--no-publish",
                ]
            )

        self.assertEqual(raised.exception.code, 2)
        self.assertIn("--no-publish", err.getvalue())

    def test_run_frame_uses_env_fallbacks(self) -> None:
        fake_cfg = FakePipelineConfig(frames=("006",))

        with (
            patch.dict(
                os.environ,
                {
                    "CYCLE": "2026021300",
                    "RUN_ID": DEFAULT_RUN_ID,
                    "FRAME_ID": "006",
                    "GRIB_SOURCE_URI": "https://example.test/gfs.t00z.pgrb2.0p25.f006",
                    "DATASET_ID": "gfs",
                },
                clear=False,
            ),
            patch("forecast_etl.workflows.context.load_pipeline_config_document", return_value=loaded_cfg(fake_cfg)),
            patch("forecast_etl.commands.run_frame.run_process_frame") as run_process_frame,
            patch("forecast_etl.commands.publish_cycle.run_publish") as run_publish,
        ):
            result = cli.main(["run-frame"])

        self.assertEqual(result, 0)
        self.assertEqual(run_process_frame.call_args.kwargs["cycle"], "2026021300")
        self.assertEqual(run_process_frame.call_args.kwargs["run_id"], DEFAULT_RUN_ID)
        self.assertEqual(run_process_frame.call_args.kwargs["frame_id"], "006")
        self.assertEqual(
            run_process_frame.call_args.kwargs["source_uri"],
            "https://example.test/gfs.t00z.pgrb2.0p25.f006",
        )
        self.assertEqual(run_process_frame.call_args.kwargs["artifact_ids"], ("tmp_surface",))
        run_publish.assert_not_called()

    def test_publish_cycle_publishes_ready_cycle(self) -> None:
        fake_cfg = FakePipelineConfig(frames=("000", "003"))

        with (
            patch("forecast_etl.workflows.context.select_run_id_for_cycle", return_value=(DEFAULT_RUN_ID, [])),
            patch("forecast_etl.workflows.context.load_run_snapshot", return_value=loaded_run_snapshot(fake_cfg)),
            patch(
                "forecast_etl.commands.publish_cycle.run_publish",
                return_value=PublishResult(ready=True, already_published=False),
            ) as run_publish,
        ):
            result = cli.main(["publish-cycle", "--dataset-id", "gfs", "--cycle", "2026021300", "--run-id", DEFAULT_RUN_ID])

        self.assertEqual(result, 0)
        run_publish.assert_called_once()
        self.assertEqual(run_publish.call_args.kwargs["cycle"], "2026021300")
        self.assertEqual(run_publish.call_args.kwargs["run_id"], DEFAULT_RUN_ID)
        self.assertEqual(run_publish.call_args.kwargs["artifact_ids"], ("tmp_surface",))
        self.assertEqual(run_publish.call_args.kwargs["forecast_catalog"]["catalogVersion"], "test")

    def test_publish_cycle_returns_not_ready_exit_code(self) -> None:
        fake_cfg = FakePipelineConfig(frames=("000", "003"))

        with (
            patch("forecast_etl.workflows.context.select_run_id_for_cycle", return_value=(DEFAULT_RUN_ID, [])),
            patch("forecast_etl.workflows.context.load_run_snapshot", return_value=loaded_run_snapshot(fake_cfg)),
            patch(
                "forecast_etl.commands.publish_cycle.run_publish",
                return_value=PublishResult(
                    ready=False,
                    already_published=False,
                    missing_markers=(
                        f"s3://artifacts/runs/gfs/2026021300/{DEFAULT_RUN_ID}/status/tmp_surface/003._SUCCESS.json",
                    ),
                ),
            ),
        ):
            result = cli.main(["publish-cycle", "--dataset-id", "gfs", "--cycle", "2026021300"])

        self.assertEqual(result, 2)

    def test_validate_cycle_writes_report_for_ready_run(self) -> None:
        fake_cfg = FakePipelineConfig(frames=("000", "003"))

        with (
            patch("forecast_etl.workflows.context.select_run_id_for_cycle", return_value=(DEFAULT_RUN_ID, [])),
            patch("forecast_etl.workflows.context.load_run_snapshot", return_value=loaded_run_snapshot(fake_cfg)),
            patch("forecast_etl.workflows.cycle.validate_run", return_value=passed_validation()) as validate_run,
        ):
            result = cli.main(["validate-cycle", "--dataset-id", "gfs", "--cycle", "2026021300", "--run-id", DEFAULT_RUN_ID])

        self.assertEqual(result, 0)
        validate_run.assert_called_once()
        self.assertEqual(validate_run.call_args.kwargs["cycle"], "2026021300")
        self.assertEqual(validate_run.call_args.kwargs["run_id"], DEFAULT_RUN_ID)

    def test_validate_cycle_returns_not_ready_for_failed_validation(self) -> None:
        fake_cfg = FakePipelineConfig(frames=("000", "003"))

        with (
            patch("forecast_etl.workflows.context.select_run_id_for_cycle", return_value=(DEFAULT_RUN_ID, [])),
            patch("forecast_etl.workflows.context.load_run_snapshot", return_value=loaded_run_snapshot(fake_cfg)),
            patch("forecast_etl.workflows.cycle.validate_run", return_value=SimpleNamespace(passed=False, errors=("missing",))),
        ):
            result = cli.main(["validate-cycle", "--dataset-id", "gfs", "--cycle", "2026021300"])

        self.assertEqual(result, 2)

    def test_validate_cycle_returns_not_ready_for_missing_snapshot(self) -> None:
        with (
            patch("forecast_etl.workflows.context.select_run_id_for_cycle", return_value=(DEFAULT_RUN_ID, [])),
            patch("forecast_etl.workflows.context.load_run_snapshot", side_effect=FileNotFoundError("missing run.json")),
            patch("forecast_etl.workflows.cycle.validate_run") as validate_run,
        ):
            result = cli.main(["validate-cycle", "--dataset-id", "gfs", "--cycle", "2026021300"])

        self.assertEqual(result, 2)
        validate_run.assert_not_called()

    def test_init_run_writes_snapshot_and_prints_snapshot_uris(self) -> None:
        fake_cfg = FakePipelineConfig(frames=("000", "003"))
        out = io.StringIO()

        with (
            patch("forecast_etl.workflows.context.ensure_run_snapshot", return_value=loaded_run_snapshot(fake_cfg)) as ensure,
            redirect_stdout(out),
        ):
            result = cli.main(["init-run", "--dataset-id", "gfs", "--cycle", "2026021300", "--run-id", DEFAULT_RUN_ID])

        self.assertEqual(result, 0)
        ensure.assert_called_once()
        self.assertIn(f"run_id={DEFAULT_RUN_ID}", out.getvalue())
        self.assertIn("pipeline_config_uri=file:///artifacts/runs/gfs/2026021300/", out.getvalue())

    def test_run_cycle_processes_all_frames_and_publishes_once(self) -> None:
        fake_cfg = FakePipelineConfig(frames=("000", "003"), rate_limit_seconds=0.0)

        with (
            patch("forecast_etl.workflows.context.load_pipeline_config_document", return_value=loaded_cfg(fake_cfg)),
            patch("forecast_etl.workflows.context.ensure_run_snapshot", return_value=loaded_run_snapshot(fake_cfg)),
            patch("forecast_etl.workflows.cycle.generate_run_id", return_value=DEFAULT_RUN_ID),
            patch("forecast_etl.commands.run_cycle.run_process_frame") as run_process_frame,
            patch("forecast_etl.commands.run_cycle.validate_run", return_value=passed_validation()) as validate_run,
            patch("forecast_etl.commands.publish_cycle.run_publish") as run_publish,
            patch("forecast_etl.commands.run_cycle.Pool", FakePool),
        ):
            result = cli.main(["run-cycle", "--dataset-id", "gfs", "--cycle", "2026021300"])

        self.assertEqual(result, 0)
        self.assertEqual(run_process_frame.call_count, 2)
        processed_frames = [call.kwargs["frame_id"] for call in run_process_frame.call_args_list]
        self.assertEqual(processed_frames, ["000", "003"])
        for call in run_process_frame.call_args_list:
            self.assertEqual(call.kwargs["artifact_ids"], ("tmp_surface",))
            self.assertEqual(call.kwargs["run_id"], DEFAULT_RUN_ID)
        validate_run.assert_called_once()
        run_publish.assert_called_once()
        self.assertEqual(run_publish.call_args.kwargs["run_id"], DEFAULT_RUN_ID)

    def test_run_cycle_filters_selected_artifacts_in_workload_order(self) -> None:
        fake_cfg = FakePipelineConfig(
            frames=("000", "003"),
            artifacts=("tmp_surface", "rh_surface", "wind10m_uv"),
            rate_limit_seconds=0.0,
        )

        with (
            patch("forecast_etl.workflows.context.load_pipeline_config_document", return_value=loaded_cfg(fake_cfg)),
            patch("forecast_etl.workflows.context.ensure_run_snapshot", return_value=loaded_run_snapshot(fake_cfg)),
            patch("forecast_etl.workflows.cycle.generate_run_id", return_value=DEFAULT_RUN_ID),
            patch("forecast_etl.commands.run_cycle.run_process_frame") as run_process_frame,
            patch("forecast_etl.commands.run_cycle.validate_run", return_value=passed_validation()),
            patch("forecast_etl.commands.publish_cycle.run_publish"),
            patch("forecast_etl.commands.run_cycle.Pool", FakePool),
        ):
            result = cli.main(
                [
                    "run-cycle",
                    "--dataset-id",
                    "gfs",
                    "--cycle",
                    "2026021300",
                    "--artifact",
                    "wind10m_uv",
                    "--artifact",
                    "tmp_surface",
                    "--artifact",
                    "tmp_surface",
                ]
            )

        self.assertEqual(result, 0)
        for call in run_process_frame.call_args_list:
            self.assertEqual(call.kwargs["artifact_ids"], ("tmp_surface", "wind10m_uv"))

    def test_run_cycle_rejects_unknown_artifact_before_processing(self) -> None:
        fake_cfg = FakePipelineConfig(artifacts=("tmp_surface",))

        with (
            patch("forecast_etl.workflows.context.load_pipeline_config_document", return_value=loaded_cfg(fake_cfg)),
            patch("forecast_etl.workflows.context.ensure_run_snapshot", return_value=loaded_run_snapshot(fake_cfg)),
            patch("forecast_etl.workflows.cycle.generate_run_id", return_value=DEFAULT_RUN_ID),
            patch("forecast_etl.commands.run_cycle.run_process_frame") as run_process_frame,
        ):
            with self.assertRaises(SystemExit) as raised:
                cli.main(
                    [
                        "run-cycle",
                        "--dataset-id",
                        "gfs",
                        "--cycle",
                        "2026021300",
                        "--artifact",
                        "not_configured",
                    ]
                )

        self.assertIn("Unknown artifact id(s) for dataset 'gfs'", str(raised.exception))
        run_process_frame.assert_not_called()

    def test_run_cycle_no_publish_skips_publish(self) -> None:
        fake_cfg = FakePipelineConfig(frames=("000",))

        with (
            patch("forecast_etl.workflows.context.load_pipeline_config_document", return_value=loaded_cfg(fake_cfg)),
            patch("forecast_etl.workflows.context.ensure_run_snapshot", return_value=loaded_run_snapshot(fake_cfg)),
            patch("forecast_etl.workflows.cycle.generate_run_id", return_value=DEFAULT_RUN_ID),
            patch("forecast_etl.commands.run_cycle.run_process_frame"),
            patch("forecast_etl.commands.run_cycle.validate_run", return_value=passed_validation()) as validate_run,
            patch("forecast_etl.commands.publish_cycle.run_publish") as run_publish,
            patch("forecast_etl.commands.run_cycle.Pool", FakePool),
        ):
            result = cli.main(["run-cycle", "--dataset-id", "gfs", "--cycle", "2026021300", "--no-publish"])

        self.assertEqual(result, 0)
        validate_run.assert_called_once()
        run_publish.assert_not_called()

    def test_run_cycle_wraps_worker_errors_with_hour_context(self) -> None:
        fake_cfg = FakePipelineConfig(frames=("000",))

        with (
            patch("forecast_etl.workflows.context.load_pipeline_config_document", return_value=loaded_cfg(fake_cfg)),
            patch("forecast_etl.workflows.context.ensure_run_snapshot", return_value=loaded_run_snapshot(fake_cfg)),
            patch("forecast_etl.workflows.cycle.generate_run_id", return_value=DEFAULT_RUN_ID),
            patch("forecast_etl.commands.run_cycle.run_process_frame", side_effect=ValueError("boom")),
            patch("forecast_etl.commands.publish_cycle.run_publish"),
            patch("forecast_etl.commands.run_cycle.Pool", FakePool),
        ):
            with self.assertRaises(SystemExit) as raised:
                cli.main(["run-cycle", "--dataset-id", "gfs", "--cycle", "2026021300"])

        message = str(raised.exception)
        self.assertIn("Failed processing dataset_id=gfs cycle=2026021300 frame_id=000", message)
        self.assertIn("ValueError: boom", message)

    def test_run_cycle_defaults_icon_to_serial_processing(self) -> None:
        fake_cfg = FakePipelineConfig(frames=("000", "003"))
        fake_cfg.source = IconDwdSourceConfig(
            grid_id="icon_global_regridded_0p125",
            icon_dwd=IconDwdConfig(
                base_url="https://example.test/icon",
                rate_limit_seconds=0.0,
            ),
        )

        with (
            patch("forecast_etl.workflows.context.load_pipeline_config_document", return_value=loaded_cfg(fake_cfg)),
            patch("forecast_etl.workflows.context.ensure_run_snapshot", return_value=loaded_run_snapshot(fake_cfg)),
            patch("forecast_etl.workflows.cycle.generate_run_id", return_value=DEFAULT_RUN_ID),
            patch("forecast_etl.commands.run_cycle.run_process_frame") as run_process_frame,
            patch("forecast_etl.commands.run_cycle.validate_run", return_value=passed_validation()),
            patch("forecast_etl.commands.run_cycle.Pool") as pool,
        ):
            result = cli.main(["run-cycle", "--dataset-id", "gfs", "--cycle", "2026021300", "--no-publish"])

        self.assertEqual(result, 0)
        self.assertEqual(run_process_frame.call_count, 2)
        pool.assert_not_called()



if __name__ == "__main__":
    unittest.main()
