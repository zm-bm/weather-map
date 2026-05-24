"""GFS source acquisition adapter."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Iterable

from ..config.resolved import GfsNomadsSourceConfig, ModelConfig
from ..cycles import parse_cycle
from ..proc import RunFn
from ..storage.base import UriStore
from ..uris import default_etl_dir, file_uri
from . import nomads
from .base import PreparedSource
from .gfs_layout import grib_cache_path


def acquire_prepared_source(
    *,
    model: ModelConfig,
    cycle: str,
    fhour: str,
    source_uri_override: str | None,
    artifact_ids: Iterable[str],
    workdir: Path,
    store: UriStore,
    run: RunFn | None = None,
) -> PreparedSource:
    """Acquire a single local GRIB source for one GFS cycle/hour."""

    del artifact_ids, run
    if not isinstance(model.source, GfsNomadsSourceConfig):
        raise SystemExit(f"Model {model.id!r} is not configured for GFS NOMADS acquisition")
    source = model.source

    if source_uri_override is not None and source_uri_override.strip():
        grib_path = workdir / "input.grib2"
        store.get_to_file(uri=source_uri_override.strip(), dst=grib_path)
        return PreparedSource.grib(uri=source_uri_override.strip(), path=grib_path, grid_id=source.grid_id)

    _, cycle_hour = parse_cycle(cycle)
    grib_path = grib_cache_path(
        etl_dir=default_etl_dir(),
        model_id=model.id,
        cycle=cycle,
        cycle_hour=cycle_hour,
        fhour=fhour,
    )
    if not grib_path.exists():
        url = nomads.nomads_url(
            base_url=source.nomads.base_url,
            vars_levels=source.nomads.vars_levels,
            cycle=cycle,
            fhour=fhour,
        )
        downloaded = nomads.download_if_needed(url, grib_path)
        if downloaded and source.nomads.rate_limit_seconds > 0:
            time.sleep(source.nomads.rate_limit_seconds)

    if not grib_path.exists():
        raise SystemExit(f"Missing GRIB after download attempt: {grib_path}")

    return PreparedSource.grib(uri=file_uri(grib_path), path=grib_path, grid_id=source.grid_id)
