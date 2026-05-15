"""Extraction helpers for artifacts derived from prepared source fields."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config.resolved import ArtifactSpec, DerivationInputSpec
from ..derivations import (
    DERIVATION_ICON_TOT_PREC_DELTA_RATE,
    DERIVATION_PRECIP_TYPE_FROM_GFS_CATEGORIES,
    DERIVATION_PRECIP_TYPE_FROM_ICON_WW,
    DERIVATION_THUNDERSTORM_MASK_FROM_ICON_WW,
    ICON_WEATHER_CODE_DERIVATION_TYPES,
    icon_param_from_grib_match,
    previous_icon_param_key,
)
from ..proc import RunFn
from ..source_adapters.base import PreparedSource
from .accumulation import accumulation_delta_rate_bytes
from .precipitation_overlays import (
    precip_type_from_gfs_category_bytes,
    precip_type_from_icon_ww_bytes,
    thunderstorm_mask_from_icon_ww_bytes,
)
from .source_bands import extract_source_band
from .types import ExtractedBand


def extract_derived_artifact_band(
    *,
    artifact: ArtifactSpec,
    grid: dict[str, Any],
    source: PreparedSource,
    workdir: Path,
    run: RunFn,
    fhour: str | None,
) -> ExtractedBand:
    """Extract one supported derived artifact component as Float32 bytes."""

    derivation = artifact.derivation
    if derivation is None:
        raise SystemExit(f"Artifact {artifact.id} does not declare a derivation")
    if derivation.type == DERIVATION_ICON_TOT_PREC_DELTA_RATE:
        return _extract_icon_tot_prec_delta_rate(
            artifact=artifact,
            grid=grid,
            source=source,
            workdir=workdir,
            run=run,
            fhour=fhour,
        )
    if derivation.type == DERIVATION_PRECIP_TYPE_FROM_GFS_CATEGORIES:
        return _extract_gfs_precip_type(
            artifact=artifact,
            grid=grid,
            source=source,
            workdir=workdir,
            run=run,
        )
    if derivation.type in ICON_WEATHER_CODE_DERIVATION_TYPES:
        return _extract_icon_ww_artifact(
            artifact=artifact,
            grid=grid,
            source=source,
            workdir=workdir,
            run=run,
            derivation_type=derivation.type,
        )
    raise SystemExit(f"Unsupported artifact derivation for {artifact.id}: {derivation.type!r}")


def _extract_icon_tot_prec_delta_rate(
    *,
    artifact: ArtifactSpec,
    grid: dict[str, Any],
    source: PreparedSource,
    workdir: Path,
    run: RunFn,
    fhour: str | None,
) -> ExtractedBand:
    output_component_id = _single_output_component_id(
        artifact=artifact,
        derivation_type=DERIVATION_ICON_TOT_PREC_DELTA_RATE,
    )
    input_item = _single_derivation_input(
        artifact=artifact,
        derivation_type=DERIVATION_ICON_TOT_PREC_DELTA_RATE,
    )
    return _extract_icon_accumulation_rate_band(
        artifact=artifact,
        derivation_type=DERIVATION_ICON_TOT_PREC_DELTA_RATE,
        component_id=output_component_id,
        input_item=input_item,
        grid=grid,
        source=source,
        workdir=workdir,
        run=run,
        fhour=fhour,
    )


def _extract_gfs_precip_type(
    *,
    artifact: ArtifactSpec,
    grid: dict[str, Any],
    source: PreparedSource,
    workdir: Path,
    run: RunFn,
) -> ExtractedBand:
    output_component_id = _single_output_component_id(
        artifact=artifact,
        derivation_type=DERIVATION_PRECIP_TYPE_FROM_GFS_CATEGORIES,
    )
    input_bands = {
        input_item.id: _extract_derivation_input_band(
            artifact=artifact,
            grid=grid,
            source=source,
            input_item=input_item,
            workdir=workdir,
            run=run,
        )
        for input_item in _derivation_inputs(
            artifact=artifact,
            derivation_type=DERIVATION_PRECIP_TYPE_FROM_GFS_CATEGORIES,
        )
    }
    return ExtractedBand(
        component_id=output_component_id,
        source_f32_bytes=precip_type_from_gfs_category_bytes(
            input_bands=input_bands,
            artifact_id=artifact.id,
        ),
        source_byte_order="little",
    )


def _extract_icon_ww_artifact(
    *,
    artifact: ArtifactSpec,
    grid: dict[str, Any],
    source: PreparedSource,
    workdir: Path,
    run: RunFn,
    derivation_type: str,
) -> ExtractedBand:
    output_component_id = _single_output_component_id(
        artifact=artifact,
        derivation_type=derivation_type,
    )
    input_item = _single_derivation_input(
        artifact=artifact,
        derivation_type=derivation_type,
        input_id="ww",
    )
    ww_band = _extract_derivation_input_band(
        artifact=artifact,
        grid=grid,
        source=source,
        input_item=input_item,
        workdir=workdir,
        run=run,
    )
    if derivation_type == DERIVATION_PRECIP_TYPE_FROM_ICON_WW:
        source_f32_bytes = precip_type_from_icon_ww_bytes(ww_band=ww_band)
    elif derivation_type == DERIVATION_THUNDERSTORM_MASK_FROM_ICON_WW:
        source_f32_bytes = thunderstorm_mask_from_icon_ww_bytes(ww_band=ww_band)
    else:
        raise SystemExit(
            f"Unsupported ICON weather-code derivation for {artifact.id}: {derivation_type!r}"
        )
    return ExtractedBand(
        component_id=output_component_id,
        source_f32_bytes=source_f32_bytes,
        source_byte_order="little",
    )


def _extract_icon_accumulation_rate_band(
    *,
    artifact: ArtifactSpec,
    derivation_type: str,
    component_id: str,
    input_item: DerivationInputSpec,
    grid: dict[str, Any],
    source: PreparedSource,
    workdir: Path,
    run: RunFn,
    fhour: str | None,
) -> ExtractedBand:
    if artifact.temporal is None or artifact.temporal.source_interval_hours is None:
        raise SystemExit(
            f"Artifact derivation {derivation_type!r} requires source_interval_hours for {artifact.id}"
        )
    if fhour is None:
        raise SystemExit(f"Artifact derivation {derivation_type!r} requires forecast hour context for {artifact.id}")

    current_band = _extract_derivation_input_band(
        artifact=artifact,
        grid=grid,
        source=source,
        input_item=input_item,
        workdir=workdir,
        run=run,
        suffix="current",
    )
    previous_band = _previous_accumulation_band(
        artifact=artifact,
        input_item=input_item,
        current_band=current_band,
        grid=grid,
        source=source,
        workdir=workdir,
        run=run,
        fhour=fhour,
    )
    return ExtractedBand(
        component_id=component_id,
        source_f32_bytes=accumulation_delta_rate_bytes(
            current_bytes=current_band.source_f32_bytes,
            current_byte_order=current_band.source_byte_order,
            previous_bytes=previous_band.source_f32_bytes,
            previous_byte_order=previous_band.source_byte_order,
            interval_seconds=float(artifact.temporal.source_interval_hours) * 3600.0,
            artifact_id=artifact.id,
            component_id=component_id,
        ),
        source_byte_order=current_band.source_byte_order,
    )


def _previous_accumulation_band(
    *,
    artifact: ArtifactSpec,
    input_item: DerivationInputSpec,
    current_band: ExtractedBand,
    grid: dict[str, Any],
    source: PreparedSource,
    workdir: Path,
    run: RunFn,
    fhour: str,
) -> ExtractedBand:
    if len(fhour) != 3 or not fhour.isdigit():
        raise SystemExit(f"Forecast hour must be a 3-digit string for {artifact.id}: {fhour!r}")
    if int(fhour) <= 1:
        return ExtractedBand(
            component_id=input_item.id,
            source_f32_bytes=b"\x00" * len(current_band.source_f32_bytes),
            source_byte_order=current_band.source_byte_order,
        )

    previous_grib_match = {
        **input_item.grib_match,
        "ICON_PARAM": previous_icon_param_key(
            icon_param_from_grib_match(artifact_id=artifact.id, grib_match=input_item.grib_match)
        ),
    }
    return extract_source_band(
        artifact=artifact,
        band_id=input_item.id,
        grib_match=previous_grib_match,
        grid=grid,
        source=source,
        workdir_path=workdir / f"{artifact.id}.{input_item.id}.previous.f32.bin",
        run=run,
    )


def _extract_derivation_input_band(
    *,
    artifact: ArtifactSpec,
    input_item: DerivationInputSpec,
    grid: dict[str, Any],
    source: PreparedSource,
    workdir: Path,
    run: RunFn,
    suffix: str | None = None,
) -> ExtractedBand:
    file_suffix = f".{suffix}" if suffix else ""
    return extract_source_band(
        artifact=artifact,
        band_id=input_item.id,
        grib_match=input_item.grib_match,
        grid=grid,
        source=source,
        workdir_path=workdir / f"{artifact.id}.{input_item.id}{file_suffix}.f32.bin",
        run=run,
    )


def _single_output_component_id(*, artifact: ArtifactSpec, derivation_type: str) -> str:
    if len(artifact.components) != 1:
        raise SystemExit(
            f"Artifact derivation {derivation_type!r} "
            f"requires exactly one output component for {artifact.id}"
        )
    return artifact.components[0].id


def _derivation_inputs(*, artifact: ArtifactSpec, derivation_type: str) -> tuple[DerivationInputSpec, ...]:
    derivation = artifact.derivation
    if derivation is None:
        raise SystemExit(f"Artifact {artifact.id} does not declare a derivation")
    if not derivation.inputs:
        raise SystemExit(
            f"Artifact derivation {derivation_type!r} requires derivation.inputs for {artifact.id}"
        )
    return derivation.inputs


def _single_derivation_input(
    *,
    artifact: ArtifactSpec,
    derivation_type: str,
    input_id: str | None = None,
) -> DerivationInputSpec:
    derivation_inputs = _derivation_inputs(artifact=artifact, derivation_type=derivation_type)
    inputs = (
        tuple(input_item for input_item in derivation_inputs if input_item.id == input_id)
        if input_id is not None
        else derivation_inputs
    )
    if len(inputs) != 1:
        input_label = f"{input_id!r} " if input_id is not None else ""
        raise SystemExit(
            f"Artifact derivation {derivation_type!r} "
            f"requires exactly one {input_label}input for {artifact.id}"
        )
    return inputs[0]
