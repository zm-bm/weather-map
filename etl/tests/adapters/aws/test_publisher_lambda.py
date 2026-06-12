from __future__ import annotations

import os
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from tests.fixtures.artifacts import DEFAULT_RUN_ID
from weather_etl.adapters.aws import publisher_lambda
from weather_etl.operations.publish_run import RunCandidatePublishResult
from weather_etl.state.manifest.public_view import DatasetViewPublishResult
from weather_etl.state.manifest.publish import RunManifestPublishResult


class _FakeStore:
    def __init__(self, run_ids: tuple[str, ...] = (DEFAULT_RUN_ID,)) -> None:
        self.run_ids = run_ids

    def read_bytes(self, *, uri: str) -> bytes:
        raise FileNotFoundError(uri)

    def list_prefix(self, *, prefix_uri: str) -> list[str]:
        return [f"{prefix_uri.rstrip('/')}/{run_id}/run.json" for run_id in self.run_ids]


def _env() -> dict[str, str]:
    return {
        "ARTIFACT_ROOT_URI": "s3://artifacts",
        "PIPELINE_URI": "file:///tmp/config.json",
    }


def _rolling_product_config() -> SimpleNamespace:
    lifecycle = SimpleNamespace(
        type="rolling_observed",
        display_window_minutes=120,
        publish_scan_minutes=180,
    )
    return SimpleNamespace(dataset=lambda _dataset_id: SimpleNamespace(lifecycle=lifecycle, mode="rolling_observed"))


def _product_config_with_datasets(dataset_lifecycles: dict[str, object | None]) -> SimpleNamespace:
    datasets = {
        dataset_id: SimpleNamespace(
            lifecycle=lifecycle,
            source=SimpleNamespace(type="test_forecast_source"),
            mode="forecast_cycle",
        )
        for dataset_id, lifecycle in dataset_lifecycles.items()
    }
    return SimpleNamespace(
        pipeline_config=SimpleNamespace(datasets=datasets),
        dataset=lambda dataset_id: datasets[dataset_id],
    )


