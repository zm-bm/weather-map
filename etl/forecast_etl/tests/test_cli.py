from __future__ import annotations

import io
import json
import os
import unittest
from contextlib import redirect_stderr, redirect_stdout
from types import SimpleNamespace
from unittest.mock import patch

from forecast_etl import cli
from forecast_etl.config.load import LoadedPipelineConfig
from forecast_etl.config.resolved import (
    GfsNomadsSourceConfig,
    IconDwdConfig,
    IconDwdSourceConfig,
    NomadsConfig,
)
from forecast_etl.manifest.publish import PublishResult
from forecast_etl.run_snapshots import LoadedRunSnapshot
from forecast_etl.tests.fixtures.artifacts import DEFAULT_RUN_ID


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
        model_ids: tuple[str, ...] = ("gfs",),
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
        self.models = {model_id: self for model_id in model_ids}

    def model(self, model_id: str) -> "_FakePipelineConfig":
        model = self.models.get(model_id)
        if model is None:
            raise SystemExit(f"Unknown model {model_id!r}")
        return model

    def model_dump(self, *, mode: str = "json") -> dict:
        del mode
        return {
            "models": {
                model_id: {
                    "id": model.id,
                    "workload": {
                        "forecast_hours": model.workload.forecast_hours,
                        "artifacts": model.workload.artifacts,
                    },
                }
                for model_id, model in self.models.items()
            }
        }


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


def _loaded_cfg(cfg: _FakePipelineConfig) -> LoadedPipelineConfig:
    return LoadedPipelineConfig(raw=cfg.model_dump(mode="json"), config=cfg)


def _loaded_run_snapshot(cfg: _FakePipelineConfig) -> LoadedRunSnapshot:
    return LoadedRunSnapshot(
        run_id=DEFAULT_RUN_ID,
        config_digest="sha256:" + "1" * 64,
        pipeline_config_uri=f"file:///artifacts/runs/gfs/2026021300/{DEFAULT_RUN_ID}/config/pipeline_config.json",
        forecast_catalog_uri=f"file:///artifacts/runs/gfs/2026021300/{DEFAULT_RUN_ID}/config/forecast_catalog.json",
        loaded_config=_loaded_cfg(cfg),
        forecast_catalog={"catalogVersion": "test", "rasterLayers": []},
    )


def _passed_validation():
    return SimpleNamespace(passed=True, errors=(), warnings=())


