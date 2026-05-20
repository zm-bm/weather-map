"""Dispatch artifact output-band extraction from prepared GRIB sources."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config.resolved import ArtifactSpec, ComponentSpec
from ..proc import RunFn
from ..source_adapters.base import PreparedSource
from .derived_artifact_bands import extract_derived_artifact_bands
from .source_bands import extract_source_band
from .types import ExtractedBand


def extract_artifact_bands(
    *,
    artifact: ArtifactSpec,
    grid: dict[str, Any],
    source: PreparedSource,
    workdir: Path,
    run: RunFn,
    fhour: str | None = None,
) -> list[ExtractedBand]:
    """Extract all output bands for one artifact."""

    if artifact.derivation is not None:
        return extract_derived_artifact_bands(
            artifact=artifact,
            grid=grid,
            source=source,
            workdir=workdir,
            run=run,
            fhour=fhour,
        )

    return [
        extract_source_band(
            artifact=artifact,
            band_id=component.id,
            grib_match=_direct_component_grib_match(artifact=artifact, component=component),
            grid=grid,
            source=source,
            workdir_path=workdir / f"{artifact.id}.{component.id}.f32.bin",
            run=run,
        )
        for component in artifact.components
    ]


def _direct_component_grib_match(*, artifact: ArtifactSpec, component: ComponentSpec) -> dict[str, str]:
    if component.grib_match is None:
        raise SystemExit(f"Artifact {artifact.id}.{component.id} requires grib_match for direct extraction")
    return dict(component.grib_match)
