"""Scheduled publisher for completed dataset ETL runs."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from ...config.product import LoadedProductConfig
from ...core.timestamps import parse_iso_datetime_utc
from ...environment import EtlEnvironment
from ...operations.publish_run import RunCandidatePublishResult, publish_run_candidate
from ...operations.refresh_status import refresh_status
from ...operations.run_layouts import has_rolling_publication, publish_scan_cycles, publish_targets
from ...state.manifest.public_view import DatasetViewPublishResult, publish_dataset_view
from ...storage.routing import make_store
from ...storage.uris import default_artifact_root_uri, default_catalog_uri, default_pipeline_uri

DEFAULT_ARTIFACT_ROOT_URI = default_artifact_root_uri()
DEFAULT_PIPELINE_URI = default_pipeline_uri()
DEFAULT_CATALOG_URI = default_catalog_uri()
DEFAULT_PUBLISH_FORECAST_CYCLE_COUNT = 8


@dataclass
class _PublisherStats:
    attempted: int = 0
    ready: int = 0
    published: int = 0
    already_published: int = 0
    not_ready: int = 0
    rolling_attempted: int = 0
    rolling_ready: int = 0
    rolling_published: int = 0
    rolling_not_ready: int = 0
    failed: int = 0
    failed_by_dataset: dict[str, int] = field(default_factory=dict)
    failures: list[dict[str, str]] = field(default_factory=list)

    def record_failure(self, *, dataset_id: str, cycle: str, error: str, run_id: str | None = None) -> None:
        self.failed += 1
        self.failed_by_dataset[dataset_id] = self.failed_by_dataset.get(dataset_id, 0) + 1
        failure = {"dataset_id": dataset_id, "cycle": cycle, "error": error}
        if run_id is not None:
            failure["run_id"] = run_id
        self.failures.append(failure)

    def record_status_failure(self, *, error: str) -> None:
        self.failed += 1
        self.failures.append({"dataset_id": "status", "cycle": "status", "error": f"status refresh failed: {error}"})

    def record_result(self, result: RunCandidatePublishResult) -> None:
        if result.outcome == "not_ready":
            self.not_ready += 1
            return
        self.ready += 1
        if result.outcome == "already_published":
            self.already_published += 1
        else:
            self.published += 1

    def record_rolling_result(self, result: DatasetViewPublishResult) -> None:
        self.rolling_attempted += 1
        if not result.ready:
            self.rolling_not_ready += 1
            return
        self.rolling_ready += 1
        if result.published:
            self.rolling_published += 1


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


def _publish_datasets(event: dict[str, Any], *, product_config: LoadedProductConfig | None) -> tuple[str, ...]:
    if "datasets" in event:
        return _string_tuple(event.get("datasets"), field_name="datasets")
    env_datasets = os.environ.get("PUBLISH_DATASETS")
    if env_datasets is not None:
        return _string_tuple(env_datasets, field_name="PUBLISH_DATASETS")
    if product_config is None:
        raise SystemExit("PUBLISH_DATASETS is required when pipeline config cannot be loaded")
    return tuple(product_config.pipeline_config.datasets.keys())


def _publish_targets(
    *,
    env: EtlEnvironment,
    product_config: LoadedProductConfig | None,
    dataset_id: str,
    event: dict[str, Any],
    now: datetime,
) -> tuple:
    scan_cycles = _scan_cycles_for_dataset(
        product_config=product_config,
        dataset_id=dataset_id,
        event=event,
        now=now,
    )
    return publish_targets(
        env=env,
        product_config=product_config,
        dataset_id=dataset_id,
        cycles=scan_cycles,
    )


def _scan_cycles_for_dataset(
    *,
    product_config: LoadedProductConfig | None = None,
    dataset_id: str,
    event: dict[str, Any],
    now: datetime,
) -> tuple[str, ...]:
    event_cycles = _string_tuple(event.get("cycles"), field_name="cycles") if "cycles" in event else None
    return publish_scan_cycles(
        product_config=product_config,
        dataset_id=dataset_id,
        event_cycles=event_cycles,
        now=now,
        default_forecast_cycle_count=_int_env(
            "PUBLISH_FORECAST_CYCLE_COUNT",
            DEFAULT_PUBLISH_FORECAST_CYCLE_COUNT,
        ),
    )


def _load_product_config_for_layouts(env: EtlEnvironment) -> LoadedProductConfig | None:
    try:
        return env.load_product_config()
    except FileNotFoundError:
        return None


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Publish ready dataset run manifests for recent or explicitly supplied cycles."""

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
    product_config = _load_product_config_for_layouts(env)
    datasets = _publish_datasets(event, product_config=product_config)

    stats = _PublisherStats()
    scan_cycles: set[str] = set()

    for dataset_id in datasets:
        rolling_publication = has_rolling_publication(product_config, dataset_id=dataset_id)
        for target in _publish_targets(
            env=env,
            product_config=product_config,
            dataset_id=dataset_id,
            event=event,
            now=now,
        ):
            scan_cycles.add(target.cycle)
            stats.attempted += 1
            try:
                result = publish_run_candidate(
                    env=env,
                    dataset_id=target.dataset_id,
                    cycle=target.cycle,
                    required_run_id=target.run_id,
                )
            except (Exception, SystemExit) as exc:
                stats.record_failure(
                    dataset_id=target.dataset_id,
                    cycle=target.cycle,
                    run_id=target.run_id,
                    error=str(exc),
                )
                print(
                    f"Publisher failed dataset_id={target.dataset_id} "
                    f"cycle={target.cycle} run_id={target.run_id or ''}: {exc}",
                    flush=True,
                )
                continue

            if not result.ready:
                stats.record_result(result)
                if result.not_ready_message:
                    if not result.validation_errors:
                        print(
                            f"Publisher not ready dataset_id={target.dataset_id} "
                            f"cycle={target.cycle} run_id={target.run_id or ''}: {result.not_ready_message}",
                            flush=True,
                        )
                    continue
                print(
                    f"Publisher not ready dataset_id={target.dataset_id} cycle={target.cycle} "
                    f"run_id={target.run_id or ''} "
                    f"missing={len(result.missing_markers)}",
                    flush=True,
                )
                continue

            stats.record_result(result)
            if not rolling_publication:
                _refresh_direct_public_view(
                    env=env,
                    stats=stats,
                    dataset_id=target.dataset_id,
                    cycle=target.cycle,
                    result=result,
                )

        if rolling_publication:
            _refresh_rolling_public_view(
                env=env,
                product_config=product_config,
                stats=stats,
                dataset_id=dataset_id,
                now=now,
            )

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

    return _publisher_response(stats, dataset_count=len(datasets), scan_cycle_count=len(scan_cycles))


