"""Scheduled publisher for completed dataset ETL cycles."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from ...core.cycles import latest_synoptic_cycles, parse_cycle
from ...core.timestamps import parse_iso_datetime_utc
from ...environment import EtlEnvironment
from ...operations.publish_cycle import ScheduledPublishResult, publish_candidate
from ...operations.refresh_status import refresh_status
from ...storage.routing import make_store
from ...storage.uris import default_artifact_root_uri, default_catalog_uri, default_pipeline_uri

DEFAULT_ARTIFACT_ROOT_URI = default_artifact_root_uri()
DEFAULT_PIPELINE_URI = default_pipeline_uri()
DEFAULT_CATALOG_URI = default_catalog_uri()
DEFAULT_PUBLISH_DATASETS = ("gfs", "icon")
DEFAULT_PUBLISH_CYCLE_COUNT = 8


@dataclass
class _PublisherStats:
    attempted: int = 0
    ready: int = 0
    published: int = 0
    already_published: int = 0
    latest_promoted: int = 0
    not_ready: int = 0
    failed: int = 0
    failed_by_dataset: dict[str, int] = field(default_factory=dict)
    failures: list[dict[str, str]] = field(default_factory=list)

    def record_failure(self, *, dataset_id: str, cycle: str, error: str) -> None:
        self.failed += 1
        self.failed_by_dataset[dataset_id] = self.failed_by_dataset.get(dataset_id, 0) + 1
        self.failures.append({"dataset_id": dataset_id, "cycle": cycle, "error": error})

    def record_status_failure(self, *, error: str) -> None:
        self.failed += 1
        self.failures.append({"dataset_id": "status", "cycle": "status", "error": f"status refresh failed: {error}"})

    def record_result(self, result: ScheduledPublishResult) -> None:
        if result.outcome == "not_ready":
            self.not_ready += 1
            return
        self.ready += 1
        if result.outcome == "already_published":
            self.already_published += 1
        else:
            self.published += 1
        if result.latest_promoted:
            self.latest_promoted += 1


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
        return parse_iso_datetime_utc(raw)
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
    now = _event_now(event)

    store = make_store()
    env = EtlEnvironment(
        artifact_root_uri=artifact_root_uri,
        pipeline_uri=os.environ.get("PIPELINE_URI", DEFAULT_PIPELINE_URI).strip(),
        catalog_uri=os.environ.get("CATALOG_URI", DEFAULT_CATALOG_URI).strip(),
        store=store,
    )
    cycles = _publish_cycles(event, now=now)
    datasets = _publish_datasets(event)

    stats = _PublisherStats()

    for dataset_id in datasets:
        for cycle in cycles:
            stats.attempted += 1
            try:
                result = publish_candidate(
                    env=env,
                    dataset_id=dataset_id,
                    cycle=cycle,
                )
            except (Exception, SystemExit) as exc:
                stats.record_failure(dataset_id=dataset_id, cycle=cycle, error=str(exc))
                print(f"Publisher failed dataset_id={dataset_id} cycle={cycle}: {exc}", flush=True)
                continue

            if not result.ready:
                stats.record_result(result)
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

            stats.record_result(result)

    try:
        refresh_status(
            env=env,
            dataset_ids=None,
            fallback_dataset_ids=datasets,
            now=now,
        )
    except (Exception, SystemExit) as exc:
        stats.record_status_failure(error=str(exc))
        print(f"Publisher failed to refresh status: {exc}", flush=True)

    return _publisher_response(stats, dataset_count=len(datasets), cycle_count=len(cycles))


def _publisher_response(stats: _PublisherStats, *, dataset_count: int, cycle_count: int) -> dict[str, Any]:
    return {
        "ok": stats.failed == 0,
        "datasets": dataset_count,
        "cycles": cycle_count,
        "attempted": stats.attempted,
        "ready": stats.ready,
        "published": stats.published,
        "already_published": stats.already_published,
        "latest_promoted": stats.latest_promoted,
        "not_ready": stats.not_ready,
        "failed": stats.failed,
        "failures": stats.failures[:10],
    }
