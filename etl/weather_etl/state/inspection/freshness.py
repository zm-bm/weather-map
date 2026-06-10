"""Dataset freshness reads and lifecycle context for configured datasets."""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Literal, TypeAlias

from ...core.cycles import cycle_datetime, expected_synoptic_cycle, latest_synoptic_cycles, validate_cycle_id
from ...storage.base import UriStore
from ..artifacts.paths import ArtifactPaths
from ..artifacts.repository import ArtifactRepository
from ..artifacts.status import (
    DEFAULT_MARKER_VALIDATION_SAMPLE_LIMIT,
    DEFAULT_MISSING_SAMPLE_LIMIT,
    CycleProgress,
    read_cycle_progress,
)
from ..manifest.schema import CycleManifest
from .lifecycle import RunLifecycleStage, inspect_run_lifecycle

if TYPE_CHECKING:
    from ...config.pipeline import DatasetConfig

MAX_REASONABLE_PUBLISH_LAG_HOURS = 72

DatasetFreshnessStatus: TypeAlias = Literal["fresh", "building", "stalled", "incomplete", "unavailable", "stale"]
NON_ALERTING_DATASET_STATUSES = {"fresh", "building"}


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
class DatasetFreshnessInspection:
    status: DatasetFreshnessStatus
    reason: str
    expected_cycle: str | None
    expected_cycle_deadline: datetime | None
    latest_observed_cycle: str | None
    latest_published_cycle: str | None
    latest_published_generated_at: datetime | None
    progress: CycleProgress | None
    publish_lag: PublishLagEstimate
    lifecycle_stage: RunLifecycleStage | None = None
    lifecycle_cycle: str | None = None
    lifecycle_run_id: str | None = None


@dataclass(frozen=True)
class _DatasetArtifactSnapshot:
    expected_cycle: str
    expected_cycle_deadline: datetime
    latest_observed_cycle: str | None
    latest_published_cycle: str | None
    latest_published_generated_at: datetime | None
    progress: CycleProgress
    progress_by_cycle: Mapping[str, CycleProgress]
    publish_lag: PublishLagEstimate

    @property
    def latest_published_satisfies_expected(self) -> bool:
        return self.latest_published_cycle is not None and self.latest_published_cycle >= self.expected_cycle

    @property
    def latest_published_progress(self) -> CycleProgress | None:
        if self.latest_published_cycle is None:
            return None
        return self.progress_by_cycle.get(self.latest_published_cycle)


@dataclass(frozen=True)
class _LatestManifestFreshness:
    latest_manifest: CycleManifest
    expected_cycle: str
    expected_cycle_deadline: datetime
    publish_lag: PublishLagEstimate

    @property
    def fresh(self) -> bool:
        return self.latest_manifest.cycle >= self.expected_cycle


