from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from forecast_etl.artifacts.health import ArtifactHealthStatus, ModelArtifactHealth
from forecast_etl.artifacts.snapshot import PublishLagEstimate
from forecast_etl.artifacts.status import CycleProgress
from weather_map_backend import health as health_module
from weather_map_backend.health import build_health
from weather_map_backend.settings import Settings

NOW = datetime(2026, 5, 11, 18, 30, tzinfo=timezone.utc)


def test_health_serializes_model_health_and_aggregates_status(monkeypatch) -> None:
    monkeypatch.setattr(health_module, "load_pipeline_config", lambda uri: _config("gfs", "icon"))
    monkeypatch.setattr(health_module, "make_store", object)

    def read_health(**kwargs) -> ModelArtifactHealth:
        if kwargs["model"].id == "gfs":
            return _artifact_health(status="fresh", reason="Latest expected cycle is published.", progress=None)
        return _artifact_health(status="building", reason="Expected cycle is still building.", progress=_progress())

    monkeypatch.setattr(health_module, "read_model_artifact_health", read_health)

    health = build_health(_settings(), now=NOW)

    assert health["schema"] == "weather-map.health"
    assert health["schemaVersion"] == 1
    assert health["generatedAt"] == "2026-05-11T18:30:00Z"
    assert health["status"] == "degraded"
    assert health["models"][0]["status"] == "fresh"
    assert health["models"][0]["progress"] is None
    assert health["models"][1] == {
        "id": "icon",
        "label": "ICON",
        "status": "building",
        "reason": "Expected cycle is still building.",
        "expectedCycle": "2026051112",
        "expectedCycleDeadline": "2026-05-11T15:00:00Z",
        "latestObservedCycle": "2026051112",
        "latestPublishedCycle": "2026051106",
        "latestPublishedGeneratedAt": "2026-05-11T07:00:00Z",
        "progress": {
            "cycle": "2026051112",
            "runId": "20260511T183000Z-abcdef12",
            "runCount": 1,
            "published": False,
            "expectedMarkers": 4,
            "foundMarkers": 2,
            "missingMarkers": 2,
            "lastProgressAt": "2026-05-11T18:30:00Z",
            "missingSample": ["tmp_surface/002"],
            "invalidMarkerSample": [],
        },
        "publishLag": {
            "graceHours": 3.46,
            "source": "recent-history",
        },
    }


def test_health_reports_healthy_when_all_models_are_fresh(monkeypatch) -> None:
    monkeypatch.setattr(health_module, "load_pipeline_config", lambda uri: _config("gfs", "icon"))
    monkeypatch.setattr(health_module, "make_store", object)
    monkeypatch.setattr(
        health_module,
        "read_model_artifact_health",
        lambda **kwargs: _artifact_health(status="fresh", reason="Latest expected cycle is published.", progress=None),
    )

    health = build_health(_settings(), now=NOW)

    assert health["status"] == "healthy"
    assert {model["status"] for model in health["models"]} == {"fresh"}


def test_health_falls_back_when_config_load_fails(monkeypatch) -> None:
    def raise_config_error(uri: str):
        raise RuntimeError("config missing")

    monkeypatch.setattr(health_module, "load_pipeline_config", raise_config_error)
    monkeypatch.setattr(health_module, "make_store", object)

    health = build_health(_settings(), now=NOW)

    assert health["status"] == "unavailable"
    assert [model["id"] for model in health["models"]] == ["gfs", "icon"]
    assert all(model["status"] == "unavailable" for model in health["models"])
    assert all(model["progress"] is None for model in health["models"])
    assert all("Unable to load ETL config: config missing" == model["reason"] for model in health["models"])


def test_health_loads_real_prod_pipeline_config(monkeypatch) -> None:
    monkeypatch.setattr(health_module, "make_store", object)
    monkeypatch.setattr(
        health_module,
        "read_model_artifact_health",
        lambda **kwargs: _artifact_health(status="fresh", reason="Latest expected cycle is published.", progress=None),
    )

    repo_root = Path(__file__).resolve().parents[2]
    settings = _settings(pipeline_config_uri=(repo_root / "config" / "pipeline" / "base.json").as_uri())

    health = build_health(settings, now=NOW)

    assert health["status"] == "healthy"
    assert [model["id"] for model in health["models"]] == ["gfs", "icon"]
    assert all(model["status"] == "fresh" for model in health["models"])


@dataclass(frozen=True)
class _Model:
    id: str
    label: str


@dataclass(frozen=True)
class _Config:
    models: dict[str, _Model]


def _config(*model_ids: str) -> _Config:
    return _Config(models={model_id: _Model(id=model_id, label=model_id.upper()) for model_id in model_ids})


def _artifact_health(
    *,
    status: ArtifactHealthStatus,
    reason: str,
    progress: CycleProgress | None,
) -> ModelArtifactHealth:
    return ModelArtifactHealth(
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
