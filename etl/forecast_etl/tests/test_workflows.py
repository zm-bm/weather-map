from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from forecast_etl.config.load import LoadedPipelineConfig
from forecast_etl.manifest.publish import PublishResult
from forecast_etl.run_snapshots import LoadedRunSnapshot
from forecast_etl.tests.fixtures.artifacts import DEFAULT_RUN_ID
from forecast_etl.workflows.context import ApplicationContext
from forecast_etl.workflows.cycle import init_run, publish_cycle, validate_cycle
from forecast_etl.workflows.publisher import publish_candidate


class _FakeWorkload:
    forecast_hours = ("000", "003")
    artifacts = ("tmp_surface",)


class _FakeModel:
    id = "gfs"
    label = "GFS"
    workload = _FakeWorkload()
    artifacts = {"tmp_surface": object()}


class _FakePipelineConfig:
    models = {"gfs": _FakeModel()}

    def model(self, model_id: str) -> _FakeModel:
        if model_id != "gfs":
            raise SystemExit(f"Unknown model {model_id!r}")
        return self.models[model_id]


class _FakeStore:
    pass


def _loaded_cfg() -> LoadedPipelineConfig:
    return LoadedPipelineConfig(raw={"models": {"gfs": {}}}, config=_FakePipelineConfig())


def _loaded_snapshot() -> LoadedRunSnapshot:
    return LoadedRunSnapshot(
        run_id=DEFAULT_RUN_ID,
        config_digest="sha256:" + "1" * 64,
        pipeline_config_uri=f"s3://artifacts/runs/gfs/2026021300/{DEFAULT_RUN_ID}/config/pipeline_config.json",
        forecast_catalog_uri=f"s3://artifacts/runs/gfs/2026021300/{DEFAULT_RUN_ID}/config/forecast_catalog.json",
        loaded_config=_loaded_cfg(),
        forecast_catalog={"catalogVersion": "test", "rasterLayers": []},
    )


def _app_context() -> ApplicationContext:
    return ApplicationContext(
        artifact_root_uri="s3://artifacts",
        pipeline_config_uri="s3://config/pipeline_config.json",
        pipeline_config_overlay_uri="s3://config/local_overlay.json",
        forecast_catalog_uri="s3://config/forecast_catalog.json",
        store=_FakeStore(),
    )