def inspect_dataset_freshness(
    *,
    store: UriStore,
    paths: ArtifactPaths,
    dataset: DatasetConfig,
    now: datetime,
    history_cycle_count: int,
    status_cycle_count: int,
    publish_lag_policy: PublishLagPolicy,
    recent_progress_hours: float,
    missing_sample_limit: int = DEFAULT_MISSING_SAMPLE_LIMIT,
    marker_validation_sample_limit: int = DEFAULT_MARKER_VALIDATION_SAMPLE_LIMIT,
) -> DatasetFreshnessInspection:
    """Inspect artifact freshness for one dataset with optional run lifecycle context."""

    artifact_repo = ArtifactRepository(store=store, paths=paths)
    latest = _read_latest_manifest_freshness(
        artifact_repo=artifact_repo,
        dataset_id=dataset.id,
        now=now,
        status_cycle_count=status_cycle_count,
        publish_lag_policy=publish_lag_policy,
    )
    if latest is not None and latest.fresh:
        return _with_lifecycle_context(
            DatasetFreshnessInspection(
                status="fresh",
                reason="Latest expected cycle is published.",
                expected_cycle=latest.expected_cycle,
                expected_cycle_deadline=latest.expected_cycle_deadline,
                latest_observed_cycle=latest.latest_manifest.cycle,
                latest_published_cycle=latest.latest_manifest.cycle,
                latest_published_generated_at=latest.latest_manifest.generated_at_utc,
                progress=None,
                publish_lag=latest.publish_lag,
            ),
            artifact_repo=artifact_repo,
            store=store,
            dataset_id=dataset.id,
            cycle=latest.latest_manifest.cycle,
            run_id=latest.latest_manifest.run_id,
        )

    snapshot = _read_dataset_artifact_snapshot(
        store=store,
        paths=paths,
        dataset=dataset,
        now=now,
        history_cycle_count=history_cycle_count,
        status_cycle_count=status_cycle_count,
        publish_lag_policy=publish_lag_policy,
        missing_sample_limit=missing_sample_limit,
        marker_validation_sample_limit=marker_validation_sample_limit,
    )
    status, reason = _classify_snapshot(
        snapshot=snapshot,
        now=now,
        recent_progress_hours=recent_progress_hours,
    )
    return _with_lifecycle_context(
        _freshness_from_snapshot(snapshot=snapshot, status=status, reason=reason),
        artifact_repo=artifact_repo,
        store=store,
        dataset_id=dataset.id,
        cycle=snapshot.progress.cycle,
        run_id=snapshot.progress.run_id,
    )


def estimate_publish_lag(*, manifests: Iterable[CycleManifest], policy: PublishLagPolicy) -> PublishLagEstimate:
    """Estimate normal publish lag from recent manifests."""

    lags = []
    for manifest in manifests:
        try:
            lag = (manifest.generated_at_utc - cycle_datetime(manifest.cycle)).total_seconds() / 3600
        except ValueError:
            continue
        if 0 <= lag <= MAX_REASONABLE_PUBLISH_LAG_HOURS:
            lags.append(lag)

    if not lags:
        return PublishLagEstimate(hours=policy.fallback_hours, source="fallback")

    p90 = _percentile(sorted(lags), 0.9)
    hours = max(policy.min_hours, min(policy.max_hours, p90 + policy.cushion_hours))
    return PublishLagEstimate(hours=hours, source="recent-history")


def _read_latest_manifest_freshness(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    now: datetime,
    status_cycle_count: int,
    publish_lag_policy: PublishLagPolicy,
) -> _LatestManifestFreshness | None:
    latest_manifest = _read_latest_manifest(artifact_repo=artifact_repo, dataset_id=dataset_id)
    if latest_manifest is None:
        return None

    publish_lag = _latest_manifest_publish_lag(latest_manifest, policy=publish_lag_policy)
    expected_cycle = expected_synoptic_cycle(
        now=now,
        grace_hours=publish_lag.hours,
        count=status_cycle_count,
    )
    return _LatestManifestFreshness(
        latest_manifest=latest_manifest,
        expected_cycle=expected_cycle,
        expected_cycle_deadline=cycle_datetime(expected_cycle) + timedelta(hours=publish_lag.hours),
        publish_lag=publish_lag,
    )


def _latest_manifest_publish_lag(
    latest_manifest: CycleManifest,
    *,
    policy: PublishLagPolicy,
) -> PublishLagEstimate:
    estimate = estimate_publish_lag(manifests=(latest_manifest,), policy=policy)
    if estimate.source == "recent-history":
        return PublishLagEstimate(hours=estimate.hours, source="latest-manifest")
    return estimate


