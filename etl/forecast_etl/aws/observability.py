"""Read-only ETL observability checker for AWS Lambda."""

from __future__ import annotations

import os
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any

from ..artifacts.paths import ArtifactPaths
from ..artifacts.repository import ArtifactRepository
from ..config.load import load_pipeline_config
from ..cycles import cycle_datetime
from ..inspection.data_manifest import data_manifest_summary
from ..inspection.health import read_dataset_artifact_health
from ..inspection.snapshot import PublishLagPolicy
from ..storage.routing import make_store
from ..uris import default_artifact_root_uri, default_pipeline_config_uri
from .metrics import DEFAULT_METRIC_NAMESPACE, cloudwatch_client, emit_metrics, metric_datum

OBSERVABILITY_SCHEMA = "weather-map.etl-observability-check"
OBSERVABILITY_SCHEMA_VERSION = 1
DEFAULT_OBSERVABILITY_DATASETS = ("gfs", "icon")
NON_ALERTING_DATASET_STATUSES = {"fresh", "building"}


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Inspect ETL artifact state and emit low-cardinality CloudWatch metrics."""

    del context
    event = event if isinstance(event, dict) else {}
    namespace = _string_env("OBSERVABILITY_METRIC_NAMESPACE", DEFAULT_METRIC_NAMESPACE)
    report, metrics = build_report(event=event)
    emitted = emit_metrics(cloudwatch=cloudwatch_client(), namespace=namespace, metrics=metrics)
    return {**report, "emitted_metric_count": emitted}


def build_report(*, event: Mapping[str, Any] | None = None, now: datetime | None = None) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Build a read-only observability report and its CloudWatch metrics."""

    event = event or {}
    now = _event_now(event, default=now)
    artifact_root_uri = _string_env("ARTIFACT_ROOT_URI", default_artifact_root_uri())
    pipeline_config_uri = _string_env("PIPELINE_CONFIG_URI", default_pipeline_config_uri())
    dataset_ids = _dataset_ids(event)
    store = make_store()
    paths = ArtifactPaths(artifact_root_uri)
    metrics: list[dict[str, Any]] = []

    config_error: str | None = None
    try:
        pipeline_config = load_pipeline_config(pipeline_config_uri, store=store)
        if dataset_ids is None:
            dataset_ids = tuple(pipeline_config.datasets)
    except (Exception, SystemExit) as exc:
        pipeline_config = None
        config_error = _error_message(exc)
        dataset_ids = dataset_ids or _string_tuple(
            os.environ.get("OBSERVABILITY_DATASETS", ",".join(DEFAULT_OBSERVABILITY_DATASETS)),
            field_name="OBSERVABILITY_DATASETS",
        )

    dataset_reports: list[dict[str, Any]] = []
    inspection_failures = 0
    for dataset_id in dataset_ids:
        if pipeline_config is None:
            dataset_report = _failed_dataset_report(
                dataset_id=dataset_id,
                reason=f"Unable to load ETL config: {config_error}",
            )
            inspection_failures += 1
        else:
            try:
                dataset_report = _dataset_report(
                    store=store,
                    paths=paths,
                    dataset=pipeline_config.dataset(dataset_id),
                    now=now,
                )
            except (Exception, SystemExit) as exc:
                dataset_report = _failed_dataset_report(
                    dataset_id=dataset_id,
                    reason=f"Unable to inspect artifacts: {_error_message(exc)}",
                )
                inspection_failures += 1
        dataset_reports.append(dataset_report)
        metrics.extend(_dataset_metrics(dataset_report))

    manifest_report = _data_manifest_report(store=store, paths=paths)
    metrics.append(
        metric_datum(
            name="DataManifestValid",
            value=1 if manifest_report["valid"] else 0,
            dimensions={"Component": "observability"},
        )
    )

    bad_dataset_count = sum(1 for dataset in dataset_reports if dataset["bad_state"])
    ok = config_error is None and inspection_failures == 0 and bad_dataset_count == 0 and manifest_report["valid"]
    metrics.append(
        metric_datum(
            name="ObservabilityCheckOk",
            value=1 if ok else 0,
            dimensions={"Component": "observability"},
        )
    )

    report = {
        "schema": OBSERVABILITY_SCHEMA,
        "schema_version": OBSERVABILITY_SCHEMA_VERSION,
        "generated_at": _iso(now),
        "ok": ok,
        "artifact_root_uri": artifact_root_uri,
        "pipeline_config_uri": pipeline_config_uri,
        "dataset_count": len(dataset_reports),
        "bad_dataset_count": bad_dataset_count,
        "inspection_failure_count": inspection_failures,
        "config_error": config_error,
        "datasets": dataset_reports,
        "data_manifest": manifest_report,
    }
    return report, metrics


