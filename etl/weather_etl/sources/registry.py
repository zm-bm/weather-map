"""Dataset source acquisition dispatch."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

from ..config.pipeline import DatasetConfig
from ..config.sources import GFS_NOMADS_SOURCE_TYPE, ICON_DWD_SOURCE_TYPE
from ..processing.proc import RunFn
from ..storage.base import UriStore
from .gfs import source as gfs_source
from .gfs.layout import gfs_s3_grib_uri
from .icon import dwd as icon_dwd
from .prepared_grib import PreparedGribSource


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

    if dataset.source.type == GFS_NOMADS_SOURCE_TYPE:
        return gfs_source.acquire_prepared_source(
            dataset=dataset,
            cycle=cycle,
            frame_id=frame_id,
            source_uri_override=source_uri_override,
            artifact_ids=artifact_ids,
            workdir=workdir,
            store=store,
            run=run,
        )
    if dataset.source.type == ICON_DWD_SOURCE_TYPE:
        return icon_dwd.acquire_prepared_source(
            dataset=dataset,
            cycle=cycle,
            frame_id=frame_id,
            source_uri_override=source_uri_override,
            artifact_ids=artifact_ids,
            workdir=workdir,
            store=store,
            run=run,
        )
    raise SystemExit(f"Unsupported dataset source type for {dataset.id!r}: {dataset.source.type!r}")


def aws_batch_source_uri_overrides(
    *,
    dataset: DatasetConfig,
    cycle: str,
    frames: Iterable[str],
    source_bucket: str,
) -> dict[str, str]:
    """Return per-frame source URI overrides needed for AWS Batch workers."""

    if dataset.source.type == GFS_NOMADS_SOURCE_TYPE:
        return {
            str(frame_id): gfs_s3_grib_uri(source_bucket=source_bucket, cycle=cycle, frame_id=str(frame_id))
            for frame_id in frames
        }
    if dataset.source.type == ICON_DWD_SOURCE_TYPE:
        return {}
    raise SystemExit(f"Unsupported dataset source type for AWS Batch submit: {dataset.source.type!r}")