def _read_dataset_artifact_snapshot(
    *,
    store: UriStore,
    paths: ArtifactPaths,
    dataset: DatasetConfig,
    now: datetime,
    history_cycle_count: int,
    status_cycle_count: int,
    publish_lag_policy: PublishLagPolicy,
    missing_sample_limit: int = DEFAULT_MISSING_SAMPLE_LIMIT,
    marker_validation_sample_limit: int = DEFAULT_MARKER_VALIDATION_SAMPLE_LIMIT,
) -> _DatasetArtifactSnapshot:
    """Read manifests and status markers into a dataset-level artifact snapshot."""

    artifact_repo = ArtifactRepository(store=store, paths=paths)
    manifests = _list_recent_current_manifests(
        artifact_repo=artifact_repo,
        dataset_id=dataset.id,
        limit=history_cycle_count,
    )
    latest_manifest = _read_latest_manifest(artifact_repo=artifact_repo, dataset_id=dataset.id)
    latest_published_cycle = latest_manifest.cycle if latest_manifest is not None else None

    publish_lag = estimate_publish_lag(manifests=manifests, policy=publish_lag_policy)
    expected_cycle = expected_synoptic_cycle(
        now=now,
        grace_hours=publish_lag.hours,
        count=status_cycle_count,
    )
    expected_deadline = cycle_datetime(expected_cycle) + timedelta(hours=publish_lag.hours)

    candidate_cycles = _status_candidate_cycles(
        now=now,
        expected_cycle=expected_cycle,
        latest_published_cycle=latest_published_cycle,
        status_cycle_count=status_cycle_count,
    )

    manifest_cycles = {manifest.cycle for manifest in manifests}
    if latest_published_cycle:
        manifest_cycles.add(latest_published_cycle)

    progress_by_cycle = {
        cycle: read_cycle_progress(
            store=store,
            paths=paths,
            dataset_id=dataset.id,
            cycle=cycle,
            artifact_ids=dataset.workload.artifacts,
            frames=dataset.workload.frames,
            manifest_present=cycle in manifest_cycles,
            missing_sample_limit=missing_sample_limit,
            marker_validation_sample_limit=marker_validation_sample_limit,
        )
        for cycle in sorted(candidate_cycles)
    }
    latest_observed_cycle = _latest_cycle_with_artifacts(
        latest_published_cycle=latest_published_cycle,
        progress_by_cycle=progress_by_cycle,
    )
    selected_cycle = _select_target_cycle(
        expected_cycle=expected_cycle,
        latest_observed_cycle=latest_observed_cycle,
        latest_published_cycle=latest_published_cycle,
    )

    return _DatasetArtifactSnapshot(
        expected_cycle=expected_cycle,
        expected_cycle_deadline=expected_deadline,
        latest_observed_cycle=latest_observed_cycle,
        latest_published_cycle=latest_published_cycle,
        latest_published_generated_at=latest_manifest.generated_at_utc if latest_manifest is not None else None,
        progress=progress_by_cycle[selected_cycle],
        progress_by_cycle=progress_by_cycle,
        publish_lag=publish_lag,
    )


def _read_latest_manifest(*, artifact_repo: ArtifactRepository, dataset_id: str) -> CycleManifest | None:
    try:
        return artifact_repo.read_latest_manifest(dataset_id=dataset_id)
    except (Exception, SystemExit):
        return None


def _list_recent_current_manifests(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    limit: int,
) -> list[CycleManifest]:
    current_manifest_cycles = [
        cycle
        for obj in artifact_repo.list_manifest_objects(dataset_id=dataset_id)
        for cycle in [_cycle_from_current_manifest_uri(artifact_repo=artifact_repo, dataset_id=dataset_id, uri=obj.uri)]
        if cycle is not None
    ]
    current_manifest_cycles.sort(reverse=True)

    manifests: list[CycleManifest] = []
    for cycle in current_manifest_cycles[:limit]:
        try:
            manifests.append(artifact_repo.read_cycle_current_manifest(dataset_id=dataset_id, cycle=cycle))
        except (Exception, SystemExit):
            continue
    return manifests


def _cycle_from_current_manifest_uri(*, artifact_repo: ArtifactRepository, dataset_id: str, uri: str) -> str | None:
    prefix = f"manifests/{dataset_id}/"
    key = artifact_repo.paths.relative_key(uri)
    if not key.startswith(prefix) or not key.endswith(".json"):
        return None
    parts = key[len(prefix) :].split("/")
    if len(parts) != 3 or parts[0] != "cycles" or parts[2] != "current.json":
        return None
    try:
        return validate_cycle_id(parts[1])
    except ValueError:
        return None