class CliTest(unittest.TestCase):
    def test_run_hour_requires_model(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("003",))

        with (
            patch.dict(os.environ, {}, clear=True),
            patch("forecast_etl.cli.load_pipeline_config_document", return_value=_loaded_cfg(fake_cfg)),
        ):
            with self.assertRaises(SystemExit):
                cli.main(
                    [
                        "run-hour",
                        "--cycle",
                        "2026021300",
                        "--run-id",
                        DEFAULT_RUN_ID,
                        "--fhour",
                        "003",
                        "--source-uri",
                        "file:///tmp/input.grib2",
                    ]
                )

    def test_run_hour_processes_without_publishing(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("003",))

        with (
            patch("forecast_etl.cli.load_pipeline_config_document", return_value=_loaded_cfg(fake_cfg)),
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
                    "--run-id",
                    DEFAULT_RUN_ID,
                    "--fhour",
                    "003",
                    "--source-uri",
                    "s3://noaa-gfs-bdp-pds/gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003",
                ]
            )

        self.assertEqual(result, 0)
        self.assertEqual(run_process_hour.call_args.kwargs["cycle"], "2026021300")
        self.assertEqual(run_process_hour.call_args.kwargs["run_id"], DEFAULT_RUN_ID)
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
        run_publish.assert_not_called()

    def test_run_hour_requires_run_id(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("003",))

        with (
            patch.dict(os.environ, {}, clear=True),
            patch("forecast_etl.cli.load_pipeline_config_document", return_value=_loaded_cfg(fake_cfg)),
            patch("forecast_etl.commands.run_hour.run_process_hour") as run_process_hour,
        ):
            with self.assertRaises(SystemExit) as raised:
                cli.main(
                    [
                        "run-hour",
                        "--model",
                        "gfs",
                        "--cycle",
                        "2026021300",
                        "--fhour",
                        "003",
                    ]
                )

        self.assertIn("--run-id", str(raised.exception))
        run_process_hour.assert_not_called()

    def test_run_hour_filters_selected_artifacts(self) -> None:
        fake_cfg = _FakePipelineConfig(artifacts=("tmp_surface", "rh_surface"))

        with (
            patch("forecast_etl.cli.load_pipeline_config_document", return_value=_loaded_cfg(fake_cfg)),
            patch("forecast_etl.commands.run_hour.run_process_hour") as run_process_hour,
            patch("forecast_etl.commands.publish_cycle.run_publish"),
        ):
            result = cli.main(
                [
                    "run-hour",
                    "--model",
                    "gfs",
                    "--cycle",
                    "2026021300",
                    "--run-id",
                    DEFAULT_RUN_ID,
                    "--fhour",
                    "003",
                    "--artifact",
                    "rh_surface",
                ]
            )

        self.assertEqual(result, 0)
        self.assertEqual(run_process_hour.call_args.kwargs["artifact_ids"], ("rh_surface",))

    def test_run_hour_rejects_removed_no_publish_flag(self) -> None:
        err = io.StringIO()

        with redirect_stderr(err), self.assertRaises(SystemExit) as raised:
            cli.main(
                [
                    "run-hour",
                    "--model",
                    "gfs",
                    "--cycle",
                    "2026021300",
                    "--run-id",
                    DEFAULT_RUN_ID,
                    "--fhour",
                    "003",
                    "--source-uri",
                    "file:///tmp/input.grib2",
                    "--no-publish",
                ]
            )

        self.assertEqual(raised.exception.code, 2)
        self.assertIn("--no-publish", err.getvalue())

    def test_run_hour_uses_env_fallbacks(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("006",))

        with (
            patch.dict(
                os.environ,
                {
                    "CYCLE": "2026021300",
                    "RUN_ID": DEFAULT_RUN_ID,
                    "FHOUR": "006",
                    "GRIB_SOURCE_URI": "https://example.test/gfs.t00z.pgrb2.0p25.f006",
                    "MODEL": "gfs",
                },
                clear=False,
            ),
            patch("forecast_etl.cli.load_pipeline_config_document", return_value=_loaded_cfg(fake_cfg)),
            patch("forecast_etl.commands.run_hour.run_process_hour") as run_process_hour,
            patch("forecast_etl.commands.publish_cycle.run_publish") as run_publish,
        ):
            result = cli.main(["run-hour"])

        self.assertEqual(result, 0)
        self.assertEqual(run_process_hour.call_args.kwargs["cycle"], "2026021300")
        self.assertEqual(run_process_hour.call_args.kwargs["run_id"], DEFAULT_RUN_ID)
        self.assertEqual(run_process_hour.call_args.kwargs["fhour"], "006")
        self.assertEqual(
            run_process_hour.call_args.kwargs["source_uri"],
            "https://example.test/gfs.t00z.pgrb2.0p25.f006",
        )
        self.assertEqual(run_process_hour.call_args.kwargs["artifact_ids"], ("tmp_surface",))
        run_publish.assert_not_called()

    def test_publish_cycle_publishes_ready_cycle(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000", "003"))

        with (
            patch("forecast_etl.cli.select_run_id_for_cycle", return_value=(DEFAULT_RUN_ID, [])),
            patch("forecast_etl.cli.load_run_snapshot", return_value=_loaded_run_snapshot(fake_cfg)),
            patch(
                "forecast_etl.commands.publish_cycle.run_publish",
                return_value=PublishResult(ready=True, already_published=False),
            ) as run_publish,
        ):
            result = cli.main(["publish-cycle", "--model", "gfs", "--cycle", "2026021300", "--run-id", DEFAULT_RUN_ID])

        self.assertEqual(result, 0)
        run_publish.assert_called_once()
        self.assertEqual(run_publish.call_args.kwargs["cycle"], "2026021300")
        self.assertEqual(run_publish.call_args.kwargs["run_id"], DEFAULT_RUN_ID)
        self.assertEqual(run_publish.call_args.kwargs["artifact_ids"], ("tmp_surface",))
        self.assertEqual(run_publish.call_args.kwargs["forecast_catalog"]["catalogVersion"], "test")

    def test_publish_cycle_returns_not_ready_exit_code(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000", "003"))

        with (
            patch("forecast_etl.cli.select_run_id_for_cycle", return_value=(DEFAULT_RUN_ID, [])),
            patch("forecast_etl.cli.load_run_snapshot", return_value=_loaded_run_snapshot(fake_cfg)),
            patch(
                "forecast_etl.commands.publish_cycle.run_publish",
                return_value=PublishResult(
                    ready=False,
                    already_published=False,
                    missing_markers=("s3://artifacts/status/gfs/2026021300/tmp_surface/003._SUCCESS.json",),
                ),
            ),
        ):
            result = cli.main(["publish-cycle", "--model", "gfs", "--cycle", "2026021300"])

        self.assertEqual(result, 2)

    def test_validate_cycle_writes_report_for_ready_run(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000", "003"))

        with (
            patch("forecast_etl.cli.select_run_id_for_cycle", return_value=(DEFAULT_RUN_ID, [])),
            patch("forecast_etl.cli.load_run_snapshot", return_value=_loaded_run_snapshot(fake_cfg)),
            patch("forecast_etl.cli.validate_run", return_value=_passed_validation()) as validate_run,
        ):
            result = cli.main(["validate-cycle", "--model", "gfs", "--cycle", "2026021300", "--run-id", DEFAULT_RUN_ID])

        self.assertEqual(result, 0)
        validate_run.assert_called_once()
        self.assertEqual(validate_run.call_args.kwargs["cycle"], "2026021300")
        self.assertEqual(validate_run.call_args.kwargs["run_id"], DEFAULT_RUN_ID)

    def test_validate_cycle_returns_not_ready_for_failed_validation(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000", "003"))

        with (
            patch("forecast_etl.cli.select_run_id_for_cycle", return_value=(DEFAULT_RUN_ID, [])),
            patch("forecast_etl.cli.load_run_snapshot", return_value=_loaded_run_snapshot(fake_cfg)),
            patch("forecast_etl.cli.validate_run", return_value=SimpleNamespace(passed=False, errors=("missing",))),
        ):
            result = cli.main(["validate-cycle", "--model", "gfs", "--cycle", "2026021300"])

        self.assertEqual(result, 2)

    def test_validate_cycle_returns_not_ready_for_missing_snapshot(self) -> None:
        with (
            patch("forecast_etl.cli.select_run_id_for_cycle", return_value=(DEFAULT_RUN_ID, [])),
            patch("forecast_etl.cli.load_run_snapshot", side_effect=FileNotFoundError("missing run.json")),
            patch("forecast_etl.cli.validate_run") as validate_run,
        ):
            result = cli.main(["validate-cycle", "--model", "gfs", "--cycle", "2026021300"])

        self.assertEqual(result, 2)
        validate_run.assert_not_called()

    def test_init_run_writes_snapshot_and_prints_snapshot_uris(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000", "003"))
        out = io.StringIO()

        with (
            patch("forecast_etl.cli.ensure_run_snapshot", return_value=_loaded_run_snapshot(fake_cfg)) as ensure,
            redirect_stdout(out),
        ):
            result = cli.main(["init-run", "--model", "gfs", "--cycle", "2026021300", "--run-id", DEFAULT_RUN_ID])

        self.assertEqual(result, 0)
        ensure.assert_called_once()
        self.assertIn(f"run_id={DEFAULT_RUN_ID}", out.getvalue())
        self.assertIn("pipeline_config_uri=file:///artifacts/runs/gfs/2026021300/", out.getvalue())

    def test_run_cycle_processes_all_hours_and_publishes_once(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000", "003"), rate_limit_seconds=0.0)

        with (
            patch("forecast_etl.cli.load_pipeline_config_document", return_value=_loaded_cfg(fake_cfg)),
            patch("forecast_etl.cli.ensure_run_snapshot", return_value=_loaded_run_snapshot(fake_cfg)),
            patch("forecast_etl.cli.generate_run_id", return_value=DEFAULT_RUN_ID),
            patch("forecast_etl.commands.run_cycle.run_process_hour") as run_process_hour,
            patch("forecast_etl.commands.run_cycle.validate_run", return_value=_passed_validation()) as validate_run,
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
            self.assertEqual(call.kwargs["run_id"], DEFAULT_RUN_ID)
        validate_run.assert_called_once()
        run_publish.assert_called_once()
        self.assertEqual(run_publish.call_args.kwargs["run_id"], DEFAULT_RUN_ID)

    def test_run_cycle_filters_selected_artifacts_in_workload_order(self) -> None:
        fake_cfg = _FakePipelineConfig(
            forecast_hours=("000", "003"),
            artifacts=("tmp_surface", "rh_surface", "wind10m_uv"),
            rate_limit_seconds=0.0,
        )

        with (
            patch("forecast_etl.cli.load_pipeline_config_document", return_value=_loaded_cfg(fake_cfg)),
            patch("forecast_etl.cli.ensure_run_snapshot", return_value=_loaded_run_snapshot(fake_cfg)),
            patch("forecast_etl.cli.generate_run_id", return_value=DEFAULT_RUN_ID),
            patch("forecast_etl.commands.run_cycle.run_process_hour") as run_process_hour,
            patch("forecast_etl.commands.run_cycle.validate_run", return_value=_passed_validation()),
            patch("forecast_etl.commands.publish_cycle.run_publish"),
            patch("forecast_etl.commands.run_cycle.Pool", _FakePool),
        ):
            result = cli.main(
                [
                    "run-cycle",
                    "--model",
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
        for call in run_process_hour.call_args_list:
            self.assertEqual(call.kwargs["artifact_ids"], ("tmp_surface", "wind10m_uv"))

    def test_run_cycle_rejects_unknown_artifact_before_processing(self) -> None:
        fake_cfg = _FakePipelineConfig(artifacts=("tmp_surface",))

        with (
            patch("forecast_etl.cli.load_pipeline_config_document", return_value=_loaded_cfg(fake_cfg)),
            patch("forecast_etl.cli.ensure_run_snapshot", return_value=_loaded_run_snapshot(fake_cfg)),
            patch("forecast_etl.cli.generate_run_id", return_value=DEFAULT_RUN_ID),
            patch("forecast_etl.commands.run_cycle.run_process_hour") as run_process_hour,
        ):
            with self.assertRaises(SystemExit) as raised:
                cli.main(
                    [
                        "run-cycle",
                        "--model",
                        "gfs",
                        "--cycle",
                        "2026021300",
                        "--artifact",
                        "not_configured",
                    ]
                )

        self.assertIn("Unknown artifact id(s) for model 'gfs'", str(raised.exception))
        run_process_hour.assert_not_called()

    def test_run_cycle_no_publish_skips_publish(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000",))

        with (
            patch("forecast_etl.cli.load_pipeline_config_document", return_value=_loaded_cfg(fake_cfg)),
            patch("forecast_etl.cli.ensure_run_snapshot", return_value=_loaded_run_snapshot(fake_cfg)),
            patch("forecast_etl.cli.generate_run_id", return_value=DEFAULT_RUN_ID),
            patch("forecast_etl.commands.run_cycle.run_process_hour"),
            patch("forecast_etl.commands.run_cycle.validate_run", return_value=_passed_validation()) as validate_run,
            patch("forecast_etl.commands.publish_cycle.run_publish") as run_publish,
            patch("forecast_etl.commands.run_cycle.Pool", _FakePool),
        ):
            result = cli.main(["run-cycle", "--model", "gfs", "--cycle", "2026021300", "--no-publish"])

        self.assertEqual(result, 0)
        validate_run.assert_called_once()
        run_publish.assert_not_called()

    def test_run_cycle_wraps_worker_errors_with_hour_context(self) -> None:
        fake_cfg = _FakePipelineConfig(forecast_hours=("000",))

        with (
            patch("forecast_etl.cli.load_pipeline_config_document", return_value=_loaded_cfg(fake_cfg)),
            patch("forecast_etl.cli.ensure_run_snapshot", return_value=_loaded_run_snapshot(fake_cfg)),
            patch("forecast_etl.cli.generate_run_id", return_value=DEFAULT_RUN_ID),
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
            patch("forecast_etl.cli.load_pipeline_config_document", return_value=_loaded_cfg(fake_cfg)),
            patch("forecast_etl.cli.ensure_run_snapshot", return_value=_loaded_run_snapshot(fake_cfg)),
            patch("forecast_etl.cli.generate_run_id", return_value=DEFAULT_RUN_ID),
            patch("forecast_etl.commands.run_cycle.run_process_hour") as run_process_hour,
            patch("forecast_etl.commands.run_cycle.validate_run", return_value=_passed_validation()),
            patch("forecast_etl.commands.run_cycle.Pool") as pool,
        ):
            result = cli.main(["run-cycle", "--model", "gfs", "--cycle", "2026021300", "--no-publish"])

        self.assertEqual(result, 0)
        self.assertEqual(run_process_hour.call_count, 2)
        pool.assert_not_called()

    def test_runs_json_outputs_operator_report(self) -> None:
        out = io.StringIO()
        report = {
            "schema": "weather-map.etl-operator-runs",
            "schemaVersion": 1,
            "model": "gfs",
            "cycle": "2026021300",
            "runCount": 0,
            "runs": [],
        }

        with patch("forecast_etl.cli.runs_report", return_value=report), redirect_stdout(out):
            result = cli.main(["runs", "--model", "gfs", "--cycle", "2026021300", "--json"])

        self.assertEqual(result, 0)
        self.assertEqual(json.loads(out.getvalue())["schema"], "weather-map.etl-operator-runs")

    def test_status_human_output_includes_core_run_state(self) -> None:
        out = io.StringIO()
        report = {
            "schema": "weather-map.etl-operator-status",
            "schemaVersion": 1,
            "model": "gfs",
            "cycle": "2026021300",
            "runId": DEFAULT_RUN_ID,
            "state": "complete",
            "ambiguous": False,
            "runCount": 1,
            "warnings": [],
            "run": {
                "runId": DEFAULT_RUN_ID,
                "markers": {"expected": 1, "completed": 1, "missing": 0},
                "validation": {"status": "passed"},
                "published": {"status": "present"},
            },
        }

        with patch("forecast_etl.cli.status_report", return_value=report), redirect_stdout(out):
            result = cli.main(["status", "--model", "gfs", "--cycle", "2026021300"])

        text = out.getvalue()
        self.assertEqual(result, 0)
        self.assertIn("model=gfs", text)
        self.assertIn(f"runId={DEFAULT_RUN_ID}", text)
        self.assertIn("state=complete", text)
        self.assertIn("run.markers.completed=1", text)
        self.assertIn("run.validation.status=passed", text)
        self.assertIn("run.published.status=present", text)

    def test_status_multiple_runs_warns_but_exits_zero(self) -> None:
        out = io.StringIO()
        report = {
            "schema": "weather-map.etl-operator-status",
            "schemaVersion": 1,
            "model": "gfs",
            "cycle": "2026021300",
            "runId": DEFAULT_RUN_ID,
            "state": "incomplete",
            "ambiguous": True,
            "runCount": 2,
            "warnings": ["multiple runs exist; publishing requires an explicit run id"],
            "run": None,
        }

        with patch("forecast_etl.cli.status_report", return_value=report), redirect_stdout(out):
            result = cli.main(["status", "--model", "gfs", "--cycle", "2026021300"])

        self.assertEqual(result, 0)
        self.assertIn("ambiguous=true", out.getvalue())
        self.assertIn("publishing requires an explicit run id", out.getvalue())

    def test_pointers_json_outputs_operator_report(self) -> None:
        out = io.StringIO()
        report = {
            "schema": "weather-map.etl-operator-pointers",
            "schemaVersion": 1,
            "model": "gfs",
            "cycle": "2026021300",
            "latest": {"status": "valid"},
            "current": {"status": "valid"},
        }

        with patch("forecast_etl.cli.pointers_report", return_value=report), redirect_stdout(out):
            result = cli.main(["pointers", "--model", "gfs", "--cycle", "2026021300", "--json"])

        self.assertEqual(result, 0)
        parsed = json.loads(out.getvalue())
        self.assertEqual(parsed["schema"], "weather-map.etl-operator-pointers")
        self.assertEqual(parsed["latest"]["status"], "valid")

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

    def test_list_models_prints_configured_models(self) -> None:
        fake_cfg = _FakePipelineConfig(model_ids=("gfs", "icon"))
        out = io.StringIO()

        with (
            patch("forecast_etl.cli.load_pipeline_config", return_value=fake_cfg),
            redirect_stdout(out),
        ):
            result = cli.main(["list-models"])

        self.assertEqual(result, 0)
        self.assertEqual(out.getvalue(), "gfs\nicon\n")

    def test_list_models_passes_pipeline_config_overlay_uri_to_loader(self) -> None:
        fake_cfg = _FakePipelineConfig(model_ids=("gfs",))
        out = io.StringIO()

        with (
            patch("forecast_etl.cli.load_pipeline_config", return_value=fake_cfg) as load_pipeline_config,
            redirect_stdout(out),
        ):
            result = cli.main(
                [
                    "list-models",
                    "--pipeline-config-uri",
                    "file:///tmp/base.json",
                    "--pipeline-config-overlay-uri",
                    "file:///tmp/local.json",
                ]
            )

        self.assertEqual(result, 0)
        self.assertEqual(load_pipeline_config.call_args.args, ("file:///tmp/base.json",))
        self.assertEqual(load_pipeline_config.call_args.kwargs["overlay_uri"], "file:///tmp/local.json")


if __name__ == "__main__":
    unittest.main()
