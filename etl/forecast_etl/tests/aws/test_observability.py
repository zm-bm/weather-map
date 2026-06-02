from __future__ import annotations

import os
import unittest
from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import patch

from forecast_etl.aws import observability
from forecast_etl.inspection.snapshot import PublishLagEstimate


@dataclass(frozen=True)
class _FakeDataset:
    id: str
    label: str


class _FakePipelineConfig:
    def __init__(self, *dataset_ids: str) -> None:
        self.datasets = {
            dataset_id: _FakeDataset(id=dataset_id, label=dataset_id.upper()) for dataset_id in dataset_ids
        }

    def dataset(self, dataset_id: str) -> _FakeDataset:
        dataset = self.datasets.get(dataset_id)
        if dataset is None:
            raise SystemExit(f"Unknown dataset {dataset_id!r}")
        return dataset


class _FakeCloudWatch:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def put_metric_data(self, **kwargs) -> None:
        self.calls.append(kwargs)


def _env() -> dict[str, str]:
    return {
        "ARTIFACT_ROOT_URI": "s3://artifacts",
        "PIPELINE_CONFIG_URI": "s3://config/weather-etl/pipeline_config.json",
        "OBSERVABILITY_DATASETS": "gfs,icon",
        "OBSERVABILITY_METRIC_NAMESPACE": "WeatherMap/Test",
    }


def _health(*, status: str, latest: str | None = "2026051112") -> SimpleNamespace:
    return SimpleNamespace(
        status=status,
        reason=f"{status} reason",
        expected_cycle="2026051112",
        latest_observed_cycle=latest,
        latest_published_cycle=latest,
        progress=None,
        publish_lag=PublishLagEstimate(hours=3, source="test"),
    )


def _manifest_summary(status: str = "valid") -> dict:
    return {
        "status": status,
        "path": "manifests/data-manifest.json",
        "generated_at": "2026-05-11T18:00:00Z",
        "dataset_count": 2,
        "latest_dataset_count": 2 if status == "valid" else 0,
        "diagnostics": [] if status == "valid" else ["bad manifest"],
    }