def _refresh_direct_public_view(
    *,
    env: EtlEnvironment,
    stats: _PublisherStats,
    dataset_id: str,
    cycle: str,
    result: RunCandidatePublishResult,
) -> None:
    try:
        assert result.product_config is not None
        view_result = publish_dataset_view(
            product_config=result.product_config,
            artifact_repo=env.artifact_repo,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=result.run_id,
        )
    except (Exception, SystemExit) as exc:
        stats.record_failure(dataset_id=dataset_id, cycle=cycle, run_id=result.run_id, error=str(exc))
        print(
            f"Publisher failed public view dataset_id={dataset_id} cycle={cycle} run_id={result.run_id or ''}: {exc}",
            flush=True,
        )
        return

    if view_result.ready:
        return

    stats.record_failure(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=result.run_id,
        error=view_result.message or "dataset public view was not ready",
    )
    print(
        f"Publisher public view not ready dataset_id={dataset_id} "
        f"cycle={cycle} run_id={result.run_id or ''}: {view_result.message or ''}",
        flush=True,
    )


def _refresh_rolling_public_view(
    *,
    env: EtlEnvironment,
    product_config: LoadedProductConfig | None,
    stats: _PublisherStats,
    dataset_id: str,
    now: datetime,
) -> None:
    try:
        assert product_config is not None
        rolling_result = publish_dataset_view(
            product_config=product_config,
            artifact_repo=env.artifact_repo,
            dataset_id=dataset_id,
            now=now,
        )
    except (Exception, SystemExit) as exc:
        stats.record_failure(dataset_id=dataset_id, cycle="rolling", error=str(exc))
        print(f"Publisher failed rolling observed dataset_id={dataset_id}: {exc}", flush=True)
        return

    stats.record_rolling_result(rolling_result)
    if not rolling_result.ready and rolling_result.message:
        print(f"Publisher rolling observed not ready dataset_id={dataset_id}: {rolling_result.message}", flush=True)


def _publisher_response(stats: _PublisherStats, *, dataset_count: int, scan_cycle_count: int) -> dict[str, Any]:
    return {
        "ok": stats.failed == 0,
        "datasets": dataset_count,
        "scan_cycles": scan_cycle_count,
        "attempted": stats.attempted,
        "ready": stats.ready,
        "published": stats.published,
        "already_published": stats.already_published,
        "not_ready": stats.not_ready,
        "rolling_attempted": stats.rolling_attempted,
        "rolling_ready": stats.rolling_ready,
        "rolling_published": stats.rolling_published,
        "rolling_not_ready": stats.rolling_not_ready,
        "failed": stats.failed,
        "failures": stats.failures[:10],
    }
