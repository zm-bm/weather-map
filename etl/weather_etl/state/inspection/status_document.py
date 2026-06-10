"""Public ETL status document construction."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from ...config.product import LoadedProductConfig
from ...config.product import product_config_digest as resolved_product_config_digest
from ...core.cycles import cycle_datetime
from ...core.timestamps import as_utc, isoformat_utc
from ...storage.base import UriStore
from ..artifacts.paths import ArtifactPaths
from ..artifacts.repository import ArtifactRepository
from .freshness import (
    NON_ALERTING_DATASET_STATUSES,
    DatasetFreshnessInspection,
    PublishLagPolicy,
    inspect_dataset_freshness,
)
from .manifest_index import summarize_index

STATUS_DOCUMENT_SCHEMA = "weather-map.etl-status"
STATUS_DOCUMENT_SCHEMA_VERSION = 1
DEFAULT_STATUS_DATASET_IDS = ("gfs", "icon")


@dataclass(frozen=True)
class StatusDocumentOptions:
    """Freshness thresholds used while building the public ETL status document."""

    history_cycle_count: int
    status_cycle_count: int
    publish_lag_policy: PublishLagPolicy
    recent_progress_hours: float


def default_status_document_options() -> StatusDocumentOptions:
    """Return the default freshness thresholds used by ETL status generation."""

    return StatusDocumentOptions(
        history_cycle_count=4,
        status_cycle_count=4,
        publish_lag_policy=PublishLagPolicy(
            fallback_hours=9.0,
            cushion_hours=1.0,
            min_hours=3.0,
            max_hours=12.0,
        ),
        recent_progress_hours=2.0,
    )


def build_status_document(
    *,
    store: UriStore,
    artifact_root_uri: str,
    product_config: LoadedProductConfig | None,
    dataset_ids: tuple[str, ...] | None,
    fallback_dataset_ids: tuple[str, ...] = DEFAULT_STATUS_DATASET_IDS,
    options: StatusDocumentOptions,
    now: datetime,
    config_error: str | None = None,
) -> dict[str, Any]:
    """Build a public status document from durable ETL inspection facts."""

    now = as_utc(now)
    paths = ArtifactPaths(artifact_root_uri)
    artifact_repo = ArtifactRepository(store=store, paths=paths)
    resolved_dataset_ids = _status_dataset_ids(
        product_config=product_config,
        dataset_ids=dataset_ids,
        fallback_dataset_ids=fallback_dataset_ids,
    )

    dataset_entries: list[dict[str, Any]] = []
    inspection_failure_count = 0
    for dataset_id in resolved_dataset_ids:
        if product_config is None:
            dataset_entries.append(
                _failed_dataset_entry(
                    dataset_id=dataset_id,
                    reason=f"Unable to load ETL config: {config_error or 'unknown config error'}",
                )
            )
            inspection_failure_count += 1
            continue

        try:
            dataset = product_config.dataset(dataset_id)
            freshness = inspect_dataset_freshness(
                store=store,
                paths=paths,
                dataset=dataset,
                now=now,
                history_cycle_count=options.history_cycle_count,
                status_cycle_count=options.status_cycle_count,
                publish_lag_policy=options.publish_lag_policy,
                recent_progress_hours=options.recent_progress_hours,
            )
            dataset_entries.append(_dataset_entry(dataset=dataset, freshness=freshness))
        except (Exception, SystemExit) as exc:
            dataset_entries.append(
                _failed_dataset_entry(
                    dataset_id=dataset_id,
                    reason=f"Unable to inspect artifacts: {_error_message(exc)}",
                )
            )
            inspection_failure_count += 1

    manifest_index = _manifest_index_entry(
        artifact_repo=artifact_repo,
        product_config=product_config,
    )
    bad_dataset_count = sum(1 for dataset in dataset_entries if dataset["bad_state"])
    ok = (
        config_error is None
        and inspection_failure_count == 0
        and bad_dataset_count == 0
        and bool(manifest_index["valid"])
    )

    return {
        "schema": STATUS_DOCUMENT_SCHEMA,
        "schema_version": STATUS_DOCUMENT_SCHEMA_VERSION,
        "generated_at": isoformat_utc(now),
        "ok": ok,
        "artifact_root_uri": paths.artifact_root_uri,
        "product_config_digest": (
            resolved_product_config_digest(product_config) if product_config is not None else None
        ),
        "config_error": config_error,
        "dataset_count": len(dataset_entries),
        "bad_dataset_count": bad_dataset_count,
        "inspection_failure_count": inspection_failure_count,
        "datasets": dataset_entries,
        "manifest_index": manifest_index,
    }


def failed_status_document(
    *,
    store: UriStore,
    artifact_root_uri: str,
    dataset_ids: tuple[str, ...] | None,
    fallback_dataset_ids: tuple[str, ...] = DEFAULT_STATUS_DATASET_IDS,
    options: StatusDocumentOptions,
    now: datetime,
    config_error: str,
) -> dict[str, Any]:
    """Build a failed status document when the product config cannot be loaded."""

    return build_status_document(
        store=store,
        artifact_root_uri=artifact_root_uri,
        product_config=None,
        dataset_ids=dataset_ids,
        fallback_dataset_ids=fallback_dataset_ids,
        options=options,
        now=now,
        config_error=config_error,
    )


def _status_dataset_ids(
    *,
    product_config: LoadedProductConfig | None,
    dataset_ids: tuple[str, ...] | None,
    fallback_dataset_ids: tuple[str, ...],
) -> tuple[str, ...]:
    if dataset_ids is not None:
        return dataset_ids
    if product_config is None:
        return fallback_dataset_ids
    return tuple(product_config.pipeline_config.datasets)


def _dataset_entry(*, dataset: Any, freshness: DatasetFreshnessInspection) -> dict[str, Any]:
    return {
        "dataset_id": dataset.id,
        "label": dataset.label,
        "status": freshness.status,
        "bad_state": freshness.status not in NON_ALERTING_DATASET_STATUSES,
        "reason": freshness.reason,
        "expected_cycle": freshness.expected_cycle,
        "expected_cycle_deadline": _iso_or_none(freshness.expected_cycle_deadline),
        "latest_observed_cycle": freshness.latest_observed_cycle,
        "latest_published_cycle": freshness.latest_published_cycle,
        "latest_published_generated_at": _iso_or_none(freshness.latest_published_generated_at),
        "latest_cycle_lag_hours": _latest_cycle_lag_hours(
            expected_cycle=freshness.expected_cycle,
            latest_published_cycle=freshness.latest_published_cycle,
        ),
        "lifecycle_stage": freshness.lifecycle_stage,
        "lifecycle_cycle": freshness.lifecycle_cycle,
        "lifecycle_run_id": freshness.lifecycle_run_id,
        "progress": _progress_entry(freshness.progress),
        "publish_lag": {
            "grace_hours": _round_hours(freshness.publish_lag.hours),
            "source": freshness.publish_lag.source,
        },
    }


def _failed_dataset_entry(*, dataset_id: str, reason: str) -> dict[str, Any]:
    return {
        "dataset_id": dataset_id,
        "label": dataset_id.upper(),
        "status": "unavailable",
        "bad_state": True,
        "reason": reason,
        "expected_cycle": None,
        "expected_cycle_deadline": None,
        "latest_observed_cycle": None,
        "latest_published_cycle": None,
        "latest_published_generated_at": None,
        "latest_cycle_lag_hours": 0.0,
        "lifecycle_stage": None,
        "lifecycle_cycle": None,
        "lifecycle_run_id": None,
        "progress": None,
        "publish_lag": {
            "grace_hours": None,
            "source": "unavailable",
        },
    }


def _manifest_index_entry(
    *,
    artifact_repo: ArtifactRepository,
    product_config: LoadedProductConfig | None,
) -> dict[str, Any]:
    try:
        summary = summarize_index(
            artifact_repo=artifact_repo,
            product_config=product_config,
        )
    except (Exception, SystemExit) as exc:
        summary = {
            "status": "malformed",
            "path": artifact_repo.paths.relative_key(artifact_repo.paths.manifest_index_uri()),
            "diagnostics": [f"unable to inspect manifest index: {_error_message(exc)}"],
        }

    status = str(summary.get("status") or "unknown")
    return {
        **summary,
        "status": status,
        "valid": status == "valid",
    }


def _progress_entry(progress: Any) -> dict[str, Any] | None:
    if progress is None:
        return None
    return {
        "cycle": progress.cycle,
        "run_id": progress.run_id,
        "run_count": progress.run_count,
        "published": progress.publication_present,
        "manifest_present": progress.manifest_present,
        "expected_markers": progress.expected_markers,
        "found_markers": progress.found_markers,
        "missing_markers": progress.missing_markers,
        "last_progress_at": _iso_or_none(progress.last_progress_at),
        "missing_sample": list(progress.missing_sample),
        "invalid_marker_sample": list(progress.invalid_marker_sample),
    }


def _latest_cycle_lag_hours(*, expected_cycle: str | None, latest_published_cycle: str | None) -> float:
    if expected_cycle is None or latest_published_cycle is None or latest_published_cycle >= expected_cycle:
        return 0.0
    return max(0.0, (cycle_datetime(expected_cycle) - cycle_datetime(latest_published_cycle)).total_seconds() / 3600)


def _round_hours(value: float) -> float:
    return round(value, 2)


def _iso_or_none(value: datetime | None) -> str | None:
    return isoformat_utc(value) if value is not None else None


def _error_message(exc: BaseException) -> str:
    message = str(exc).strip()
    return message or exc.__class__.__name__
