from __future__ import annotations

import os
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from tests.fixtures.artifacts import DEFAULT_RUN_ID
from weather_etl.adapters.aws import publisher_lambda
from weather_etl.operations.publish_cycle import ScheduledPublishResult
from weather_etl.state.manifest.publish import PublishResult


class _FakeStore:
    def list_prefix(self, *, prefix_uri: str) -> list[str]:
        return [f"{prefix_uri.rstrip('/')}/{DEFAULT_RUN_ID}/run.json"]


def _env() -> dict[str, str]:
    return {
        "ARTIFACT_ROOT_URI": "s3://artifacts",
        "PIPELINE_URI": "file:///tmp/config.json",
    }


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

    def test_stats_count_consolidated_publish_outcomes(self) -> None:
        stats = publisher_lambda._PublisherStats()

        for result in (
            ScheduledPublishResult(ready=False, not_ready_message="validation failed"),
            ScheduledPublishResult(
                ready=True,
                publish_result=PublishResult(ready=True, already_published=False, latest_promoted=True),
            ),
            ScheduledPublishResult(
                ready=True,
                publish_result=PublishResult(ready=True, already_published=True),
            ),
        ):
            stats.attempted += 1
            stats.record_result(result)

        response = publisher_lambda._publisher_response(stats, dataset_count=1, cycle_count=3)

        assert response["attempted"] == 3
        assert response["not_ready"] == 1
        assert response["ready"] == 2
        assert response["published"] == 1
        assert response["already_published"] == 1
        assert response["latest_promoted"] == 1

    def _run(self, event: dict, *, side_effect) -> tuple[dict, object, object]:
        with (
            patch.dict(os.environ, _env(), clear=False),
            patch("weather_etl.environment.load_run_snapshot", return_value=self.loaded_snapshot),
            patch("weather_etl.operations.publish_cycle.validation_report_passed", return_value=(True, [])),
            patch("weather_etl.adapters.aws.publisher_lambda.make_store", return_value=_FakeStore()),
            patch("weather_etl.operations.publish_cycle.run_publish", side_effect=side_effect) as run_publish,
            patch(
                "weather_etl.adapters.aws.publisher_lambda.refresh_status",
                return_value=SimpleNamespace(document={}),
            ) as refresh_status,
        ):
            result = publisher_lambda.handler(event, None)
        return result, run_publish, refresh_status

    def test_publishes_explicit_cycles_and_reports_not_ready(self) -> None:
        result, run_publish, refresh_status = self._run(
            {"datasets": ["gfs"], "cycles": ["2026051112", "2026051106"]},
            side_effect=[
                PublishResult(ready=True, already_published=False, latest_promoted=True),
                PublishResult(
                    ready=False,
                    already_published=False,
                    missing_markers=(
                        f"s3://artifacts/runs/gfs/2026051106/{DEFAULT_RUN_ID}/status/tmp_surface/003._SUCCESS.json",
                    ),
                ),
            ],
        )

        assert result["ok"]
        assert result["attempted"] == 2
        assert result["ready"] == 1
        assert result["published"] == 1
        assert result["latest_promoted"] == 1
        assert result["not_ready"] == 1
        assert [call.kwargs["cycle"] for call in run_publish.call_args_list] == ["2026051112", "2026051106"]
        assert refresh_status.call_args.kwargs["dataset_ids"] is None
        assert refresh_status.call_args.kwargs["fallback_dataset_ids"] == ("gfs",)

    def test_default_scan_uses_recent_cycles_for_configured_datasets(self) -> None:
        with patch.dict(
            os.environ,
            {
                **_env(),
                "PUBLISH_DATASETS": "gfs,icon",
                "PUBLISH_CYCLE_COUNT": "2",
            },
            clear=False,
        ):
            with (
                patch("weather_etl.environment.load_run_snapshot", return_value=self.loaded_snapshot),
                patch("weather_etl.operations.publish_cycle.validation_report_passed", return_value=(True, [])),
                patch("weather_etl.adapters.aws.publisher_lambda.make_store", return_value=_FakeStore()),
                patch(
                    "weather_etl.operations.publish_cycle.run_publish",
                    return_value=PublishResult(ready=True, already_published=True),
                ) as run_publish,
                patch(
                    "weather_etl.adapters.aws.publisher_lambda.refresh_status",
                    return_value=SimpleNamespace(document={}),
                ) as refresh_status,
            ):
                result = publisher_lambda.handler({"time": "2026-05-11T12:34:00Z"}, None)

        assert result["attempted"] == 4
        assert result["ready"] == 4
        assert result["already_published"] == 4
        assert [(call.kwargs["ctx"].dataset_id, call.kwargs["cycle"]) for call in run_publish.call_args_list] == [
            ("gfs", "2026051112"),
            ("gfs", "2026051106"),
            ("icon", "2026051112"),
            ("icon", "2026051106"),
        ]
        assert refresh_status.call_args.kwargs["dataset_ids"] is None
        assert refresh_status.call_args.kwargs["fallback_dataset_ids"] == ("gfs", "icon")
        assert refresh_status.call_args.kwargs["now"] == datetime(2026, 5, 11, 12, 34, tzinfo=timezone.utc)

    def test_continues_after_one_cycle_fails(self) -> None:
        result, run_publish, refresh_status = self._run(
            {"datasets": ["gfs"], "cycles": ["2026051112", "2026051106"]},
            side_effect=[
                RuntimeError("boom"),
                PublishResult(ready=True, already_published=True),
            ],
        )

        assert not result["ok"]
        assert result["attempted"] == 2
        assert result["failed"] == 1
        assert result["ready"] == 1
        assert result["already_published"] == 1
        assert result["failures"][0]["dataset_id"] == "gfs"
        assert run_publish.call_count == 2
        refresh_status.assert_called_once()

    def test_status_refresh_failure_is_publisher_failure(self) -> None:
        with (
            patch.dict(os.environ, _env(), clear=False),
            patch("weather_etl.environment.load_run_snapshot", return_value=self.loaded_snapshot),
            patch("weather_etl.operations.publish_cycle.validation_report_passed", return_value=(True, [])),
            patch("weather_etl.adapters.aws.publisher_lambda.make_store", return_value=_FakeStore()),
            patch(
                "weather_etl.operations.publish_cycle.run_publish",
                return_value=PublishResult(ready=True, already_published=True),
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
                "weather_etl.operations.publish_cycle.validation_report_passed",
                return_value=(False, ["missing validation report"]),
            ),
            patch(
                "weather_etl.operations.publish_cycle.validate_run",
                return_value=SimpleNamespace(passed=True, errors=()),
            ) as validate_run,
            patch("weather_etl.adapters.aws.publisher_lambda.make_store", return_value=_FakeStore()),
            patch(
                "weather_etl.operations.publish_cycle.run_publish",
                return_value=PublishResult(ready=True, already_published=False),
            ) as run_publish,
            patch(
                "weather_etl.adapters.aws.publisher_lambda.refresh_status",
                return_value=SimpleNamespace(document={}),
            ),
        ):
            result = publisher_lambda.handler({"datasets": ["gfs"], "cycles": ["2026051112"]}, None)

        assert result["ready"] == 1
        validate_run.assert_called_once()
        run_publish.assert_called_once()

    def test_validation_failure_is_not_ready_and_does_not_block_next_cycle(self) -> None:
        with (
            patch.dict(os.environ, _env(), clear=False),
            patch("weather_etl.environment.load_run_snapshot", return_value=self.loaded_snapshot),
            patch(
                "weather_etl.operations.publish_cycle.validation_report_passed",
                return_value=(False, ["missing validation report"]),
            ),
            patch(
                "weather_etl.operations.publish_cycle.validate_run",
                side_effect=[
                    SimpleNamespace(passed=False, errors=("missing marker",)),
                    SimpleNamespace(passed=True, errors=()),
                ],
            ) as validate_run,
            patch("weather_etl.adapters.aws.publisher_lambda.make_store", return_value=_FakeStore()),
            patch(
                "weather_etl.operations.publish_cycle.run_publish",
                return_value=PublishResult(ready=True, already_published=True),
            ) as run_publish,
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
        run_publish.assert_called_once()
