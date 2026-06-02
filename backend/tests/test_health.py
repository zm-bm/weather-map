from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from forecast_etl.artifacts.health import ArtifactHealthStatus, DatasetArtifactHealth
from forecast_etl.artifacts.snapshot import PublishLagEstimate
from forecast_etl.artifacts.status import CycleProgress
from weather_map_backend import health as health_module
from weather_map_backend.health import build_health
from weather_map_backend.settings import Settings

NOW = datetime(2026, 5, 11, 18, 30, tzinfo=timezone.utc)


def test_health_serializes_dataset_health_and_aggregates_status(monkeypatch) -> None:
    monkeypatch.setattr(health_module, "load_pipeline_config", lambda uri: _config("gfs", "icon"))
    monkeypatch.setattr(health_module, "make_store", object)

    def read_health(**kwargs) -> DatasetArtifactHealth:
        if kwargs["dataset"].id == "gfs":
            return _artifact_health(status="fresh", reason="Latest expected cycle is published.", progress=None)
        return _artifact_health(status="building", reason="Expected cycle is still building.", progress=_progress())

    monkeypatch.setattr(health_module, "read_dataset_artifact_health", read_health)

    health = build_health(_settings(), now=NOW)

    assert health["schema"] == "weather-map.health"
    assert health["schema_version"] == 1
    assert health["generated_at"] == "2026-05-11T18:30:00Z"
    assert health["status"] == "degraded"
    assert health["datasets"][0]["status"] == "fresh"
    assert health["datasets"][0]["progress"] is None
    assert health["datasets"][1] == {
        "dataset_id": "icon",
        "label": "ICON",
        "status": "building",
        "reason": "Expected cycle is still building.",
        "expected_cycle": "2026051112",
        "expected_cycle_deadline": "2026-05-11T15:00:00Z",
        "latest_observed_cycle": "2026051112",
        "latest_published_cycle": "2026051106",
        "latest_published_generated_at": "2026-05-11T07:00:00Z",
        "progress": {
            "cycle": "2026051112",
            "run_id": "20260511T183000Z-abcdef12",
            "run_count": 1,
            "published": False,
            "expected_markers": 4,
            "found_markers": 2,
            "missing_markers": 2,
            "last_progress_at": "2026-05-11T18:30:00Z",
            "missing_sample": ["tmp_surface/002"],
            "invalid_marker_sample": [],
        },
        "publish_lag": {
            "grace_hours": 3.46,
            "source": "recent-history",
        },
    }


def test_health_reports_healthy_when_all_datasets_are_fresh(monkeypatch) -> None:
    monkeypatch.setattr(health_module, "load_pipeline_config", lambda uri: _config("gfs", "icon"))
    monkeypatch.setattr(health_module, "make_store", object)
    monkeypatch.setattr(
        health_module,
        "read_dataset_artifact_health",
        lambda **kwargs: _artifact_health(status="fresh", reason="Latest expected cycle is published.", progress=None),
    )

    health = build_health(_settings(), now=NOW)

    assert health["status"] == "healthy"
    assert {dataset["status"] for dataset in health["datasets"]} == {"fresh"}


def test_health_falls_back_when_config_load_fails(monkeypatch) -> None:
    def raise_config_error(uri: str):
        raise RuntimeError("config missing")

    monkeypatch.setattr(health_module, "load_pipeline_config", raise_config_error)
    monkeypatch.setattr(health_module, "make_store", object)

    health = build_health(_settings(), now=NOW)

    assert health["status"] == "unavailable"
    assert [dataset["dataset_id"] for dataset in health["datasets"]] == ["gfs", "icon"]
    assert all(dataset["status"] == "unavailable" for dataset in health["datasets"])
    assert all(dataset["progress"] is None for dataset in health["datasets"])
    assert all("Unable to load ETL config: config missing" == dataset["reason"] for dataset in health["datasets"])


def test_health_loads_real_prod_pipeline_config(monkeypatch) -> None:
    monkeypatch.setattr(health_module, "make_store", object)
    monkeypatch.setattr(
        health_module,
        "read_dataset_artifact_health",
        lambda **kwargs: _artifact_health(status="fresh", reason="Latest expected cycle is published.", progress=None),
    )

    repo_root = Path(__file__).resolve().parents[2]
    settings = _settings(pipeline_config_uri=(repo_root / "config" / "pipeline" / "base.json").as_uri())

    health = build_health(settings, now=NOW)

    assert health["status"] == "healthy"
    assert [dataset["dataset_id"] for dataset in health["datasets"]] == ["gfs", "icon"]
    assert all(dataset["status"] == "fresh" for dataset in health["datasets"])


@dataclass(frozen=True)
class _Model:
    id: str
    label: str


@dataclass(frozen=True)
class _Config:
    datasets: dict[str, _Model]


def _config(*dataset_ids: str) -> _Config:
    return _Config(datasets={dataset_id: _Model(id=dataset_id, label=dataset_id.upper()) for dataset_id in dataset_ids})


def _artifact_health(
    *,
    status: ArtifactHealthStatus,
    reason: str,
    progress: CycleProgress | None,
) -> DatasetArtifactHealth:
    return DatasetArtifactHealth(
        status=status,
        reason=reason,
        expected_cycle="2026051112",
        expected_cycle_deadline=datetime(2026, 5, 11, 15, tzinfo=timezone.utc),
        latest_observed_cycle="2026051112",
        latest_published_cycle="2026051106",
        latest_published_generated_at=datetime(2026, 5, 11, 7, tzinfo=timezone.utc),
        progress=progress,
        publish_lag=PublishLagEstimate(hours=3.456, source="recent-history"),
    )


def _progress() -> CycleProgress:
    return CycleProgress(
        cycle="2026051112",
        published=False,
        manifest_present=False,
        expected_markers=4,
        found_markers=2,
        missing_markers=2,
        last_progress_at=NOW,
        missing_sample=("tmp_surface/002",),
        invalid_marker_sample=(),
        run_id="20260511T183000Z-abcdef12",
        run_count=1,
    )


def _settings(*, pipeline_config_uri: str = "file:///tmp/pipeline_config.json") -> Settings:
    return Settings(
        artifact_root_uri="file:///tmp/weather-map-artifacts",
        pipeline_config_uri=pipeline_config_uri,
        stale_fallback_hours=9,
        recent_progress_hours=2,
        publish_grace_cushion_hours=1,
        publish_grace_min_hours=3,
        publish_grace_max_hours=12,
        history_cycle_count=4,
        status_cycle_count=4,
    )
