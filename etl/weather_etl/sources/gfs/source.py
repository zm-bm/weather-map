"""GFS source acquisition adapter."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Iterable

from ...config.pipeline import DatasetConfig
from ...config.sources import GFS_NOMADS_SOURCE_TYPE
from ...core.cycles import parse_cycle
from ...processing.proc import RunFn
from ...storage.base import UriStore
from ...storage.uris import INPUT_RESOURCE_SCHEMES, default_etl_dir, file_uri, normalize_resource_uri
from ..prepared_grib import PreparedGribSource
from . import nomads
from .config import parse_gfs_nomads_source
from .layout import grib_cache_path


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
    """Acquire a single local GRIB source for one GFS cycle/frame."""

    del artifact_ids, run
    if dataset.source.type != GFS_NOMADS_SOURCE_TYPE:
        raise SystemExit(f"Dataset {dataset.id!r} is not configured for GFS NOMADS acquisition")
    source = parse_gfs_nomads_source(dataset.source)

    if source_uri_override is not None and source_uri_override.strip():
        source_uri = normalize_resource_uri(source_uri_override, allowed_schemes=INPUT_RESOURCE_SCHEMES)
        grib_path = workdir / "input.grib2"
        store.get_to_file(uri=source_uri, dst=grib_path)
        return PreparedGribSource.grib(uri=source_uri, path=grib_path, grid_id=source.grid_id)

    _, cycle_hour = parse_cycle(cycle)
    grib_path = grib_cache_path(
        etl_dir=default_etl_dir(),
        dataset_id=dataset.id,
        cycle=cycle,
        cycle_hour=cycle_hour,
        frame_id=frame_id,
    )
    if not grib_path.exists():
        url = nomads.nomads_url(
            base_url=source.base_url,
            vars_levels=source.vars_levels,
            cycle=cycle,
            frame_id=frame_id,
        )
        downloaded = nomads.download_if_needed(url, grib_path)
        if downloaded and source.rate_limit_seconds > 0:
            time.sleep(source.rate_limit_seconds)

    if not grib_path.exists():
        raise SystemExit(f"Missing GRIB after download attempt: {grib_path}")

    return PreparedGribSource.grib(uri=file_uri(grib_path), path=grib_path, grid_id=source.grid_id)
