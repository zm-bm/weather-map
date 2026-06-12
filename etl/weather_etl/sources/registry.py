"""Dataset source acquisition dispatch."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable, TypeAlias

from ..config.pipeline import DatasetConfig
from ..config.sources import GFS_NOMADS_SOURCE_TYPE, ICON_DWD_SOURCE_TYPE, MRMS_AWS_S3_SOURCE_TYPE
from ..processing.proc import RunFn
from ..storage.base import UriStore
from .gfs import source as gfs_source
from .gfs.layout import gfs_s3_grib_uri
from .icon import dwd as icon_dwd
from .mrms import source as mrms_source
from .prepared_grib import PreparedGribSource

SourceAcquireFn: TypeAlias = Callable[..., PreparedGribSource]
SourceFrameResolverFn: TypeAlias = Callable[..., tuple[str, ...]]
SourceFrameValidTimesFn: TypeAlias = Callable[[Iterable[str]], dict[str, str]]
SourceFrameDatetimeFn: TypeAlias = Callable[[str], datetime]
AwsSourceUriOverridesFn: TypeAlias = Callable[..., dict[str, str]]


@dataclass(frozen=True)
class SourceAdapter:
    acquire: SourceAcquireFn
    resolve_frame_ids: SourceFrameResolverFn | None = None
    frame_valid_times: SourceFrameValidTimesFn | None = None
    frame_datetime: SourceFrameDatetimeFn | None = None
    aws_source_uri_overrides: AwsSourceUriOverridesFn | None = None


def acquire_prepared_source(
    *,
    dataset: DatasetConfig,
    cycle: str,
    frame_id: str,
    source_uri_override: str | None,
    artifact_ids: Iterable[str],
    workdir: Path,
    store: UriStore,
    run: RunFn | None = None,
) -> PreparedGribSource:
    """Dispatch source acquisition to the adapter configured for the dataset."""

    return _adapter_for(dataset).acquire(
        dataset=dataset,
        cycle=cycle,
        frame_id=frame_id,
        source_uri_override=source_uri_override,
        artifact_ids=artifact_ids,
        workdir=workdir,
        store=store,
        run=run,
    )


def aws_batch_source_uri_overrides(
    *,
    dataset: DatasetConfig,
    cycle: str,
    frames: Iterable[str],
    source_bucket: str,
) -> dict[str, str]:
    """Return per-frame source URI overrides needed for AWS Batch workers."""

    hook = _adapter_for_source_type(
        source_type=dataset.source.type,
        error=f"Unsupported dataset source type for AWS Batch submit: {dataset.source.type!r}",
    ).aws_source_uri_overrides
    if hook is None:
        return {}
    return hook(cycle=cycle, frames=frames, source_bucket=source_bucket)


def resolve_source_frame_ids(
    *,
    dataset: DatasetConfig,
    selected_frames: Iterable[str] | None,
    store: UriStore | None = None,
) -> tuple[str, ...]:
    """Return selected workload frame ids with source-specific planning applied."""

    hook = _adapter_for(dataset).resolve_frame_ids
    if hook is None:
        return _default_resolve_frame_ids(dataset=dataset, selected_frames=selected_frames, store=store)
    return hook(dataset=dataset, selected_frames=selected_frames, store=store)


def _mrms_lookback_minutes(dataset: DatasetConfig) -> int:
    if dataset.mode != "rolling_observed":
        raise SystemExit(f"Dataset {dataset.id!r} does not define a rolling observed lookback window")
    lifecycle = dataset.lifecycle
    if lifecycle is None:
        raise SystemExit(f"Dataset {dataset.id!r} is missing rolling observed lifecycle settings")
    return lifecycle.display_window_minutes


def source_frame_valid_times(dataset: DatasetConfig, frames: Iterable[str]) -> dict[str, str] | None:
    """Return manifest valid_at overrides for source-owned frame ids."""

    hook = _adapter_for(dataset).frame_valid_times
    return hook(frames) if hook is not None else None


def source_frame_datetime(*, dataset: DatasetConfig, frame_id: str) -> datetime:
    """Return the UTC valid datetime for source-owned timestamp frame ids."""

    hook = _adapter_for(dataset).frame_datetime
    if hook is not None:
        return hook(frame_id)
    raise SystemExit(f"Dataset source {dataset.source.type!r} does not expose observed timestamp frame ids")


def _adapter_for(dataset: DatasetConfig) -> SourceAdapter:
    return _adapter_for_source_type(
        source_type=dataset.source.type,
        error=f"Unsupported dataset source type for {dataset.id!r}: {dataset.source.type!r}",
    )


def _adapter_for_source_type(*, source_type: str, error: str) -> SourceAdapter:
    try:
        return _SOURCE_ADAPTERS[source_type]
    except KeyError:
        raise SystemExit(error) from None


def _default_resolve_frame_ids(
    *,
    dataset: DatasetConfig,
    selected_frames: Iterable[str] | None,
    store: UriStore | None,
) -> tuple[str, ...]:
    del store
    from ..operations.workload_selection import WorkloadSelectionError, selected_workload_frame_ids

    try:
        return selected_workload_frame_ids(configured=dataset.workload.frames, selected=selected_frames)
    except WorkloadSelectionError as exc:
        raise SystemExit(str(exc)) from None


def _mrms_resolve_frame_ids(
    *,
    dataset: DatasetConfig,
    selected_frames: Iterable[str] | None,
    store: UriStore | None,
) -> tuple[str, ...]:
    if selected_frames is not None:
        return mrms_source.validate_mrms_frame_ids(selected_frames)
    return mrms_source.discover_recent_frame_ids(
        dataset=dataset,
        lookback_minutes=_mrms_lookback_minutes(dataset),
        store=store,
    )


def _gfs_aws_source_uri_overrides(
    *,
    cycle: str,
    frames: Iterable[str],
    source_bucket: str,
) -> dict[str, str]:
    return {
        str(frame_id): gfs_s3_grib_uri(source_bucket=source_bucket, cycle=cycle, frame_id=str(frame_id))
        for frame_id in frames
    }


_SOURCE_ADAPTERS: dict[str, SourceAdapter] = {
    GFS_NOMADS_SOURCE_TYPE: SourceAdapter(
        acquire=gfs_source.acquire_prepared_source,
        aws_source_uri_overrides=_gfs_aws_source_uri_overrides,
    ),
    ICON_DWD_SOURCE_TYPE: SourceAdapter(
        acquire=icon_dwd.acquire_prepared_source,
    ),
    MRMS_AWS_S3_SOURCE_TYPE: SourceAdapter(
        acquire=mrms_source.acquire_prepared_source,
        resolve_frame_ids=_mrms_resolve_frame_ids,
        frame_valid_times=mrms_source.frame_valid_times,
        frame_datetime=mrms_source.datetime_from_frame_id,
    ),
}
