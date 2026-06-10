"""Dispatch derived artifact extraction by derivation type."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from weather_etl.config.derivations import (
    DERIVATION_GFS_RUN_TOTAL_PRECIP,
    DERIVATION_ICON_TOT_PREC_DELTA_RATE,
    DERIVATION_PRECIP_TYPE_OVERLAY_FROM_GFS,
    DERIVATION_PRECIP_TYPE_OVERLAY_FROM_ICON_COMPONENTS,
    DERIVATION_THUNDERSTORM_MASK_FROM_ICON_WW,
)
from weather_etl.processing.bands import ExtractedBand

from ...config.pipeline import ArtifactSpec
from ...sources.prepared_grib import PreparedGribSource
from ..proc import RunFn
from .gfs_run_total_precip import extract_gfs_run_total_precip
from .icon_accumulated_precip import extract_icon_tot_prec_delta_rate
from .icon_thunderstorm_mask import extract_icon_thunderstorm_mask
from .precip_type_overlay import extract_gfs_precip_type_overlay, extract_icon_precip_type_overlay


def extract_derived_artifact_bands(
    *,
    artifact: ArtifactSpec,
    grid: dict[str, Any],
    source: PreparedGribSource,
    workdir: Path,
    run: RunFn,
    frame_id: str | None,
) -> list[ExtractedBand]:
    """Extract supported derived artifact components as Float32 bytes."""

    derivation = artifact.derivation
    if derivation is None:
        raise SystemExit(f"Artifact {artifact.id} does not declare a derivation")
    if derivation.type == DERIVATION_GFS_RUN_TOTAL_PRECIP:
        return [
            extract_gfs_run_total_precip(
                artifact=artifact,
                grid=grid,
                source=source,
                workdir=workdir,
                run=run,
                frame_id=frame_id,
            )
        ]
    if derivation.type == DERIVATION_ICON_TOT_PREC_DELTA_RATE:
        return [
            extract_icon_tot_prec_delta_rate(
                artifact=artifact,
                grid=grid,
                source=source,
                workdir=workdir,
                run=run,
                frame_id=frame_id,
            )
        ]
    if derivation.type == DERIVATION_PRECIP_TYPE_OVERLAY_FROM_GFS:
        return extract_gfs_precip_type_overlay(
            artifact=artifact,
            grid=grid,
            source=source,
            workdir=workdir,
            run=run,
        )
    if derivation.type == DERIVATION_PRECIP_TYPE_OVERLAY_FROM_ICON_COMPONENTS:
        return extract_icon_precip_type_overlay(
            artifact=artifact,
            grid=grid,
            source=source,
            workdir=workdir,
            run=run,
            frame_id=frame_id,
        )
    if derivation.type == DERIVATION_THUNDERSTORM_MASK_FROM_ICON_WW:
        return [
            extract_icon_thunderstorm_mask(
                artifact=artifact,
                grid=grid,
                source=source,
                workdir=workdir,
                run=run,
            )
        ]
    raise SystemExit(f"Unsupported artifact derivation for {artifact.id}: {derivation.type!r}")