class TestPublisher:
    @pytest.fixture(autouse=True)
    def setup_handler(self, loaded_run_snapshot_factory) -> None:
        self.loaded_snapshot = loaded_run_snapshot_factory(
            dataset_id="gfs",
            dataset_ids=("gfs", "icon"),
            frame_start=0,
            frame_end=1,
            cycle="2026051112",
        )

    def _run(self, event: dict, *, side_effect, view_side_effect=None) -> tuple[dict, object, object, object]:
        if view_side_effect is None:
            view_side_effect = DatasetViewPublishResult(ready=True, published=True)
        with (
            patch.dict(os.environ, _env(), clear=False),
            patch("weather_etl.environment.load_run_snapshot", return_value=self.loaded_snapshot),
            patch("weather_etl.operations.publish_run.validation_report_passed", return_value=(True, [])),
            patch("weather_etl.adapters.aws.publisher_lambda.make_store", return_value=_FakeStore()),
            patch(
                "weather_etl.operations.publish_run.publish_run_manifest",
                side_effect=side_effect,
            ) as publish_run_manifest,
            patch(
                "weather_etl.adapters.aws.publisher_lambda.publish_dataset_view",
                side_effect=view_side_effect if isinstance(view_side_effect, list) else None,
                return_value=None if isinstance(view_side_effect, list) else view_side_effect,
            ) as publish_dataset_view,
            patch(
                "weather_etl.adapters.aws.publisher_lambda.refresh_status",
                return_value=SimpleNamespace(document={}),
            ) as refresh_status,
        ):
            result = publisher_lambda.handler(event, None)
        return result, publish_run_manifest, publish_dataset_view, refresh_status

    def test_publishes_explicit_cycles_and_reports_not_ready(self) -> None:
        result, publish_run_manifest, publish_dataset_view, refresh_status = self._run(
            {"datasets": ["gfs"], "cycles": ["2026051112", "2026051106"]},
            side_effect=[
                RunManifestPublishResult(ready=True, already_published=False),
                RunManifestPublishResult(
                    ready=False,
                    already_published=False,
                    missing_markers=(
                        f"s3://artifacts/runs/gfs/2026051106/{DEFAULT_RUN_ID}/status/tmp_surface/003._SUCCESS.json",
                    ),
                ),
            ],
        )

        assert result["ok"]
        assert [call.kwargs["cycle"] for call in publish_run_manifest.call_args_list] == ["2026051112", "2026051106"]
        publish_dataset_view.assert_called_once()
        assert refresh_status.call_args.kwargs["dataset_ids"] is None
        assert refresh_status.call_args.kwargs["fallback_dataset_ids"] == ("gfs",)

    def test_default_scan_uses_recent_cycles_for_configured_datasets(self) -> None:
        with patch.dict(
            os.environ,
            {
                **_env(),
                "PUBLISH_DATASETS": "gfs,icon",
                "PUBLISH_FORECAST_CYCLE_COUNT": "2",
            },
            clear=False,
        ):
            with (
                patch("weather_etl.environment.load_run_snapshot", return_value=self.loaded_snapshot),
                patch("weather_etl.operations.publish_run.validation_report_passed", return_value=(True, [])),
                patch("weather_etl.adapters.aws.publisher_lambda.make_store", return_value=_FakeStore()),
                patch(
                    "weather_etl.operations.publish_run.publish_run_manifest",
                    return_value=RunManifestPublishResult(ready=True, already_published=True),
                ) as publish_run_manifest,
                patch(
                    "weather_etl.adapters.aws.publisher_lambda.publish_dataset_view",
                    return_value=DatasetViewPublishResult(ready=True, published=False),
                ) as publish_dataset_view,
                patch(
                    "weather_etl.adapters.aws.publisher_lambda.refresh_status",
                    return_value=SimpleNamespace(document={}),
                ) as refresh_status,
            ):
                result = publisher_lambda.handler({"time": "2026-05-11T12:34:00Z"}, None)

        assert result["ok"]
        assert [(call.kwargs["ctx"].dataset_id, call.kwargs["cycle"]) for call in publish_run_manifest.call_args_list] == [
            ("gfs", "2026051112"),
            ("gfs", "2026051106"),
            ("icon", "2026051112"),
            ("icon", "2026051106"),
        ]
        assert publish_dataset_view.call_count == 4
        assert refresh_status.call_args.kwargs["dataset_ids"] is None
        assert refresh_status.call_args.kwargs["fallback_dataset_ids"] == ("gfs", "icon")
        assert refresh_status.call_args.kwargs["now"] == datetime(2026, 5, 11, 12, 34, tzinfo=timezone.utc)

    def test_default_scan_uses_pipeline_datasets_when_env_is_absent(self) -> None:
        product_config = _product_config_with_datasets({"gfs": None, "radar": None})
        with (
            patch.dict(os.environ, _env(), clear=True),
            patch("weather_etl.adapters.aws.publisher_lambda.make_store", return_value=_FakeStore()),
            patch("weather_etl.environment.EtlEnvironment.load_product_config", return_value=product_config),
            patch(
                "weather_etl.adapters.aws.publisher_lambda.publish_run_candidate",
                return_value=RunCandidatePublishResult(
                    ready=True,
                    run_publish_result=RunManifestPublishResult(ready=True, already_published=True),
                    product_config=product_config,
                ),
            ) as publish_run_candidate,
            patch(
                "weather_etl.adapters.aws.publisher_lambda.publish_dataset_view",
                return_value=DatasetViewPublishResult(ready=True, published=False),
            ),
            patch(
                "weather_etl.adapters.aws.publisher_lambda.refresh_status",
                return_value=SimpleNamespace(document={}),
            ) as refresh_status,
        ):
            result = publisher_lambda.handler({"cycles": ["2026051112"]}, None)

        assert result["ok"]
        assert [(call.kwargs["dataset_id"], call.kwargs["cycle"]) for call in publish_run_candidate.call_args_list] == [
            ("gfs", "2026051112"),
            ("radar", "2026051112"),
        ]
        assert refresh_status.call_args.kwargs["fallback_dataset_ids"] == ("gfs", "radar")

    def test_mrms_scan_publishes_explicit_runs_within_hourly_cycles(self) -> None:
        run_ids = (
            "20260511T123400Z-abcdef12",
            "20260511T123600Z-bcdef123",
        )
        with (
            patch.dict(os.environ, _env(), clear=False),
            patch("weather_etl.adapters.aws.publisher_lambda.make_store", return_value=_FakeStore(run_ids)),
            patch(
                "weather_etl.environment.EtlEnvironment.load_product_config",
                return_value=_rolling_product_config(),
            ),
            patch(
                "weather_etl.adapters.aws.publisher_lambda.publish_run_candidate",
                return_value=RunCandidatePublishResult(
                    ready=True,
                    run_publish_result=RunManifestPublishResult(ready=True, already_published=False),
                ),
            ) as publish_run_candidate,
            patch(
                "weather_etl.adapters.aws.publisher_lambda.publish_dataset_view",
                return_value=DatasetViewPublishResult(
                    ready=True,
                    published=True,
                ),
            ) as publish_rolling,
            patch(
                "weather_etl.adapters.aws.publisher_lambda.refresh_status",
                return_value=SimpleNamespace(document={}),
            ),
        ):
            result = publisher_lambda.handler({"datasets": ["mrms"], "cycles": ["2026051112"]}, None)

        assert result["ok"]
        assert {call.kwargs["required_run_id"] for call in publish_run_candidate.call_args_list} == set(run_ids)
        assert {call.kwargs["cycle"] for call in publish_run_candidate.call_args_list} == {"2026051112"}
        publish_rolling.assert_called_once()

    def test_continues_after_one_cycle_fails(self) -> None:
        result, publish_run_manifest, publish_dataset_view, refresh_status = self._run(
            {"datasets": ["gfs"], "cycles": ["2026051112", "2026051106"]},
            side_effect=[
                RuntimeError("boom"),
                RunManifestPublishResult(ready=True, already_published=True),
            ],
        )

        assert not result["ok"]
        assert result["attempted"] == 2
        assert result["failed"] == 1
        assert result["ready"] == 1
        assert result["already_published"] == 1
        assert result["failures"][0]["dataset_id"] == "gfs"
        assert publish_run_manifest.call_count == 2
        publish_dataset_view.assert_called_once()
        refresh_status.assert_called_once()

    def test_status_refresh_failure_is_publisher_failure(self) -> None:
        with (
            patch.dict(os.environ, _env(), clear=False),
            patch("weather_etl.environment.load_run_snapshot", return_value=self.loaded_snapshot),
            patch("weather_etl.operations.publish_run.validation_report_passed", return_value=(True, [])),
            patch("weather_etl.adapters.aws.publisher_lambda.make_store", return_value=_FakeStore()),
            patch(
                "weather_etl.operations.publish_run.publish_run_manifest",
                return_value=RunManifestPublishResult(ready=True, already_published=True),
            ),
            patch(
                "weather_etl.adapters.aws.publisher_lambda.publish_dataset_view",
                return_value=DatasetViewPublishResult(ready=True, published=False),
            ),
            patch("weather_etl.adapters.aws.publisher_lambda.refresh_status", side_effect=RuntimeError("write failed")),
        ):
            result = publisher_lambda.handler({"datasets": ["gfs"], "cycles": ["2026051112"]}, None)

        assert not result["ok"]
        assert result["failed"] == 1
        assert result["failures"] == [
            {
                "dataset_id": "status",
                "cycle": "status",
                "error": "status refresh failed: write failed",
            }
        ]

    def test_validates_missing_report_before_publish(self) -> None:
        with (
            patch.dict(os.environ, _env(), clear=False),
            patch("weather_etl.environment.load_run_snapshot", return_value=self.loaded_snapshot),
            patch(
                "weather_etl.operations.publish_run.validation_report_passed",
                return_value=(False, ["missing validation report"]),
            ),
            patch(
                "weather_etl.operations.publish_run.validate_run",
                return_value=SimpleNamespace(passed=True, errors=()),
            ) as validate_run,
            patch("weather_etl.adapters.aws.publisher_lambda.make_store", return_value=_FakeStore()),
            patch(
                "weather_etl.operations.publish_run.publish_run_manifest",
                return_value=RunManifestPublishResult(ready=True, already_published=False),
            ) as publish_run_manifest,
            patch(
                "weather_etl.adapters.aws.publisher_lambda.publish_dataset_view",
                return_value=DatasetViewPublishResult(ready=True, published=True),
            ),
            patch(
                "weather_etl.adapters.aws.publisher_lambda.refresh_status",
                return_value=SimpleNamespace(document={}),
            ),
        ):
            result = publisher_lambda.handler({"datasets": ["gfs"], "cycles": ["2026051112"]}, None)

        assert result["ready"] == 1
        validate_run.assert_called_once()
        publish_run_manifest.assert_called_once()

    def test_validation_failure_is_not_ready_and_does_not_block_next_cycle(self) -> None:
        with (
            patch.dict(os.environ, _env(), clear=False),
            patch("weather_etl.environment.load_run_snapshot", return_value=self.loaded_snapshot),
            patch(
                "weather_etl.operations.publish_run.validation_report_passed",
                return_value=(False, ["missing validation report"]),
            ),
            patch(
                "weather_etl.operations.publish_run.validate_run",
                side_effect=[
                    SimpleNamespace(passed=False, errors=("missing marker",)),
                    SimpleNamespace(passed=True, errors=()),
                ],
            ) as validate_run,
            patch("weather_etl.adapters.aws.publisher_lambda.make_store", return_value=_FakeStore()),
            patch(
                "weather_etl.operations.publish_run.publish_run_manifest",
                return_value=RunManifestPublishResult(ready=True, already_published=True),
            ) as publish_run_manifest,
            patch(
                "weather_etl.adapters.aws.publisher_lambda.publish_dataset_view",
                return_value=DatasetViewPublishResult(ready=True, published=False),
            ),
            patch(
                "weather_etl.adapters.aws.publisher_lambda.refresh_status",
                return_value=SimpleNamespace(document={}),
            ),
        ):
            result = publisher_lambda.handler({"datasets": ["gfs"], "cycles": ["2026051112", "2026051106"]}, None)

        assert result["ok"]
        assert result["attempted"] == 2
        assert result["not_ready"] == 1
        assert result["ready"] == 1
        assert validate_run.call_count == 2
        publish_run_manifest.assert_called_once()
