"""Forecast source adapter dispatch."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

from ..config.resolved import (
    DatasetConfig,
    GfsNomadsSourceConfig,
    IconDwdSourceConfig,
)
from ..proc import RunFn
from ..storage.base import UriStore
from . import gfs_nomads, icon_dwd
from .base import PreparedSource


def acquire_prepared_source(
    *,
    model: DatasetConfig,
    cycle: str,
    frame_id: str,
    source_uri_override: str | None,
    artifact_ids: Iterable[str],
    workdir: Path,
    store: UriStore,
    run: RunFn | None = None,
) -> PreparedSource:
    """Dispatch source acquisition to the adapter configured for the model."""

    if isinstance(model.source, GfsNomadsSourceConfig):
        return gfs_nomads.acquire_prepared_source(
            model=model,
            cycle=cycle,
            frame_id=frame_id,
            source_uri_override=source_uri_override,
            artifact_ids=artifact_ids,
            workdir=workdir,
            store=store,
            run=run,
        )
    if isinstance(model.source, IconDwdSourceConfig):
        return icon_dwd.acquire_prepared_source(
            model=model,
            cycle=cycle,
            frame_id=frame_id,
            source_uri_override=source_uri_override,
            artifact_ids=artifact_ids,
            workdir=workdir,
            store=store,
            run=run,
        )
    raise SystemExit(f"Unsupported dataset source type for {model.id!r}: {model.source.type!r}")
