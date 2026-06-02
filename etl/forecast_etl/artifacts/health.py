"""Artifact health decisions for configured datasets."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal, TypeAlias

from ..config.resolved import DatasetConfig
from ..cycles import cycle_datetime, expected_synoptic_cycle
from ..manifest.inspect import ManifestInfo, read_latest_manifest_info
from ..storage.base import UriStore
from .paths import ArtifactPaths
from .snapshot import (
    DatasetArtifactSnapshot,
    PublishLagEstimate,
    PublishLagPolicy,
    estimate_publish_lag,
    read_dataset_artifact_snapshot,
)
from .status import (
    DEFAULT_MARKER_VALIDATION_SAMPLE_LIMIT,
    DEFAULT_MISSING_SAMPLE_LIMIT,
    CycleProgress,
)

ArtifactHealthStatus: TypeAlias = Literal["fresh", "building", "stalled", "incomplete", "unavailable", "stale"]


@dataclass(frozen=True)
class LatestManifestFreshness:
    latest_manifest: ManifestInfo
    expected_cycle: str
    expected_cycle_deadline: datetime
    publish_lag: PublishLagEstimate

    @property
    def fresh(self) -> bool:
        return self.latest_manifest.cycle >= self.expected_cycle


@dataclass(frozen=True)
class DatasetArtifactHealth:
    status: ArtifactHealthStatus
    reason: str
    expected_cycle: str | None
    expected_cycle_deadline: datetime | None
    latest_observed_cycle: str | None
    latest_published_cycle: str | None
    latest_published_generated_at: datetime | None
    progress: CycleProgress | None
    publish_lag: PublishLagEstimate


def read_dataset_artifact_health(
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
) -> DatasetArtifactHealth:
    """Read artifact health for one dataset, using latest manifest as a fast path."""

    latest = _read_latest_manifest_freshness(
        store=store,
        paths=paths,
        dataset_id=dataset.id,
        now=now,
        status_cycle_count=status_cycle_count,
        publish_lag_policy=publish_lag_policy,
    )
    if latest is not None and latest.fresh:
        return DatasetArtifactHealth(
            status="fresh",
            reason="Latest expected cycle is published.",
            expected_cycle=latest.expected_cycle,
            expected_cycle_deadline=latest.expected_cycle_deadline,
            latest_observed_cycle=latest.latest_manifest.cycle,
            latest_published_cycle=latest.latest_manifest.cycle,
            latest_published_generated_at=latest.latest_manifest.generated_at,
            progress=None,
            publish_lag=latest.publish_lag,
        )

    snapshot = read_dataset_artifact_snapshot(
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
    return _health_from_snapshot(snapshot=snapshot, status=status, reason=reason)


def _read_latest_manifest_freshness(
    *,
    store: UriStore,
    paths: ArtifactPaths,
    dataset_id: str,
    now: datetime,
    status_cycle_count: int,
    publish_lag_policy: PublishLagPolicy,
) -> LatestManifestFreshness | None:
    latest_manifest = read_latest_manifest_info(store=store, paths=paths, dataset_id=dataset_id)
    if latest_manifest is None:
        return None

    publish_lag = _latest_manifest_publish_lag(latest_manifest, policy=publish_lag_policy)
    expected_cycle = expected_synoptic_cycle(
        now=now,
        grace_hours=publish_lag.hours,
        count=status_cycle_count,
    )
    return LatestManifestFreshness(
        latest_manifest=latest_manifest,
        expected_cycle=expected_cycle,
        expected_cycle_deadline=cycle_datetime(expected_cycle) + timedelta(hours=publish_lag.hours),
        publish_lag=publish_lag,
    )


def _latest_manifest_publish_lag(
    latest_manifest: ManifestInfo,
    *,
    policy: PublishLagPolicy,
) -> PublishLagEstimate:
    estimate = estimate_publish_lag(manifest_infos=(latest_manifest,), policy=policy)
    if estimate.source == "recent-history":
        return PublishLagEstimate(hours=estimate.hours, source="latest-manifest")
    return estimate


def _health_from_snapshot(
    *,
    snapshot: DatasetArtifactSnapshot,
    status: ArtifactHealthStatus,
    reason: str,
) -> DatasetArtifactHealth:
    return DatasetArtifactHealth(
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


def _classify_snapshot(
    *,
    snapshot: DatasetArtifactSnapshot,
    now: datetime,
    recent_progress_hours: float,
) -> tuple[ArtifactHealthStatus, str]:
    progress = snapshot.progress
    if progress.invalid_marker_sample:
        return "incomplete", "One or more success markers could not be parsed."

    if snapshot.latest_published_cycle is not None and snapshot.latest_published_cycle >= snapshot.expected_cycle:
        published_progress = snapshot.progress_by_cycle.get(snapshot.latest_published_cycle)
        if published_progress is not None and published_progress.complete:
            return "fresh", "Latest expected cycle is published and marker-complete."
        return "incomplete", "Latest published cycle is missing expected success markers."

    if progress.complete and not (progress.published and progress.manifest_present):
        return "incomplete", "Success markers are complete, but publish marker or manifest is missing."

    if progress.found_markers > 0:
        if _has_recent_progress(progress, now=now, recent_progress_hours=recent_progress_hours):
            return "building", "Expected cycle is still building with recent marker progress."
        return "stalled", "Expected cycle has partial artifacts but no recent marker progress."

    if snapshot.latest_published_cycle is None:
        return "unavailable", "No latest manifest or status artifacts were found."

    return "stale", "No complete published cycle is available for the expected cycle."


def _has_recent_progress(progress: CycleProgress, *, now: datetime, recent_progress_hours: float) -> bool:
    if progress.last_progress_at is None:
        return False
    return now - progress.last_progress_at <= timedelta(hours=recent_progress_hours)
