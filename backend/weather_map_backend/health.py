from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from forecast_etl.artifacts.paths import ArtifactPaths
from forecast_etl.artifacts.snapshot import (
    ModelArtifactSnapshot,
    PublishLagPolicy,
    read_model_artifact_snapshot,
)
from forecast_etl.artifacts.status import CycleProgress
from forecast_etl.config.parse import load_pipeline_config
from forecast_etl.config.schema import ModelConfig
from forecast_etl.stores import make_store
from forecast_etl.stores.base import UriStore

from .settings import Settings

HEALTH_SCHEMA = "weather-map.health"
HEALTH_SCHEMA_VERSION = 1
FALLBACK_MODEL_IDS = ("gfs", "icon")
MARKER_VALIDATION_SAMPLE_LIMIT = 5
MISSING_SAMPLE_LIMIT = 12


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

    models: list[dict[str, Any]] = []
    for model in pipeline_config.models.values():
        try:
            models.append(_model_health(store=store, paths=paths, model=model, settings=settings, now=now))
        except (Exception, SystemExit) as exc:
            models.append(_unavailable_model(model.id, f"Unable to inspect artifacts: {_error_message(exc)}", label=model.label))

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
    store: UriStore,
    paths: ArtifactPaths,
    model: ModelConfig,
    settings: Settings,
    now: datetime,
) -> dict[str, Any]:
    snapshot = read_model_artifact_snapshot(
        store=store,
        paths=paths,
        model=model,
        now=now,
        history_cycle_count=settings.history_cycle_count,
        status_cycle_count=settings.status_cycle_count,
        publish_lag_policy=PublishLagPolicy(
            fallback_hours=settings.stale_fallback_hours,
            cushion_hours=settings.publish_grace_cushion_hours,
            min_hours=settings.publish_grace_min_hours,
            max_hours=settings.publish_grace_max_hours,
        ),
        missing_sample_limit=MISSING_SAMPLE_LIMIT,
        marker_validation_sample_limit=MARKER_VALIDATION_SAMPLE_LIMIT,
    )

    status, reason = _classify_model(
        snapshot=snapshot,
        now=now,
        recent_progress_hours=settings.recent_progress_hours,
    )

    return {
        "id": model.id,
        "label": model.label,
        "status": status,
        "reason": reason,
        "expectedCycle": snapshot.expected_cycle,
        "expectedCycleDeadline": _iso(snapshot.expected_cycle_deadline),
        "latestObservedCycle": snapshot.latest_observed_cycle,
        "latestPublishedCycle": snapshot.latest_published_cycle,
        "latestPublishedGeneratedAt": _iso_or_none(snapshot.latest_published_generated_at),
        "progress": _progress_dict(snapshot.progress),
        "publishLag": {
            "graceHours": _round_hours(snapshot.publish_lag.hours),
            "source": snapshot.publish_lag.source,
        },
    }


def _classify_model(
    *,
    snapshot: ModelArtifactSnapshot,
    now: datetime,
    recent_progress_hours: float,
) -> tuple[str, str]:
    progress = snapshot.progress
    if progress.invalid_marker_sample:
        return "incomplete", "One or more success markers could not be parsed."

    if snapshot.latest_published_cycle is not None and snapshot.latest_published_cycle >= snapshot.expected_cycle:
        published_progress = snapshot.progress_by_cycle.get(snapshot.latest_published_cycle)
        if published_progress is not None and published_progress.complete:
            return "fresh", "Latest expected cycle is published and marker-complete."
        return "incomplete", "Latest published cycle is missing expected success markers."

    if progress.complete and not (progress.published and progress.manifest_present):
        return "incomplete", "Success markers are complete, but publish marker or manifest is missing."

    if progress.found_markers > 0:
        if _has_recent_progress(progress, now=now, recent_progress_hours=recent_progress_hours):
            return "building", "Expected cycle is still building with recent marker progress."
        return "stalled", "Expected cycle has partial artifacts but no recent marker progress."

    if snapshot.latest_published_cycle is None:
        return "unavailable", "No latest manifest or status artifacts were found."

    return "stale", "No complete published cycle is available for the expected cycle."


def _progress_dict(progress: CycleProgress) -> dict[str, Any]:
    return {
        "cycle": progress.cycle,
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


def _has_recent_progress(progress: CycleProgress, *, now: datetime, recent_progress_hours: float) -> bool:
    if progress.last_progress_at is None:
        return False
    return now - progress.last_progress_at <= timedelta(hours=recent_progress_hours)


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
