from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from forecast_etl.config.load import parse_pipeline_config
from forecast_etl.cycles import cycle_datetime
from forecast_etl.tests.fixtures.artifacts import artifact_fixture
from weather_map_backend.health import build_health
from weather_map_backend.settings import Settings

NOW = datetime(2026, 5, 11, 18, 30, tzinfo=timezone.utc)


def test_health_reports_fresh_complete_expected_cycle(tmp_path: Path) -> None:
    cfg = _repo_config()
    artifacts = artifact_fixture(tmp_path)
    for model_id, model in cfg.models.items():
        cycle = "2026051112"
        artifacts.write_manifest(model_id=model_id, cycle=cycle, generated_at=cycle_datetime(cycle) + timedelta(hours=1))
        _write_status_markers(
            artifacts,
            model_id=model_id,
            cycle=cycle,
            products=model.workload.products,
            fhours=model.workload.forecast_hours,
            modified=NOW,
            published=True,
        )

    health = build_health(_settings(tmp_path), now=NOW)

    assert health["status"] == "healthy"
    assert {model["status"] for model in health["models"]} == {"fresh"}


def test_health_reports_building_when_expected_cycle_has_recent_progress(tmp_path: Path) -> None:
    cfg = _repo_config()
    artifacts = artifact_fixture(tmp_path)
    for model_id, model in cfg.models.items():
        artifacts.write_manifest(
            model_id=model_id,
            cycle="2026051106",
            generated_at=cycle_datetime("2026051106") + timedelta(hours=1),
        )
        _write_status_markers(
            artifacts,
            model_id=model_id,
            cycle="2026051112",
            products=model.workload.products,
            fhours=model.workload.forecast_hours,
            count=4,
            modified=NOW - timedelta(minutes=10),
        )

    health = build_health(_settings(tmp_path), now=NOW)

    assert health["status"] == "degraded"
    assert {model["status"] for model in health["models"]} == {"building"}


def test_health_reports_stalled_when_partial_progress_is_old(tmp_path: Path) -> None:
    cfg = _repo_config()
    artifacts = artifact_fixture(tmp_path)
    for model_id, model in cfg.models.items():
        artifacts.write_manifest(
            model_id=model_id,
            cycle="2026051106",
            generated_at=cycle_datetime("2026051106") + timedelta(hours=1),
        )
        _write_status_markers(
            artifacts,
            model_id=model_id,
            cycle="2026051112",
            products=model.workload.products,
            fhours=model.workload.forecast_hours,
            count=4,
            modified=NOW - timedelta(hours=4),
        )

    health = build_health(_settings(tmp_path), now=NOW)

    assert health["status"] == "degraded"
    assert {model["status"] for model in health["models"]} == {"stalled"}


def test_health_reports_incomplete_when_latest_manifest_is_missing_markers(tmp_path: Path) -> None:
    cfg = _repo_config()
    artifacts = artifact_fixture(tmp_path)
    for model_id, model in cfg.models.items():
        cycle = "2026051112"
        artifacts.write_manifest(model_id=model_id, cycle=cycle, generated_at=cycle_datetime(cycle) + timedelta(hours=1))
        _write_status_markers(
            artifacts,
            model_id=model_id,
            cycle=cycle,
            products=model.workload.products,
            fhours=model.workload.forecast_hours,
            count=4,
            modified=NOW - timedelta(minutes=10),
            published=True,
        )

    health = build_health(_settings(tmp_path), now=NOW)

    assert health["status"] == "degraded"
    assert {model["status"] for model in health["models"]} == {"incomplete"}


def test_health_reports_invalid_markers_without_raising(tmp_path: Path) -> None:
    cfg = _repo_config()
    artifacts = artifact_fixture(tmp_path)
    for model_id, model in cfg.models.items():
        cycle = "2026051112"
        product_id = model.workload.products[0]
        fhour = model.workload.forecast_hours[0]
        artifacts.write_manifest(model_id=model_id, cycle=cycle, generated_at=cycle_datetime(cycle) + timedelta(hours=1))
        artifacts.write_invalid_success_marker(
            model_id=model_id,
            cycle=cycle,
            product_id=product_id,
            fhour=fhour,
            modified=NOW,
        )

    health = build_health(_settings(tmp_path), now=NOW)

    assert health["status"] == "degraded"
    assert {model["status"] for model in health["models"]} == {"incomplete"}
    assert all(model["progress"]["invalidMarkerSample"] for model in health["models"])


def test_health_falls_back_when_no_publish_history_exists(tmp_path: Path) -> None:
    health = build_health(_settings(tmp_path), now=NOW)

    assert health["status"] == "unavailable"
    assert {model["publishLag"]["source"] for model in health["models"]} == {"fallback"}


def _repo_config():
    import json

    path = Path(__file__).resolve().parents[2] / "infra" / "config" / "forecast.etl_config.json"
    return parse_pipeline_config(json.loads(path.read_text(encoding="utf-8")))


def _write_status_markers(
    artifacts,
    *,
    model_id: str,
    cycle: str,
    products: tuple[str, ...],
    fhours: tuple[str, ...],
    modified: datetime,
    count: int | None = None,
    published: bool = False,
) -> None:
    marker_ids = [(product_id, fhour) for product_id in products for fhour in fhours]
    if count is not None:
        marker_ids = marker_ids[:count]
    for product_id, fhour in marker_ids:
        artifacts.write_success_marker(
            model_id=model_id,
            cycle=cycle,
            product_id=product_id,
            fhour=fhour,
            modified=modified,
        )
    if published:
        artifacts.write_published_marker(
            model_id=model_id,
            cycle=cycle,
            generated_at=cycle_datetime(cycle) + timedelta(hours=1),
            modified=modified,
        )


def _settings(root: Path) -> Settings:
    return Settings(
        artifact_root_uri=root.as_uri(),
        pipeline_config_uri=(
            Path(__file__).resolve().parents[2] / "infra" / "config" / "forecast.etl_config.json"
        ).as_uri(),
        stale_fallback_hours=9,
        recent_progress_hours=2,
        publish_grace_cushion_hours=1,
        publish_grace_min_hours=3,
        publish_grace_max_hours=12,
        history_cycle_count=8,
        status_cycle_count=8,
    )
