"""Process one configured artifact into encoded payload bytes."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..config.pipeline import ArtifactSpec
from ..sources.prepared_grib import PreparedGribSource
from .artifact_bands import extract_artifact_bands
from .encoding import encode_artifact_payload
from .grid_transforms import apply_artifact_grid_transform
from .proc import RunFn


@dataclass(frozen=True)
class ProcessedArtifact:
    dtype: str
    payload: bytes
    grid_id: str
    grid: dict[str, Any]


def process_artifact(
    *,
    artifact: ArtifactSpec,
    source: PreparedGribSource,
    grid: dict[str, Any],
    frame_id: str,
    workdir: Path,
    run: RunFn,
) -> ProcessedArtifact:
    """Extract, transform, and encode one artifact without storage side effects."""

    bands = extract_artifact_bands(
        artifact=artifact,
        grid=grid,
        source=source,
        workdir=workdir,
        run=run,
        frame_id=frame_id,
    )
    transformed = apply_artifact_grid_transform(
        artifact=artifact,
        grid_id=source.grid_id,
        grid=grid,
        bands=bands,
    )
    payload = encode_artifact_payload(artifact=artifact, grid=transformed.grid, bands=transformed.bands)
    return ProcessedArtifact(
        dtype=artifact.encoding.dtype,
        payload=payload,
        grid_id=transformed.grid_id,
        grid=transformed.grid,
    )