class ObservabilityTest(unittest.TestCase):
    def test_report_emits_healthy_metrics_for_fresh_datasets_and_manifest(self) -> None:
        with (
            patch.dict(os.environ, _env(), clear=False),
            patch("forecast_etl.aws.observability.make_store", return_value=object()),
            patch("forecast_etl.aws.observability.load_pipeline_config", return_value=_FakePipelineConfig("gfs", "icon")),
            patch("forecast_etl.aws.observability.read_dataset_artifact_health", return_value=_health(status="fresh")),
            patch("forecast_etl.aws.observability.data_manifest_summary", return_value=_manifest_summary()),
        ):
            report, metrics = observability.build_report(event={"time": "2026-05-11T18:30:00Z"})

        self.assertTrue(report["ok"])
        self.assertEqual(report["bad_dataset_count"], 0)
        self.assertEqual(report["data_manifest"]["status"], "valid")
        self.assertEqual(_metric_values(metrics, "DatasetBadState"), [0.0, 0.0])
        self.assertEqual(_metric_values(metrics, "DatasetFresh"), [1.0, 1.0])
        self.assertEqual(_metric_values(metrics, "DataManifestValid"), [1.0])
        self.assertEqual(_metric_values(metrics, "ObservabilityCheckOk"), [1.0])

    def test_bad_dataset_state_and_missing_manifest_emit_failed_check(self) -> None:
        def health(**kwargs):
            if kwargs["dataset"].id == "gfs":
                return _health(status="stale", latest="2026051106")
            return _health(status="building", latest="2026051112")

        with (
            patch.dict(os.environ, _env(), clear=False),
            patch("forecast_etl.aws.observability.make_store", return_value=object()),
            patch("forecast_etl.aws.observability.load_pipeline_config", return_value=_FakePipelineConfig("gfs", "icon")),
            patch("forecast_etl.aws.observability.read_dataset_artifact_health", side_effect=health),
            patch("forecast_etl.aws.observability.data_manifest_summary", return_value=_manifest_summary("missing")),
        ):
            report, metrics = observability.build_report(event={"time": "2026-05-11T18:30:00Z"})

        self.assertFalse(report["ok"])
        self.assertEqual(report["bad_dataset_count"], 1)
        self.assertEqual(report["datasets"][0]["latest_cycle_lag_hours"], 6.0)
        self.assertEqual(report["datasets"][1]["status"], "building")
        self.assertEqual(_metric_values(metrics, "DatasetBadState"), [1.0, 0.0])
        self.assertEqual(_metric_values(metrics, "DataManifestValid"), [0.0])
        self.assertEqual(_metric_values(metrics, "ObservabilityCheckOk"), [0.0])

    def test_config_load_failure_returns_failed_checker_state(self) -> None:
        with (
            patch.dict(os.environ, _env(), clear=False),
            patch("forecast_etl.aws.observability.make_store", return_value=object()),
            patch("forecast_etl.aws.observability.load_pipeline_config", side_effect=RuntimeError("config missing")),
            patch("forecast_etl.aws.observability.data_manifest_summary", return_value=_manifest_summary()),
        ):
            report, metrics = observability.build_report(event={"time": "2026-05-11T18:30:00Z"})

        self.assertFalse(report["ok"])
        self.assertEqual(report["inspection_failure_count"], 2)
        self.assertEqual(report["config_error"], "config missing")
        self.assertEqual([dataset["status"] for dataset in report["datasets"]], ["unavailable", "unavailable"])
        self.assertEqual(_metric_values(metrics, "DatasetBadState"), [1.0, 1.0])
        self.assertEqual(_metric_values(metrics, "ObservabilityCheckOk"), [0.0])

    def test_handler_emits_put_metric_data_with_expected_namespace(self) -> None:
        cloudwatch = _FakeCloudWatch()
        with (
            patch.dict(os.environ, _env(), clear=False),
            patch("forecast_etl.aws.observability.make_store", return_value=object()),
            patch("forecast_etl.aws.observability.load_pipeline_config", return_value=_FakePipelineConfig("gfs", "icon")),
            patch("forecast_etl.aws.observability.read_dataset_artifact_health", return_value=_health(status="fresh")),
            patch("forecast_etl.aws.observability.data_manifest_summary", return_value=_manifest_summary()),
            patch("forecast_etl.aws.observability.cloudwatch_client", return_value=cloudwatch),
        ):
            report = observability.handler({"time": "2026-05-11T18:30:00Z"}, None)

        self.assertTrue(report["ok"])
        self.assertEqual(report["emitted_metric_count"], 8)
        self.assertEqual(len(cloudwatch.calls), 1)
        self.assertEqual(cloudwatch.calls[0]["Namespace"], "WeatherMap/Test")
        self.assertEqual({metric["MetricName"] for metric in cloudwatch.calls[0]["MetricData"]}, {
            "DataManifestValid",
            "DatasetBadState",
            "DatasetFresh",
            "LatestCycleLagHours",
            "ObservabilityCheckOk",
        })

    def test_dataset_inspection_failure_does_not_block_remaining_datasets(self) -> None:
        def health(**kwargs):
            if kwargs["dataset"].id == "icon":
                raise RuntimeError("inspection failed")
            return _health(status="fresh")

        with (
            patch.dict(os.environ, _env(), clear=False),
            patch("forecast_etl.aws.observability.make_store", return_value=object()),
            patch("forecast_etl.aws.observability.load_pipeline_config", return_value=_FakePipelineConfig("gfs", "icon")),
            patch("forecast_etl.aws.observability.read_dataset_artifact_health", side_effect=health),
            patch("forecast_etl.aws.observability.data_manifest_summary", return_value=_manifest_summary()),
        ):
            report, metrics = observability.build_report(event={"time": "2026-05-11T18:30:00Z"})

        self.assertFalse(report["ok"])
        self.assertEqual(report["inspection_failure_count"], 1)
        self.assertEqual([dataset["status"] for dataset in report["datasets"]], ["fresh", "unavailable"])
        self.assertEqual(_metric_values(metrics, "DatasetBadState"), [0.0, 1.0])


def _metric_values(metrics: list[dict], name: str) -> list[float]:
    return [metric["Value"] for metric in metrics if metric["MetricName"] == name]


if __name__ == "__main__":
    unittest.main()