def _dataset_report(*, store: Any, paths: ArtifactPaths, dataset: Any, now: datetime) -> dict[str, Any]:
    health = read_dataset_artifact_health(
        store=store,
        paths=paths,
        dataset=dataset,
        now=now,
        history_cycle_count=_int_env("HEALTH_HISTORY_CYCLE_COUNT", 4, minimum=1),
        status_cycle_count=_int_env("HEALTH_STATUS_CYCLE_COUNT", 4, minimum=1),
        publish_lag_policy=PublishLagPolicy(
            fallback_hours=_float_env("HEALTH_STALE_FALLBACK_HOURS", 9.0),
            cushion_hours=_float_env("HEALTH_PUBLISH_GRACE_CUSHION_HOURS", 1.0),
            min_hours=_float_env("HEALTH_PUBLISH_GRACE_MIN_HOURS", 3.0),
            max_hours=_float_env("HEALTH_PUBLISH_GRACE_MAX_HOURS", 12.0),
        ),
        recent_progress_hours=_float_env("HEALTH_RECENT_PROGRESS_HOURS", 2.0),
    )
    latest_cycle_lag_hours = _latest_cycle_lag_hours(
        expected_cycle=health.expected_cycle,
        latest_published_cycle=health.latest_published_cycle,
    )
    return {
        "dataset_id": dataset.id,
        "label": dataset.label,
        "status": health.status,
        "bad_state": health.status not in NON_ALERTING_DATASET_STATUSES,
        "reason": health.reason,
        "expected_cycle": health.expected_cycle,
        "latest_observed_cycle": health.latest_observed_cycle,
        "latest_published_cycle": health.latest_published_cycle,
        "latest_cycle_lag_hours": latest_cycle_lag_hours,
        "progress": _progress_summary(health.progress),
    }


def _failed_dataset_report(*, dataset_id: str, reason: str) -> dict[str, Any]:
    return {
        "dataset_id": dataset_id,
        "label": dataset_id.upper(),
        "status": "unavailable",
        "bad_state": True,
        "reason": reason,
        "expected_cycle": None,
        "latest_observed_cycle": None,
        "latest_published_cycle": None,
        "latest_cycle_lag_hours": 0.0,
        "progress": None,
    }


def _data_manifest_report(*, store: Any, paths: ArtifactPaths) -> dict[str, Any]:
    try:
        summary = data_manifest_summary(artifact_repo=ArtifactRepository(store=store, paths=paths))
    except (Exception, SystemExit) as exc:
        summary = {
            "status": "malformed",
            "path": paths.relative_key(paths.data_manifest_uri()),
            "diagnostics": [f"unable to inspect data manifest: {_error_message(exc)}"],
        }
    status = str(summary.get("status") or "unknown")
    return {
        "status": status,
        "valid": status == "valid",
        "path": summary.get("path"),
        "generated_at": summary.get("generated_at"),
        "dataset_count": summary.get("dataset_count"),
        "latest_dataset_count": summary.get("latest_dataset_count"),
        "diagnostics": list(summary.get("diagnostics") or ()),
    }


def _dataset_metrics(dataset_report: Mapping[str, Any]) -> list[dict[str, Any]]:
    dimensions = {"Component": "observability", "Dataset": str(dataset_report["dataset_id"])}
    return [
        metric_datum(
            name="DatasetBadState",
            value=1 if dataset_report["bad_state"] else 0,
            dimensions=dimensions,
        ),
        metric_datum(
            name="DatasetFresh",
            value=1 if dataset_report["status"] == "fresh" else 0,
            dimensions=dimensions,
        ),
        metric_datum(
            name="LatestCycleLagHours",
            value=float(dataset_report["latest_cycle_lag_hours"] or 0.0),
            dimensions=dimensions,
            unit="None",
        ),
    ]


def _progress_summary(progress: Any) -> dict[str, Any] | None:
    if progress is None:
        return None
    return {
        "cycle": progress.cycle,
        "run_id": progress.run_id,
        "expected_markers": progress.expected_markers,
        "found_markers": progress.found_markers,
        "missing_markers": progress.missing_markers,
        "published": progress.published,
        "manifest_present": progress.manifest_present,
    }


def _latest_cycle_lag_hours(*, expected_cycle: str | None, latest_published_cycle: str | None) -> float:
    if expected_cycle is None or latest_published_cycle is None or latest_published_cycle >= expected_cycle:
        return 0.0
    return max(0.0, (cycle_datetime(expected_cycle) - cycle_datetime(latest_published_cycle)).total_seconds() / 3600)


def _dataset_ids(event: Mapping[str, Any]) -> tuple[str, ...] | None:
    if "datasets" in event:
        return _string_tuple(event.get("datasets"), field_name="datasets")
    raw = os.environ.get("OBSERVABILITY_DATASETS")
    if raw is None or not raw.strip():
        return None
    return _string_tuple(raw, field_name="OBSERVABILITY_DATASETS")


def _event_now(event: Mapping[str, Any], *, default: datetime | None) -> datetime:
    raw = event.get("time")
    if isinstance(raw, str) and raw.strip():
        parsed = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    if default is not None:
        return _utc(default)
    return datetime.now(timezone.utc)


def _string_tuple(value: Any, *, field_name: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        parts = value.replace(",", " ").split()
    elif isinstance(value, (list, tuple)):
        parts = [str(part) for part in value]
    else:
        raise SystemExit(f"{field_name} must be a string or array of strings")
    resolved = tuple(part.strip() for part in parts if part.strip())
    if not resolved:
        raise SystemExit(f"{field_name} did not contain any values")
    return resolved


def _string_env(name: str, default: str) -> str:
    raw = os.environ.get(name)
    return raw.strip() if raw is not None and raw.strip() else default


def _int_env(name: str, default: int, *, minimum: int = 0) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise SystemExit(f"{name} must be an integer, got: {raw!r}") from exc
    return max(minimum, value)


def _float_env(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise SystemExit(f"{name} must be a number, got: {raw!r}") from exc


def _iso(value: datetime) -> str:
    return _utc(value).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _error_message(exc: BaseException) -> str:
    message = str(exc).strip()
    return message or exc.__class__.__name__
