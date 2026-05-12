"""Read-only artifact snapshots for one configured forecast model."""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta

from ..config.schema import ModelConfig
from ..cycles import cycle_datetime, expected_synoptic_cycle, latest_synoptic_cycles
from ..manifest.inspect import ManifestInfo, list_manifest_infos, read_latest_manifest_info
from ..stores.base import UriStore
from .paths import ArtifactPaths
from .status import (
    DEFAULT_MARKER_VALIDATION_SAMPLE_LIMIT,
    DEFAULT_MISSING_SAMPLE_LIMIT,
    CycleProgress,
    read_cycle_progress,
)

MAX_REASONABLE_PUBLISH_LAG_HOURS = 72


@dataclass(frozen=True)
class PublishLagPolicy:
    fallback_hours: float
    cushion_hours: float
    min_hours: float
    max_hours: float


@dataclass(frozen=True)
class PublishLagEstimate:
    hours: float
    source: str


@dataclass(frozen=True)
class ModelArtifactSnapshot:
    expected_cycle: str
    expected_cycle_deadline: datetime
    latest_observed_cycle: str | None
    latest_published_cycle: str | None
    latest_published_generated_at: datetime | None
    progress: CycleProgress
    progress_by_cycle: Mapping[str, CycleProgress]
    publish_lag: PublishLagEstimate


def read_model_artifact_snapshot(
    *,
    store: UriStore,
    paths: ArtifactPaths,
    model: ModelConfig,
    now: datetime,
    history_cycle_count: int,
    status_cycle_count: int,
    publish_lag_policy: PublishLagPolicy,
    missing_sample_limit: int = DEFAULT_MISSING_SAMPLE_LIMIT,
    marker_validation_sample_limit: int = DEFAULT_MARKER_VALIDATION_SAMPLE_LIMIT,
) -> ModelArtifactSnapshot:
    """Read manifests and status markers into a model-level artifact snapshot."""

    manifest_infos = list_manifest_infos(store=store, paths=paths, model_id=model.id, limit=history_cycle_count)
    latest_manifest = read_latest_manifest_info(store=store, paths=paths, model_id=model.id)
    latest_published_cycle = latest_manifest.cycle if latest_manifest is not None else None

    publish_lag = estimate_publish_lag(manifest_infos=manifest_infos, policy=publish_lag_policy)
    expected_cycle = expected_synoptic_cycle(
        now=now,
        grace_hours=publish_lag.hours,
        count=status_cycle_count,
    )
    expected_deadline = cycle_datetime(expected_cycle) + timedelta(hours=publish_lag.hours)

    candidate_cycles = set(latest_synoptic_cycles(now=now, count=status_cycle_count))
    candidate_cycles.update(info.cycle for info in manifest_infos)
    if latest_published_cycle:
        candidate_cycles.add(latest_published_cycle)
    candidate_cycles.add(expected_cycle)

    manifest_cycles = {info.cycle for info in manifest_infos}
    if latest_published_cycle:
        manifest_cycles.add(latest_published_cycle)

    progress_by_cycle = {
        cycle: read_cycle_progress(
            store=store,
            paths=paths,
            model=model,
            cycle=cycle,
            manifest_present=cycle in manifest_cycles,
            missing_sample_limit=missing_sample_limit,
            marker_validation_sample_limit=marker_validation_sample_limit,
        )
        for cycle in sorted(candidate_cycles)
    }
    latest_observed_cycle = latest_cycle_with_artifacts(
        latest_published_cycle=latest_published_cycle,
        progress_by_cycle=progress_by_cycle,
    )
    selected_cycle = select_target_cycle(
        expected_cycle=expected_cycle,
        latest_observed_cycle=latest_observed_cycle,
        latest_published_cycle=latest_published_cycle,
    )

    return ModelArtifactSnapshot(
        expected_cycle=expected_cycle,
        expected_cycle_deadline=expected_deadline,
        latest_observed_cycle=latest_observed_cycle,
        latest_published_cycle=latest_published_cycle,
        latest_published_generated_at=latest_manifest.generated_at if latest_manifest is not None else None,
        progress=progress_by_cycle[selected_cycle],
        progress_by_cycle=progress_by_cycle,
        publish_lag=publish_lag,
    )


def estimate_publish_lag(*, manifest_infos: Iterable[ManifestInfo], policy: PublishLagPolicy) -> PublishLagEstimate:
    """Estimate normal publish lag from recent manifests."""

    lags = []
    for info in manifest_infos:
        if info.generated_at is None:
            continue
        try:
            lag = (info.generated_at - cycle_datetime(info.cycle)).total_seconds() / 3600
        except ValueError:
            continue
        if 0 <= lag <= MAX_REASONABLE_PUBLISH_LAG_HOURS:
            lags.append(lag)

    if not lags:
        return PublishLagEstimate(hours=policy.fallback_hours, source="fallback")

    p90 = _percentile(sorted(lags), 0.9)
    hours = _clamp(p90 + policy.cushion_hours, policy.min_hours, policy.max_hours)
    return PublishLagEstimate(hours=hours, source="recent-history")


def latest_cycle_with_artifacts(
    *,
    latest_published_cycle: str | None,
    progress_by_cycle: Mapping[str, CycleProgress],
) -> str | None:
    observed_cycles = [
        cycle
        for cycle, progress in progress_by_cycle.items()
        if progress.found_markers > 0 or progress.published or progress.manifest_present
    ]
    return max(observed_cycles) if observed_cycles else latest_published_cycle


def select_target_cycle(
    *,
    expected_cycle: str,
    latest_observed_cycle: str | None,
    latest_published_cycle: str | None,
) -> str:
    candidates = [expected_cycle]
    if latest_observed_cycle is not None and latest_observed_cycle >= expected_cycle:
        candidates.append(latest_observed_cycle)
    if latest_published_cycle is not None and latest_published_cycle >= expected_cycle:
        candidates.append(latest_published_cycle)
    return max(candidates)


def _percentile(sorted_values: list[float], q: float) -> float:
    if not sorted_values:
        raise ValueError("No values")
    if len(sorted_values) == 1:
        return sorted_values[0]
    position = (len(sorted_values) - 1) * q
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return sorted_values[lower]
    weight = position - lower
    return sorted_values[lower] * (1 - weight) + sorted_values[upper] * weight


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))
