"""GFS run-total precipitation derivation."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from weather_etl.config.derivations import DERIVATION_GFS_RUN_TOTAL_PRECIP
from weather_etl.processing.bands import ExtractedBand

from ...config.pipeline import ArtifactSpec
from ...sources.prepared_grib import PreparedGribSource
from ..proc import RunFn
from .band_inputs import (
    extract_derivation_input_band,
    parse_derivation_lead_hour_frame_id,
    single_derivation_input,
    single_output_component_id,
    zero_float32_band,
)


def extract_gfs_run_total_precip(
    *,
    artifact: ArtifactSpec,
    grid: dict[str, Any],
    source: PreparedGribSource,
    workdir: Path,
    run: RunFn,
    frame_id: str | None,
) -> ExtractedBand:
    _require_accumulation_temporal(
        artifact=artifact,
        derivation_type=DERIVATION_GFS_RUN_TOTAL_PRECIP,
    )
    output_component_id = single_output_component_id(
        artifact=artifact,
        derivation_type=DERIVATION_GFS_RUN_TOTAL_PRECIP,
    )
    input_item = single_derivation_input(
        artifact=artifact,
        derivation_type=DERIVATION_GFS_RUN_TOTAL_PRECIP,
    )
    frame_number = parse_derivation_lead_hour_frame_id(
        artifact=artifact,
        derivation_type=DERIVATION_GFS_RUN_TOTAL_PRECIP,
        frame_id=frame_id,
    )
    if frame_number == 0:
        return zero_float32_band(
            component_id=output_component_id,
            byte_length=int(grid["nx"]) * int(grid["ny"]) * 4,
        )

    source_band = extract_derivation_input_band(
        artifact=artifact,
        input_item=input_item,
        grid=grid,
        source=source,
        workdir=workdir,
        run=run,
    )
    return ExtractedBand(
        component_id=output_component_id,
        source_f32_bytes=source_band.source_f32_bytes,
        source_byte_order=source_band.source_byte_order,
    )


def _require_accumulation_temporal(*, artifact: ArtifactSpec, derivation_type: str) -> None:
    if artifact.temporal is None:
        raise SystemExit(f"Artifact derivation {derivation_type!r} requires temporal metadata for {artifact.id}")
    if artifact.temporal.kind != "accumulation":
        raise SystemExit(f"Artifact derivation {derivation_type!r} requires temporal.kind='accumulation' for {artifact.id}")
