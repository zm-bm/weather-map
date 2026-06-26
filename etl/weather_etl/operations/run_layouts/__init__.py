"""Dataset run-layout dispatch for ETL orchestration."""

from __future__ import annotations

import math
from collections.abc import Iterable
from datetime import datetime

from ...config.product import LoadedProductConfig
from ...core.cycles import latest_synoptic_cycles, parse_cycle
from ...environment import EtlEnvironment
from ...state.runs.ids import generate_run_id, parse_run_id
from ...state.runs.snapshots import LoadedRunSnapshot
from ...storage.base import UriStore
from . import cycle_batch, observed_single_frame
from .base import PublishTarget, RunTarget

_HOURLY_CYCLE_HOURS = tuple(range(24))


def local_run_targets(
    *,
    product_config: LoadedProductConfig,
    dataset_id: str | None,
    cycle: str | None,
    run_id: str | None,
    selected_frames: Iterable[str] | None,
    store: UriStore | None,
) -> tuple[RunTarget, ...]:
    """Return concrete immutable run targets for a dataset/cycle request."""

    dataset_ids = _selected_local_dataset_ids(product_config=product_config, dataset_id=dataset_id)
    cycle_batch_ids = tuple(
        current_dataset_id
        for current_dataset_id in dataset_ids
        if product_config.dataset(current_dataset_id).mode == "forecast_cycle"
    )
    cycle_batch_run_id = (parse_run_id(run_id) if run_id else generate_run_id()) if cycle_batch_ids else None

    targets: list[RunTarget] = []
    for current_dataset_id in dataset_ids:
        dataset = product_config.dataset(current_dataset_id)
        if dataset.mode == "forecast_cycle":
            assert cycle_batch_run_id is not None
            targets.append(
                cycle_batch.local_run_target(
                    dataset_id=current_dataset_id,
                    cycle=cycle,
                    run_id=cycle_batch_run_id,
                    selected_frames=selected_frames,
                )
            )
            continue

        targets.extend(
            observed_single_frame.local_run_targets(
                product_config=product_config,
                dataset_id=current_dataset_id,
                run_id=run_id,
                selected_frames=selected_frames,
                store=store,
            )
        )
    return tuple(targets)


def ensure_run_snapshot(
    *,
    env: EtlEnvironment,
    product_config: LoadedProductConfig,
    dataset_id: str,
    cycle: str,
    run_id: str,
    selected_frames: Iterable[str] | None,
) -> LoadedRunSnapshot:
    """Create or verify a run snapshot through the dataset's layout."""

    dataset = product_config.dataset(dataset_id)
    if dataset.mode == "rolling_observed":
        return observed_single_frame.ensure_run_snapshot(
            env=env,
            product_config=product_config,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=parse_run_id(run_id),
            selected_frames=selected_frames,
        )
    return cycle_batch.ensure_run_snapshot(
        env=env,
        product_config=product_config,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=parse_run_id(run_id),
        selected_frames=selected_frames,
    )


def rolling_scan_anchor(*, product_config: LoadedProductConfig, dataset_id: str) -> datetime | None:
    """Return the layout-specific rolling publish scan anchor."""

    dataset = product_config.dataset(dataset_id)
    if dataset.mode != "rolling_observed":
        return None
    return observed_single_frame.rolling_scan_anchor(product_config=product_config, dataset_id=dataset_id)


def has_rolling_publication(product_config: LoadedProductConfig | None, *, dataset_id: str) -> bool:
    """Return whether the dataset publishes a rolling observed latest view."""

    if product_config is None:
        return False
    try:
        dataset = product_config.dataset(dataset_id)
    except SystemExit:
        return False
    return dataset.mode == "rolling_observed"


def publish_scan_cycles(
    *,
    product_config: LoadedProductConfig | None,
    dataset_id: str,
    event_cycles: Iterable[str] | None,
    now: datetime,
    default_forecast_cycle_count: int,
) -> tuple[str, ...]:
    """Return cycle ids to scan for scheduled publication."""

    if event_cycles is not None:
        cycles = tuple(str(cycle).strip() for cycle in event_cycles if str(cycle).strip())
        if not cycles:
            raise SystemExit("cycles did not contain any values")
        for cycle in cycles:
            parse_cycle(cycle)
        return cycles

    if has_rolling_publication(product_config, dataset_id=dataset_id):
        lifecycle = product_config.dataset(dataset_id).lifecycle
        assert lifecycle is not None
        scan_cycle_count = max(1, math.ceil(lifecycle.publish_scan_minutes / 60)) + 2
        cycles = latest_synoptic_cycles(now=now, count=scan_cycle_count, cycle_hours=_HOURLY_CYCLE_HOURS)
    else:
        cycles = latest_synoptic_cycles(now=now, count=default_forecast_cycle_count)
    for cycle in cycles:
        parse_cycle(cycle)
    return cycles


def publish_targets(
    *,
    env: EtlEnvironment,
    product_config: LoadedProductConfig | None,
    dataset_id: str,
    cycles: Iterable[str],
) -> tuple[PublishTarget, ...]:
    """Return persisted run candidates for scheduled publication."""

    if not has_rolling_publication(product_config, dataset_id=dataset_id):
        targets: list[PublishTarget] = []
        for cycle in cycles:
            run_ids = env.artifact_repo.list_run_ids(dataset_id=dataset_id, cycle=cycle)
            if run_ids:
                targets.extend(PublishTarget(dataset_id=dataset_id, cycle=cycle, run_id=run_id) for run_id in run_ids)
                continue
            targets.append(PublishTarget(dataset_id=dataset_id, cycle=cycle, run_id=None))
        return tuple(targets)

    targets: list[PublishTarget] = []
    for cycle in cycles:
        targets.extend(
            PublishTarget(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
            for run_id in env.artifact_repo.list_run_ids(dataset_id=dataset_id, cycle=cycle)
        )
    return tuple(targets)


def _selected_local_dataset_ids(*, product_config: LoadedProductConfig, dataset_id: str | None) -> tuple[str, ...]:
    if dataset_id:
        product_config.dataset(dataset_id)
        return (dataset_id,)
    return tuple(
        current_dataset_id
        for current_dataset_id, dataset in product_config.pipeline_config.datasets.items()
        if dataset.mode == "forecast_cycle"
    )
