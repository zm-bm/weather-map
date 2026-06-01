from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from forecast_etl.artifacts.health import read_model_artifact_health
from forecast_etl.artifacts.paths import ArtifactPaths
from forecast_etl.artifacts.snapshot import PublishLagPolicy
from forecast_etl.config.load import load_pipeline_config
from forecast_etl.storage.routing import make_store

from .settings import Settings

HEALTH_SCHEMA = "weather-map.health"
HEALTH_SCHEMA_VERSION = 1
FALLBACK_MODEL_IDS = ("gfs", "icon")


def build_health(settings: Settings, *, now: datetime | None = None) -> dict[str, Any]:
    now = _utc(now)
    store = make_store()
    paths = ArtifactPaths(settings.artifact_root_uri)

    try:
        pipeline_config = load_pipeline_config(settings.pipeline_config_uri)
    except (Exception, SystemExit) as exc:
        return {
            "schema": HEALTH_SCHEMA,
            "schemaVersion": HEALTH_SCHEMA_VERSION,
            "generatedAt": _iso(now),
            "status": "unavailable",
            "models": [
                _unavailable_model(model_id, f"Unable to load ETL config: {_error_message(exc)}")
                for model_id in FALLBACK_MODEL_IDS
            ],
        }

    model_configs = tuple(pipeline_config.models.values())

    def inspect_model(model: Any) -> dict[str, Any]:
        try:
            return _model_health(store=store, paths=paths, model=model, settings=settings, now=now)
        except (Exception, SystemExit) as exc:
            return _unavailable_model(model.id, f"Unable to inspect artifacts: {_error_message(exc)}", label=model.label)

    max_workers = min(4, len(model_configs))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        models = list(executor.map(inspect_model, model_configs))

    if all(model["status"] == "fresh" for model in models):
        status = "healthy"
    elif all(model["status"] == "unavailable" for model in models):
        status = "unavailable"
    else:
        status = "degraded"

    return {
        "schema": HEALTH_SCHEMA,
        "schemaVersion": HEALTH_SCHEMA_VERSION,
        "generatedAt": _iso(now),
        "status": status,
        "models": models,
    }


def _model_health(
    *,
    store: Any,
    paths: ArtifactPaths,
    model: Any,
    settings: Settings,
    now: datetime,
) -> dict[str, Any]:
    health = read_model_artifact_health(
        store=store,
        paths=paths,
        model=model,
        now=now,
        history_cycle_count=settings.history_cycle_count,
        status_cycle_count=settings.status_cycle_count,
        publish_lag_policy=_publish_lag_policy(settings),
        recent_progress_hours=settings.recent_progress_hours,
    )
    return _model_health_dict(model=model, health=health)


def _model_health_dict(*, model: Any, health: Any) -> dict[str, Any]:
    return {
        "id": model.id,
        "label": model.label,
        "status": health.status,
        "reason": health.reason,
        "expectedCycle": health.expected_cycle,
        "expectedCycleDeadline": _iso_or_none(health.expected_cycle_deadline),
        "latestObservedCycle": health.latest_observed_cycle,
        "latestPublishedCycle": health.latest_published_cycle,
        "latestPublishedGeneratedAt": _iso_or_none(health.latest_published_generated_at),
        "progress": _progress_dict(health.progress) if health.progress is not None else None,
        "publishLag": {
            "graceHours": _round_hours(health.publish_lag.hours),
            "source": health.publish_lag.source,
        },
    }


def _publish_lag_policy(settings: Settings) -> PublishLagPolicy:
    return PublishLagPolicy(
        fallback_hours=settings.stale_fallback_hours,
        cushion_hours=settings.publish_grace_cushion_hours,
        min_hours=settings.publish_grace_min_hours,
        max_hours=settings.publish_grace_max_hours,
    )


def _progress_dict(progress: Any) -> dict[str, Any]:
    return {
        "cycle": progress.cycle,
        "runId": progress.run_id,
        "runCount": progress.run_count,
        "published": progress.published,
        "expectedMarkers": progress.expected_markers,
        "foundMarkers": progress.found_markers,
        "missingMarkers": progress.missing_markers,
        "lastProgressAt": _iso_or_none(progress.last_progress_at),
        "missingSample": list(progress.missing_sample),
        "invalidMarkerSample": list(progress.invalid_marker_sample),
    }


def _unavailable_model(model_id: str, reason: str, *, label: str | None = None) -> dict[str, Any]:
    return {
        "id": model_id,
        "label": label or model_id.upper(),
        "status": "unavailable",
        "reason": reason,
        "expectedCycle": None,
        "expectedCycleDeadline": None,
        "latestObservedCycle": None,
        "latestPublishedCycle": None,
        "latestPublishedGeneratedAt": None,
        "progress": None,
        "publishLag": {
            "graceHours": None,
            "source": "unavailable",
        },
    }


def _round_hours(value: float) -> float:
    return round(value, 2)


def _utc(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(tz=timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _iso(value: datetime) -> str:
    return _utc(value).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _iso_or_none(value: datetime | None) -> str | None:
    return _iso(value) if value is not None else None


def _error_message(exc: BaseException) -> str:
    message = str(exc).strip()
    return message or exc.__class__.__name__
