from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from forecast_etl.artifacts.paths import ArtifactPaths
from forecast_etl.config.load import load_pipeline_config
from forecast_etl.inspection.health import read_dataset_artifact_health
from forecast_etl.inspection.snapshot import PublishLagPolicy
from forecast_etl.storage.routing import make_store

from .settings import Settings

HEALTH_SCHEMA = "weather-map.health"
HEALTH_SCHEMA_VERSION = 1
FALLBACK_DATASET_IDS = ("gfs", "icon")


def build_health(settings: Settings, *, now: datetime | None = None) -> dict[str, Any]:
    now = _utc(now)
    store = make_store()
    paths = ArtifactPaths(settings.artifact_root_uri)

    try:
        pipeline_config = load_pipeline_config(settings.pipeline_config_uri)
    except (Exception, SystemExit) as exc:
        return {
            "schema": HEALTH_SCHEMA,
            "schema_version": HEALTH_SCHEMA_VERSION,
            "generated_at": _iso(now),
            "status": "unavailable",
            "datasets": [
                _unavailable_dataset(dataset_id, f"Unable to load ETL config: {_error_message(exc)}")
                for dataset_id in FALLBACK_DATASET_IDS
            ],
        }

    dataset_configs = tuple(pipeline_config.datasets.values())

    def inspect_dataset(dataset: Any) -> dict[str, Any]:
        try:
            return _dataset_health(store=store, paths=paths, dataset=dataset, settings=settings, now=now)
        except (Exception, SystemExit) as exc:
            return _unavailable_dataset(
                dataset.id,
                f"Unable to inspect artifacts: {_error_message(exc)}",
                label=dataset.label,
            )

    max_workers = min(4, len(dataset_configs))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        datasets = list(executor.map(inspect_dataset, dataset_configs))

    if all(dataset["status"] == "fresh" for dataset in datasets):
        status = "healthy"
    elif all(dataset["status"] == "unavailable" for dataset in datasets):
        status = "unavailable"
    else:
        status = "degraded"

    return {
        "schema": HEALTH_SCHEMA,
        "schema_version": HEALTH_SCHEMA_VERSION,
        "generated_at": _iso(now),
        "status": status,
        "datasets": datasets,
    }


def _dataset_health(
    *,
    store: Any,
    paths: ArtifactPaths,
    dataset: Any,
    settings: Settings,
    now: datetime,
) -> dict[str, Any]:
    health = read_dataset_artifact_health(
        store=store,
        paths=paths,
        dataset=dataset,
        now=now,
        history_cycle_count=settings.history_cycle_count,
        status_cycle_count=settings.status_cycle_count,
        publish_lag_policy=_publish_lag_policy(settings),
        recent_progress_hours=settings.recent_progress_hours,
    )
    return _dataset_health_dict(dataset=dataset, health=health)


def _dataset_health_dict(*, dataset: Any, health: Any) -> dict[str, Any]:
    return {
        "dataset_id": dataset.id,
        "label": dataset.label,
        "status": health.status,
        "reason": health.reason,
        "expected_cycle": health.expected_cycle,
        "expected_cycle_deadline": _iso_or_none(health.expected_cycle_deadline),
        "latest_observed_cycle": health.latest_observed_cycle,
        "latest_published_cycle": health.latest_published_cycle,
        "latest_published_generated_at": _iso_or_none(health.latest_published_generated_at),
        "progress": _progress_dict(health.progress) if health.progress is not None else None,
        "publish_lag": {
            "grace_hours": _round_hours(health.publish_lag.hours),
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
        "run_id": progress.run_id,
        "run_count": progress.run_count,
        "published": progress.published,
        "expected_markers": progress.expected_markers,
        "found_markers": progress.found_markers,
        "missing_markers": progress.missing_markers,
        "last_progress_at": _iso_or_none(progress.last_progress_at),
        "missing_sample": list(progress.missing_sample),
        "invalid_marker_sample": list(progress.invalid_marker_sample),
    }


def _unavailable_dataset(dataset_id: str, reason: str, *, label: str | None = None) -> dict[str, Any]:
    return {
        "dataset_id": dataset_id,
        "label": label or dataset_id.upper(),
        "status": "unavailable",
        "reason": reason,
        "expected_cycle": None,
        "expected_cycle_deadline": None,
        "latest_observed_cycle": None,
        "latest_published_cycle": None,
        "latest_published_generated_at": None,
        "progress": None,
        "publish_lag": {
            "grace_hours": None,
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
