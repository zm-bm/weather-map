"""ICON accumulated-precipitation derivations."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from weather_etl.processing.bands import ExtractedBand
from weather_etl.processing.grib import extract_grib_source_band
from weather_etl.sources.icon.params import (
    ICON_PARAM_SELECTOR_KEY,
    icon_param_from_grib_match,
    previous_icon_prepared_source_key,
)

from ...config.derivations import DERIVATION_ICON_TOT_PREC_DELTA_RATE
from ...config.pipeline import ArtifactSpec, DerivationInputSpec
from ...sources.prepared_grib import PreparedGribSource
from ..proc import RunFn
from .accumulation_rate import accumulation_delta_rate_bytes
from .band_inputs import (
    extract_derivation_input_band,
    parse_derivation_lead_hour_frame_id,
    single_derivation_input,
    single_output_component_id,
    zero_float32_band,
)


def extract_icon_tot_prec_delta_rate(
    *,
    artifact: ArtifactSpec,
    grid: dict[str, Any],
    source: PreparedGribSource,
    workdir: Path,
    run: RunFn,
    frame_id: str | None,
) -> ExtractedBand:
    output_component_id = single_output_component_id(
        artifact=artifact,
        derivation_type=DERIVATION_ICON_TOT_PREC_DELTA_RATE,
    )
    input_item = single_derivation_input(
        artifact=artifact,
        derivation_type=DERIVATION_ICON_TOT_PREC_DELTA_RATE,
    )
    return extract_icon_precip_rate_band(
        artifact=artifact,
        derivation_type=DERIVATION_ICON_TOT_PREC_DELTA_RATE,
        component_id=output_component_id,
        input_item=input_item,
        grid=grid,
        source=source,
        workdir=workdir,
        run=run,
        frame_id=frame_id,
    )

def extract_icon_precip_rate_band(
    *,
    artifact: ArtifactSpec,
    derivation_type: str,
    component_id: str,
    input_item: DerivationInputSpec,
    grid: dict[str, Any],
    source: PreparedGribSource,
    workdir: Path,
    run: RunFn,
    frame_id: str | None,
) -> ExtractedBand:
    source_interval_hours = _require_source_interval_hours(
        artifact=artifact,
        derivation_type=derivation_type,
    )
    frame_number = parse_derivation_lead_hour_frame_id(
        artifact=artifact,
        derivation_type=derivation_type,
        frame_id=frame_id,
    )

    current_band = extract_derivation_input_band(
        artifact=artifact,
        grid=grid,
        source=source,
        input_item=input_item,
        workdir=workdir,
        run=run,
        suffix="current",
    )
    previous_band = _previous_icon_precip_accumulation_band(
        artifact=artifact,
        input_item=input_item,
        current_band=current_band,
        grid=grid,
        source=source,
        workdir=workdir,
        run=run,
        frame_number=frame_number,
    )
    return ExtractedBand(
        component_id=component_id,
        source_f32_bytes=accumulation_delta_rate_bytes(
            current_bytes=current_band.source_f32_bytes,
            current_byte_order=current_band.source_byte_order,
            previous_bytes=previous_band.source_f32_bytes,
            previous_byte_order=previous_band.source_byte_order,
            interval_seconds=float(source_interval_hours) * 3600.0,
            artifact_id=artifact.id,
            component_id=component_id,
        ),
        source_byte_order=current_band.source_byte_order,
    )


def _previous_icon_precip_accumulation_band(
    *,
    artifact: ArtifactSpec,
    input_item: DerivationInputSpec,
    current_band: ExtractedBand,
    grid: dict[str, Any],
    source: PreparedGribSource,
    workdir: Path,
    run: RunFn,
    frame_number: int,
) -> ExtractedBand:
    if frame_number <= 1:
        return zero_float32_band(
            component_id=input_item.id,
            byte_length=len(current_band.source_f32_bytes),
            byte_order=current_band.source_byte_order,
        )

    previous_grib_match = {
        **input_item.grib_match,
        ICON_PARAM_SELECTOR_KEY: previous_icon_prepared_source_key(
            icon_param_from_grib_match(artifact_id=artifact.id, grib_match=input_item.grib_match)
        ),
    }
    return extract_grib_source_band(
        artifact=artifact,
        band_id=input_item.id,
        grib_match=previous_grib_match,
        grid=grid,
        source=source,
        workdir_path=workdir / f"{artifact.id}.{input_item.id}.previous.f32.bin",
        run=run,
    )


def _require_source_interval_hours(*, artifact: ArtifactSpec, derivation_type: str) -> float:
    if artifact.temporal is None:
        raise SystemExit(f"Artifact derivation {derivation_type!r} requires temporal metadata for {artifact.id}")
    if artifact.temporal.kind != "average_rate":
        raise SystemExit(f"Artifact derivation {derivation_type!r} requires temporal.kind='average_rate' for {artifact.id}")
    if artifact.temporal.source_interval_hours != 1:
        raise SystemExit(f"Artifact derivation {derivation_type!r} requires source_interval_hours=1 for {artifact.id}")
    derivation = artifact.derivation
    if derivation is None or derivation.first_hour_previous != "zero":
        raise SystemExit(f"Artifact derivation {derivation_type!r} requires first_hour_previous='zero' for {artifact.id}")
    return float(artifact.temporal.source_interval_hours)
