"""Placeholder ICON source acquisition adapter."""

from __future__ import annotations

from pathlib import Path

from ..config.schema import SOURCE_TYPE_ZERO_PLACEHOLDER, ModelConfig
from ..sources.prepared import PreparedSource
from ..stores.base import UriStore


def acquire_prepared_source(
    *,
    model: ModelConfig,
    cycle: str,
    fhour: str,
    source_uri_override: str | None,
    workdir: Path,
    store: UriStore,
) -> PreparedSource:
    del cycle, fhour, workdir, store
    if model.source.type != SOURCE_TYPE_ZERO_PLACEHOLDER or model.source.grid is None:
        raise SystemExit(f"Model {model.id!r} is not configured for zero placeholder acquisition")
    if source_uri_override is not None and source_uri_override.strip():
        raise SystemExit(f"Model {model.id!r} uses zero placeholder acquisition and does not accept --source-uri")
    return PreparedSource.zero(uri=f"zero://{model.id}", grid=model.source.grid, grid_id=model.source.grid_id)
