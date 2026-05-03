"""Model adapter dispatch."""

from __future__ import annotations

from pathlib import Path

from ..config.schema import (
    SOURCE_TYPE_GFS_NOMADS,
    SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL,
    ModelConfig,
)
from ..sources.prepared import PreparedSource
from ..stores.base import UriStore
from . import gfs, icon


def acquire_prepared_source(
    *,
    model: ModelConfig,
    cycle: str,
    fhour: str,
    source_uri_override: str | None,
    workdir: Path,
    store: UriStore,
) -> PreparedSource:
    if model.source.type == SOURCE_TYPE_GFS_NOMADS:
        return gfs.acquire_prepared_source(
            model=model,
            cycle=cycle,
            fhour=fhour,
            source_uri_override=source_uri_override,
            workdir=workdir,
            store=store,
        )
    if model.source.type == SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL:
        return icon.acquire_prepared_source(
            model=model,
            cycle=cycle,
            fhour=fhour,
            source_uri_override=source_uri_override,
            workdir=workdir,
            store=store,
        )
    raise SystemExit(f"Unsupported model source type for {model.id!r}: {model.source.type!r}")
