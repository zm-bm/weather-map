from __future__ import annotations

import os
import unittest
from dataclasses import dataclass, field
from unittest.mock import patch

from forecast_etl.aws import publisher
from forecast_etl.config.load import LoadedPipelineConfig
from forecast_etl.manifest.publish import PublishResult
from forecast_etl.run_snapshots import LoadedRunSnapshot
from forecast_etl.tests.fixtures.artifacts import DEFAULT_RUN_ID


@dataclass(frozen=True)
class _FakeWorkload:
    forecast_hours: tuple[str, ...] = ("000", "003")
    artifacts: tuple[str, ...] = ("tmp_surface",)


@dataclass(frozen=True)
class _FakeModel:
    id: str
    label: str
    workload: _FakeWorkload = field(default_factory=_FakeWorkload)
    artifacts: dict[str, object] | None = None

    def __post_init__(self) -> None:
        if self.artifacts is None:
            object.__setattr__(self, "artifacts", {"tmp_surface": object()})


class _FakePipelineConfig:
    def __init__(self) -> None:
        self.models = {
            "gfs": _FakeModel(id="gfs", label="GFS"),
            "icon": _FakeModel(id="icon", label="ICON"),
        }

    def model(self, model_id: str) -> _FakeModel:
        model = self.models.get(model_id)
        if model is None:
            raise SystemExit(f"Unknown model {model_id!r}")
        return model


class _FakeStore:
    pass


def _loaded_snapshot(cfg: _FakePipelineConfig) -> LoadedRunSnapshot:
    return LoadedRunSnapshot(
        run_id=DEFAULT_RUN_ID,
        config_digest="sha256:" + "1" * 64,
        pipeline_config_uri=f"s3://artifacts/runs/gfs/2026051112/{DEFAULT_RUN_ID}/config/pipeline_config.json",
        forecast_catalog_uri=f"s3://artifacts/runs/gfs/2026051112/{DEFAULT_RUN_ID}/config/forecast_catalog.json",
        loaded_config=LoadedPipelineConfig(raw={"models": {"gfs": {}, "icon": {}}}, config=cfg),
        forecast_catalog={"catalogVersion": "test", "rasterLayers": []},
    )


def _env() -> dict[str, str]:
    return {
        "ARTIFACT_ROOT_URI": "s3://artifacts",
        "PIPELINE_CONFIG_URI": "file:///tmp/config.json",
    }


class PublisherTest(unittest.TestCase):
    def setUp(self) -> None:
        self.cfg = _FakePipelineConfig()

    def _run(self, event: dict, *, side_effect) -> tuple[dict, object]:
        with (
            patch.dict(os.environ, _env(), clear=False),
            patch("forecast_etl.aws.publisher.select_run_id_for_cycle", return_value=(DEFAULT_RUN_ID, [])),
            patch("forecast_etl.aws.publisher.load_run_snapshot", return_value=_loaded_snapshot(self.cfg)),
            patch("forecast_etl.aws.publisher.make_store", return_value=_FakeStore()),
            patch("forecast_etl.aws.publisher.run_publish", side_effect=side_effect) as run_publish,
        ):
            result = publisher.handler(event, None)
        return result, run_publish

    def test_publishes_explicit_cycles_and_reports_not_ready(self) -> None:
        result, run_publish = self._run(
            {"models": ["gfs"], "cycles": ["2026051112", "2026051106"]},
            side_effect=[
                PublishResult(ready=True, already_published=False, latest_promoted=True),
                PublishResult(
                    ready=False,
                    already_published=False,
                    missing_markers=("s3://artifacts/status/gfs/2026051106/tmp_surface/003._SUCCESS.json",),
                ),
            ],
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["attempted"], 2)
        self.assertEqual(result["ready"], 1)
        self.assertEqual(result["published"], 1)
        self.assertEqual(result["latestPromoted"], 1)
        self.assertEqual(result["notReady"], 1)
        self.assertEqual([call.kwargs["cycle"] for call in run_publish.call_args_list], ["2026051112", "2026051106"])

    def test_default_scan_uses_recent_cycles_for_configured_models(self) -> None:
        with patch.dict(
            os.environ,
            {
                **_env(),
                "PUBLISH_MODELS": "gfs,icon",
                "PUBLISH_CYCLE_COUNT": "2",
            },
            clear=False,
        ):
            with (
                patch("forecast_etl.aws.publisher.select_run_id_for_cycle", return_value=(DEFAULT_RUN_ID, [])),
                patch("forecast_etl.aws.publisher.load_run_snapshot", return_value=_loaded_snapshot(self.cfg)),
                patch("forecast_etl.aws.publisher.make_store", return_value=_FakeStore()),
                patch(
                    "forecast_etl.aws.publisher.run_publish",
                    return_value=PublishResult(ready=True, already_published=True),
                ) as run_publish,
            ):
                result = publisher.handler({"time": "2026-05-11T12:34:00Z"}, None)

        self.assertEqual(result["attempted"], 4)
        self.assertEqual(result["ready"], 4)
        self.assertEqual(result["alreadyPublished"], 4)
        self.assertEqual(
            [(call.kwargs["ctx"].model_id, call.kwargs["cycle"]) for call in run_publish.call_args_list],
            [
                ("gfs", "2026051112"),
                ("gfs", "2026051106"),
                ("icon", "2026051112"),
                ("icon", "2026051106"),
            ],
        )

    def test_continues_after_one_cycle_fails(self) -> None:
        result, run_publish = self._run(
            {"models": ["gfs"], "cycles": ["2026051112", "2026051106"]},
            side_effect=[
                RuntimeError("boom"),
                PublishResult(ready=True, already_published=True),
            ],
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["attempted"], 2)
        self.assertEqual(result["failed"], 1)
        self.assertEqual(result["ready"], 1)
        self.assertEqual(result["alreadyPublished"], 1)
        self.assertEqual(result["failures"][0]["model"], "gfs")
        self.assertEqual(run_publish.call_count, 2)


if __name__ == "__main__":
    unittest.main()
