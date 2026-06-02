"""Scheduled publisher for completed dataset ETL cycles."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from ..cycles import latest_synoptic_cycles, parse_cycle
from ..storage.routing import make_store
from ..uris import default_artifact_root_uri, default_forecast_catalog_uri, default_pipeline_config_uri
from ..workflows.context import ApplicationContext
from ..workflows.publisher import publish_candidate
from .metrics import DEFAULT_METRIC_NAMESPACE, cloudwatch_client, emit_metrics, metric_datum

DEFAULT_ARTIFACT_ROOT_URI = default_artifact_root_uri()
DEFAULT_PIPELINE_CONFIG_URI = default_pipeline_config_uri()
DEFAULT_FORECAST_CATALOG_URI = default_forecast_catalog_uri()
DEFAULT_PUBLISH_DATASETS = ("gfs", "icon")
DEFAULT_PUBLISH_CYCLE_COUNT = 8


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise SystemExit(f"{name} must be an integer, got: {raw!r}") from exc
    return max(0, value)


def _event_now(event: dict[str, Any]) -> datetime:
    raw = event.get("time")
    if isinstance(raw, str) and raw.strip():
        text = raw.strip().replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
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


def _publish_datasets(event: dict[str, Any]) -> tuple[str, ...]:
    if "datasets" in event:
        return _string_tuple(event.get("datasets"), field_name="datasets")
    return _string_tuple(os.environ.get("PUBLISH_DATASETS", ",".join(DEFAULT_PUBLISH_DATASETS)), field_name="PUBLISH_DATASETS")


def _publish_cycles(event: dict[str, Any], *, now: datetime) -> tuple[str, ...]:
    if "cycles" in event:
        cycles = _string_tuple(event.get("cycles"), field_name="cycles")
    else:
        cycles = latest_synoptic_cycles(now=now, count=_int_env("PUBLISH_CYCLE_COUNT", DEFAULT_PUBLISH_CYCLE_COUNT))
    for cycle in cycles:
        parse_cycle(cycle)
    return cycles


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Publish ready dataset cycle manifests for recent or explicitly supplied cycles."""

    del context
    event = event if isinstance(event, dict) else {}
    artifact_root_uri = os.environ.get("ARTIFACT_ROOT_URI", DEFAULT_ARTIFACT_ROOT_URI).strip()

    store = make_store()
    app_context = ApplicationContext(
        artifact_root_uri=artifact_root_uri,
        pipeline_config_uri=os.environ.get("PIPELINE_CONFIG_URI", DEFAULT_PIPELINE_CONFIG_URI).strip(),
        forecast_catalog_uri=os.environ.get("FORECAST_CATALOG_URI", DEFAULT_FORECAST_CATALOG_URI).strip(),
        store=store,
    )
    cycles = _publish_cycles(event, now=_event_now(event))
    datasets = _publish_datasets(event)

    attempted = 0
    ready = 0
    published = 0
    already_published = 0
    latest_promoted = 0
    not_ready = 0
    failed = 0
    failed_by_dataset: dict[str, int] = {}
    failures: list[dict[str, str]] = []

    for dataset_id in datasets:
        for cycle in cycles:
            attempted += 1
            try:
                result = publish_candidate(
                    app_context=app_context,
                    dataset_id=dataset_id,
                    cycle=cycle,
                )
            except (Exception, SystemExit) as exc:
                failed += 1
                failed_by_dataset[dataset_id] = failed_by_dataset.get(dataset_id, 0) + 1
                failures.append({"dataset_id": dataset_id, "cycle": cycle, "error": str(exc)})
                print(f"Publisher failed dataset_id={dataset_id} cycle={cycle}: {exc}", flush=True)
                continue

            if not result.ready:
                not_ready += 1
                if result.not_ready_message:
                    if not result.validation_errors:
                        print(
                            f"Publisher not ready dataset_id={dataset_id} cycle={cycle}: {result.not_ready_message}",
                            flush=True,
                        )
                    continue
                print(
                    f"Publisher not ready dataset_id={dataset_id} cycle={cycle} "
                    f"missing={len(result.missing_markers)}",
                    flush=True,
                )
                continue

            ready += 1
            if result.already_published:
                already_published += 1
            else:
                published += 1
            if result.latest_promoted:
                latest_promoted += 1

    if failed:
        _emit_failure_metrics(failed=failed, failed_by_dataset=failed_by_dataset)

    return {
        "ok": failed == 0,
        "datasets": len(datasets),
        "cycles": len(cycles),
        "attempted": attempted,
        "ready": ready,
        "published": published,
        "already_published": already_published,
        "latest_promoted": latest_promoted,
        "not_ready": not_ready,
        "failed": failed,
        "failures": failures[:10],
    }


def _emit_failure_metrics(*, failed: int, failed_by_dataset: dict[str, int]) -> None:
    namespace = os.environ.get("OBSERVABILITY_METRIC_NAMESPACE", DEFAULT_METRIC_NAMESPACE).strip() or DEFAULT_METRIC_NAMESPACE
    metrics = [
        metric_datum(
            name="PublisherFailedCandidates",
            value=failed,
            dimensions={"Component": "publisher"},
        )
    ]
    metrics.extend(
        metric_datum(
            name="PublisherFailedCandidates",
            value=count,
            dimensions={"Component": "publisher", "Dataset": dataset_id},
        )
        for dataset_id, count in sorted(failed_by_dataset.items())
    )
    try:
        emit_metrics(cloudwatch=cloudwatch_client(), namespace=namespace, metrics=metrics)
    except (Exception, SystemExit) as exc:
        print(f"Publisher failed to emit failure metrics: {exc}", flush=True)
