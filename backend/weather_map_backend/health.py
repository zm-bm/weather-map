from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any

from .settings import Settings
from .status_document import DEFAULT_STATUS_DATASET_IDS, read_status_document

SCHEMA = "weather-map.health"
SCHEMA_VERSION = 2


def build_health(settings: Settings, *, now: datetime | None = None) -> dict[str, Any]:
    """Format the published ETL status document for the backend health API."""

    try:
        status_document = read_status_document(artifact_root_uri=settings.artifact_root_uri)
    except (Exception, SystemExit) as exc:
        return _unavailable_health(now=_utc(now), reason=f"Unable to read ETL status: {_error_message(exc)}")

    datasets = [_dataset_health(dataset) for dataset in status_document["datasets"]]
    return {
        "schema": SCHEMA,
        "schema_version": SCHEMA_VERSION,
        "generated_at": status_document["generated_at"],
        "status": _overall_status(datasets),
        "datasets": datasets,
    }


def _dataset_health(dataset: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "dataset_id": dataset.get("dataset_id"),
        "label": dataset.get("label"),
        "status": dataset.get("status"),
        "reason": dataset.get("reason"),
        "expected_cycle": dataset.get("expected_cycle"),
        "expected_cycle_deadline": dataset.get("expected_cycle_deadline"),
        "latest_observed_cycle": dataset.get("latest_observed_cycle"),
        "latest_published_cycle": dataset.get("latest_published_cycle"),
        "latest_published_generated_at": dataset.get("latest_published_generated_at"),
        "lifecycle_stage": dataset.get("lifecycle_stage"),
        "lifecycle_cycle": dataset.get("lifecycle_cycle"),
        "lifecycle_run_id": dataset.get("lifecycle_run_id"),
        "progress": _progress(dataset.get("progress")),
        "publish_lag": _publish_lag(dataset.get("publish_lag")),
    }


def _progress(progress: Any) -> dict[str, Any] | None:
    if not isinstance(progress, Mapping):
        return None
    return {
        "cycle": progress.get("cycle"),
        "run_id": progress.get("run_id"),
        "run_count": progress.get("run_count"),
        "published": progress.get("published"),
        "expected_markers": progress.get("expected_markers"),
        "found_markers": progress.get("found_markers"),
        "missing_markers": progress.get("missing_markers"),
        "last_progress_at": progress.get("last_progress_at"),
        "missing_sample": list(progress.get("missing_sample") or ()),
        "invalid_marker_sample": list(progress.get("invalid_marker_sample") or ()),
    }


def _publish_lag(publish_lag: Any) -> dict[str, Any]:
    if not isinstance(publish_lag, Mapping):
        return {
            "grace_hours": None,
            "source": "unavailable",
        }
    return {
        "grace_hours": publish_lag.get("grace_hours"),
        "source": publish_lag.get("source"),
    }


def _overall_status(datasets: list[dict[str, Any]]) -> str:
    if datasets and all(dataset["status"] == "fresh" for dataset in datasets):
        return "healthy"
    if not datasets or all(dataset["status"] == "unavailable" for dataset in datasets):
        return "unavailable"
    return "degraded"


def _unavailable_health(*, now: datetime, reason: str) -> dict[str, Any]:
    return {
        "schema": SCHEMA,
        "schema_version": SCHEMA_VERSION,
        "generated_at": _iso(now),
        "status": "unavailable",
        "datasets": [_unavailable_dataset(dataset_id, reason) for dataset_id in DEFAULT_STATUS_DATASET_IDS],
    }


def _unavailable_dataset(dataset_id: str, reason: str) -> dict[str, Any]:
    return {
        "dataset_id": dataset_id,
        "label": dataset_id.upper(),
        "status": "unavailable",
        "reason": reason,
        "expected_cycle": None,
        "expected_cycle_deadline": None,
        "latest_observed_cycle": None,
        "latest_published_cycle": None,
        "latest_published_generated_at": None,
        "lifecycle_stage": None,
        "lifecycle_cycle": None,
        "lifecycle_run_id": None,
        "progress": None,
        "publish_lag": {
            "grace_hours": None,
            "source": "unavailable",
        },
    }


def _utc(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(tz=timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _iso(value: datetime) -> str:
    return _utc(value).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _error_message(exc: BaseException) -> str:
    message = str(exc).strip()
    return message or exc.__class__.__name__