def _latest_cycle_with_artifacts(
    *,
    latest_published_cycle: str | None,
    progress_by_cycle: Mapping[str, CycleProgress],
) -> str | None:
    observed_cycles = [
        cycle
        for cycle, progress in progress_by_cycle.items()
        if progress.has_evidence
    ]
    return max(observed_cycles) if observed_cycles else latest_published_cycle


def _status_candidate_cycles(
    *,
    now: datetime,
    expected_cycle: str,
    latest_published_cycle: str | None,
    status_cycle_count: int,
) -> set[str]:
    """Return cycles whose status markers are worth listing for health snapshots."""

    cycles = {expected_cycle}
    cycles.update(
        cycle for cycle in latest_synoptic_cycles(now=now, count=status_cycle_count) if cycle >= expected_cycle
    )
    if latest_published_cycle is not None and latest_published_cycle >= expected_cycle:
        cycles.add(latest_published_cycle)
    return cycles


def _select_target_cycle(
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


def _freshness_from_snapshot(
    *,
    snapshot: _DatasetArtifactSnapshot,
    status: DatasetFreshnessStatus,
    reason: str,
) -> DatasetFreshnessInspection:
    return DatasetFreshnessInspection(
        status=status,
        reason=reason,
        expected_cycle=snapshot.expected_cycle,
        expected_cycle_deadline=snapshot.expected_cycle_deadline,
        latest_observed_cycle=snapshot.latest_observed_cycle,
        latest_published_cycle=snapshot.latest_published_cycle,
        latest_published_generated_at=snapshot.latest_published_generated_at,
        progress=snapshot.progress,
        publish_lag=snapshot.publish_lag,
    )


def _with_lifecycle_context(
    freshness: DatasetFreshnessInspection,
    *,
    artifact_repo: ArtifactRepository,
    store: UriStore,
    dataset_id: str,
    cycle: str | None,
    run_id: str | None,
) -> DatasetFreshnessInspection:
    if cycle is None or run_id is None:
        return freshness
    if not artifact_repo.store.exists(uri=artifact_repo.paths.run_metadata_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)):
        return _freshness_with_lifecycle(
            freshness,
            stage="missing_snapshot",
            cycle=cycle,
            run_id=run_id,
        )
    try:
        lifecycle = inspect_run_lifecycle(
            artifact_repo=artifact_repo,
            store=store,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
        )
    except (Exception, SystemExit):
        return freshness
    return _freshness_with_lifecycle(
        freshness,
        stage=lifecycle.stage,
        cycle=cycle,
        run_id=run_id,
    )


def _freshness_with_lifecycle(
    freshness: DatasetFreshnessInspection,
    *,
    stage: RunLifecycleStage,
    cycle: str,
    run_id: str,
) -> DatasetFreshnessInspection:
    return replace(
        freshness,
        lifecycle_stage=stage,
        lifecycle_cycle=cycle,
        lifecycle_run_id=run_id,
    )


def _classify_snapshot(
    *,
    snapshot: _DatasetArtifactSnapshot,
    now: datetime,
    recent_progress_hours: float,
) -> tuple[DatasetFreshnessStatus, str]:
    progress = snapshot.progress
    if progress.invalid_marker_sample:
        return "incomplete", "One or more success markers could not be parsed."

    if snapshot.latest_published_satisfies_expected:
        published_progress = snapshot.latest_published_progress
        if published_progress is not None and published_progress.complete:
            return "fresh", "Latest expected cycle is published and marker-complete."
        return "incomplete", "Latest published cycle is missing expected success markers."

    if progress.complete and not progress.publication_artifacts_present:
        return "incomplete", "Success markers are complete, but publish marker or manifest is missing."

    if progress.has_marker_progress:
        if progress.has_recent_progress(now=now, recent_progress_hours=recent_progress_hours):
            return "building", "Expected cycle is still building with recent marker progress."
        return "stalled", "Expected cycle has partial artifacts but no recent marker progress."

    if snapshot.latest_published_cycle is None:
        return "unavailable", "No latest manifest or status artifacts were found."

    return "stale", "No complete published cycle is available for the expected cycle."


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