class WorkflowTest(unittest.TestCase):
    def test_application_context_builds_repository_and_resolves_model_runtime(self) -> None:
        app_context = _app_context()

        with patch("forecast_etl.workflows.context.load_pipeline_config_document", return_value=_loaded_cfg()) as load:
            runtime = app_context.resolve_model_runtime("gfs")

        self.assertEqual(app_context.artifact_repo.paths.artifact_root_uri, "s3://artifacts")
        self.assertEqual(runtime.model.id, "gfs")
        self.assertEqual(runtime.execution_context.model_id, "gfs")
        self.assertEqual(runtime.execution_context.artifact_root_uri, "s3://artifacts")
        self.assertEqual(runtime.execution_context.forecast_hours, ("000", "003"))
        self.assertEqual(load.call_args.args, ("s3://config/pipeline_config.json",))
        self.assertEqual(load.call_args.kwargs["overlay_uri"], "s3://config/local_overlay.json")

    def test_init_run_returns_snapshot_identity(self) -> None:
        app_context = _app_context()

        with patch("forecast_etl.workflows.context.ensure_run_snapshot", return_value=_loaded_snapshot()) as ensure:
            result = init_run(
                app_context=app_context,
                model_id="gfs",
                cycle="2026021300",
                run_id=DEFAULT_RUN_ID,
            )

        self.assertEqual(result.run_id, DEFAULT_RUN_ID)
        self.assertEqual(result.config_digest, "sha256:" + "1" * 64)
        self.assertIn("/config/pipeline_config.json", result.pipeline_config_uri)
        self.assertIn("/config/forecast_catalog.json", result.forecast_catalog_uri)
        self.assertEqual(ensure.call_args.kwargs["model_id"], "gfs")
        self.assertEqual(ensure.call_args.kwargs["pipeline_config_uri"], "s3://config/pipeline_config.json")

    def test_validate_cycle_returns_not_ready_for_missing_run_selection(self) -> None:
        app_context = _app_context()

        with (
            patch("forecast_etl.workflows.context.select_run_id_for_cycle", return_value=(None, ["multiple runs"])),
            patch("forecast_etl.workflows.cycle.validate_run") as validate_run,
        ):
            result = validate_cycle(app_context=app_context, model_id="gfs", cycle="2026021300")

        self.assertFalse(result.ready)
        self.assertFalse(result.passed)
        self.assertEqual(result.errors, ("multiple runs",))
        validate_run.assert_not_called()

    def test_validate_cycle_passes_through_validation_result(self) -> None:
        app_context = _app_context()
        validation = SimpleNamespace(passed=True, errors=(), warnings=())

        with (
            patch("forecast_etl.workflows.context.select_run_id_for_cycle", return_value=(DEFAULT_RUN_ID, [])),
            patch("forecast_etl.workflows.context.load_run_snapshot", return_value=_loaded_snapshot()),
            patch("forecast_etl.workflows.cycle.validate_run", return_value=validation) as validate_run,
        ):
            result = validate_cycle(
                app_context=app_context,
                model_id="gfs",
                cycle="2026021300",
                required_run_id=DEFAULT_RUN_ID,
            )

        self.assertTrue(result.ready)
        self.assertTrue(result.passed)
        self.assertIs(result.validation_result, validation)
        self.assertEqual(validate_run.call_args.kwargs["cycle"], "2026021300")
        self.assertEqual(validate_run.call_args.kwargs["run_id"], DEFAULT_RUN_ID)

    def test_publish_cycle_uses_selected_run_snapshot_without_validation(self) -> None:
        app_context = _app_context()

        with (
            patch("forecast_etl.workflows.context.select_run_id_for_cycle", return_value=(DEFAULT_RUN_ID, [])),
            patch("forecast_etl.workflows.context.load_run_snapshot", return_value=_loaded_snapshot()),
            patch(
                "forecast_etl.workflows.cycle.publish_cycle_command",
                return_value=PublishResult(ready=True, already_published=False),
            ) as publish_cycle_command,
        ):
            result = publish_cycle(
                app_context=app_context,
                model_id="gfs",
                cycle="2026021300",
                required_run_id=DEFAULT_RUN_ID,
            )

        self.assertTrue(result.ready)
        self.assertEqual(result.run_id, DEFAULT_RUN_ID)
        self.assertEqual(publish_cycle_command.call_args.kwargs["pipeline_config"].model("gfs").id, "gfs")
        self.assertEqual(publish_cycle_command.call_args.kwargs["forecast_catalog"]["catalogVersion"], "test")

    def test_scheduled_publisher_validates_missing_report_before_publishing(self) -> None:
        app_context = _app_context()

        with (
            patch("forecast_etl.workflows.context.select_run_id_for_cycle", return_value=(DEFAULT_RUN_ID, [])),
            patch("forecast_etl.workflows.context.load_run_snapshot", return_value=_loaded_snapshot()),
            patch(
                "forecast_etl.workflows.publisher.validation_report_passed",
                return_value=(False, ["missing validation report"]),
            ),
            patch(
                "forecast_etl.workflows.publisher.validate_run",
                return_value=SimpleNamespace(passed=True, errors=(), warnings=()),
            ) as validate_run,
            patch(
                "forecast_etl.workflows.publisher.run_publish",
                return_value=PublishResult(ready=True, already_published=False),
            ) as run_publish,
        ):
            result = publish_candidate(app_context=app_context, model_id="gfs", cycle="2026021300")

        self.assertTrue(result.ready)
        validate_run.assert_called_once()
        run_publish.assert_called_once()


if __name__ == "__main__":
    unittest.main()
