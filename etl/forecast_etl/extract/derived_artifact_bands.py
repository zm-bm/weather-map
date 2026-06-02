"""Extraction helpers for artifacts derived from prepared source fields."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config.resolved import ArtifactSpec, DerivationInputSpec
from ..derivations import (
    DERIVATION_GFS_RUN_TOTAL_PRECIP,
    DERIVATION_ICON_TOT_PREC_DELTA_RATE,
    DERIVATION_PRECIP_TYPE_OVERLAY_FROM_GFS,
    DERIVATION_PRECIP_TYPE_OVERLAY_FROM_ICON_COMPONENTS,
    DERIVATION_THUNDERSTORM_MASK_FROM_ICON_WW,
    ICON_WEATHER_CODE_DERIVATION_TYPES,
    icon_param_from_grib_match,
    previous_icon_param_key,
)
from ..proc import RunFn
from ..source_adapters.base import PreparedSource
from .accumulation import accumulation_delta_rate_bytes
from .precipitation_overlays import (
    GFS_PRECIP_TYPE_OVERLAY_INPUT_IDS,
    ICON_PRECIP_TYPE_OVERLAY_INPUT_IDS,
    PRECIP_TYPE_OVERLAY_COMPONENT_IDS,
    precip_type_overlay_from_gfs_bytes,
    precip_type_overlay_from_icon_component_rates_bytes,
    thunderstorm_mask_from_icon_ww_bytes,
)
from .source_bands import extract_source_band
from .types import ExtractedBand


def extract_derived_artifact_bands(
    *,
    artifact: ArtifactSpec,
    grid: dict[str, Any],
    source: PreparedSource,
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
            _extract_gfs_run_total_precip(
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
            _extract_icon_tot_prec_delta_rate(
                artifact=artifact,
                grid=grid,
                source=source,
                workdir=workdir,
                run=run,
                frame_id=frame_id,
            )
        ]
    if derivation.type == DERIVATION_PRECIP_TYPE_OVERLAY_FROM_GFS:
        return _extract_gfs_precip_type_overlay(
            artifact=artifact,
            grid=grid,
            source=source,
            workdir=workdir,
            run=run,
        )
    if derivation.type == DERIVATION_PRECIP_TYPE_OVERLAY_FROM_ICON_COMPONENTS:
        return _extract_icon_precip_type_overlay(
            artifact=artifact,
            grid=grid,
            source=source,
            workdir=workdir,
            run=run,
            frame_id=frame_id,
        )
    if derivation.type in ICON_WEATHER_CODE_DERIVATION_TYPES:
        return [
            _extract_icon_ww_artifact(
                artifact=artifact,
                grid=grid,
                source=source,
                workdir=workdir,
                run=run,
                derivation_type=derivation.type,
            )
        ]
    raise SystemExit(f"Unsupported artifact derivation for {artifact.id}: {derivation.type!r}")


def _extract_gfs_run_total_precip(
    *,
    artifact: ArtifactSpec,
    grid: dict[str, Any],
    source: PreparedSource,
    workdir: Path,
    run: RunFn,
    frame_id: str | None,
) -> ExtractedBand:
    output_component_id = _single_output_component_id(
        artifact=artifact,
        derivation_type=DERIVATION_GFS_RUN_TOTAL_PRECIP,
    )
    input_item = _single_derivation_input(
        artifact=artifact,
        derivation_type=DERIVATION_GFS_RUN_TOTAL_PRECIP,
    )
    if frame_id is None:
        raise SystemExit(
            f"Artifact derivation {DERIVATION_GFS_RUN_TOTAL_PRECIP!r} requires forecast hour context for {artifact.id}"
        )
    if len(frame_id) != 3 or not frame_id.isdigit():
        raise SystemExit(f"Forecast hour must be a 3-digit string for {artifact.id}: {frame_id!r}")
    if int(frame_id) == 0:
        byte_length = int(grid["nx"]) * int(grid["ny"]) * 4
        return ExtractedBand(
            component_id=output_component_id,
            source_f32_bytes=b"\x00" * byte_length,
            source_byte_order="little",
        )

    source_band = _extract_derivation_input_band(
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


def _extract_icon_tot_prec_delta_rate(
    *,
    artifact: ArtifactSpec,
    grid: dict[str, Any],
    source: PreparedSource,
    workdir: Path,
    run: RunFn,
    frame_id: str | None,
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
        frame_id=frame_id,
    )


def _extract_gfs_precip_type_overlay(
    *,
    artifact: ArtifactSpec,
    grid: dict[str, Any],
    source: PreparedSource,
    workdir: Path,
    run: RunFn,
) -> list[ExtractedBand]:
    _validate_output_component_ids(
        artifact=artifact,
        derivation_type=DERIVATION_PRECIP_TYPE_OVERLAY_FROM_GFS,
        expected_component_ids=PRECIP_TYPE_OVERLAY_COMPONENT_IDS,
    )
    input_items = _derivation_inputs(
        artifact=artifact,
        derivation_type=DERIVATION_PRECIP_TYPE_OVERLAY_FROM_GFS,
    )
    _validate_derivation_input_ids(
        artifact=artifact,
        derivation_type=DERIVATION_PRECIP_TYPE_OVERLAY_FROM_GFS,
        expected_input_ids=GFS_PRECIP_TYPE_OVERLAY_INPUT_IDS,
        input_items=input_items,
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
        for input_item in input_items
    }
    output_bytes = precip_type_overlay_from_gfs_bytes(
        input_bands=input_bands,
        artifact_id=artifact.id,
    )
    return _bands_from_component_bytes(artifact=artifact, component_bytes=output_bytes)


def _extract_icon_precip_type_overlay(
    *,
    artifact: ArtifactSpec,
    grid: dict[str, Any],
    source: PreparedSource,
    workdir: Path,
    run: RunFn,
    frame_id: str | None,
) -> list[ExtractedBand]:
    _validate_output_component_ids(
        artifact=artifact,
        derivation_type=DERIVATION_PRECIP_TYPE_OVERLAY_FROM_ICON_COMPONENTS,
        expected_component_ids=PRECIP_TYPE_OVERLAY_COMPONENT_IDS,
    )
    if artifact.temporal is None or artifact.temporal.source_interval_hours is None:
        raise SystemExit(
            f"Artifact derivation {DERIVATION_PRECIP_TYPE_OVERLAY_FROM_ICON_COMPONENTS!r} "
            f"requires source_interval_hours for {artifact.id}"
        )
    if frame_id is None:
        raise SystemExit(
            f"Artifact derivation {DERIVATION_PRECIP_TYPE_OVERLAY_FROM_ICON_COMPONENTS!r} "
            f"requires forecast hour context for {artifact.id}"
        )

    input_items = _derivation_inputs(
        artifact=artifact,
        derivation_type=DERIVATION_PRECIP_TYPE_OVERLAY_FROM_ICON_COMPONENTS,
    )
    _validate_derivation_input_ids(
        artifact=artifact,
        derivation_type=DERIVATION_PRECIP_TYPE_OVERLAY_FROM_ICON_COMPONENTS,
        expected_input_ids=ICON_PRECIP_TYPE_OVERLAY_INPUT_IDS,
        input_items=input_items,
    )
    input_bands = {
        input_item.id: _extract_icon_accumulation_rate_band(
            artifact=artifact,
            derivation_type=DERIVATION_PRECIP_TYPE_OVERLAY_FROM_ICON_COMPONENTS,
            component_id=input_item.id,
            input_item=input_item,
            grid=grid,
            source=source,
            workdir=workdir,
            run=run,
            frame_id=frame_id,
        )
        for input_item in input_items
    }
    output_bytes = precip_type_overlay_from_icon_component_rates_bytes(
        input_bands=input_bands,
        artifact_id=artifact.id,
    )
    return _bands_from_component_bytes(artifact=artifact, component_bytes=output_bytes)


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
    if derivation_type == DERIVATION_THUNDERSTORM_MASK_FROM_ICON_WW:
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


def _bands_from_component_bytes(
    *,
    artifact: ArtifactSpec,
    component_bytes: dict[str, bytes],
) -> list[ExtractedBand]:
    bands: list[ExtractedBand] = []
    for component in artifact.components:
        try:
            source_f32_bytes = component_bytes[component.id]
        except KeyError:
            raise SystemExit(
                f"Artifact derivation output for {artifact.id} is missing component {component.id!r}"
            ) from None
        bands.append(
            ExtractedBand(
                component_id=component.id,
                source_f32_bytes=source_f32_bytes,
                source_byte_order="little",
            )
        )
    return bands


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
    frame_id: str | None,
) -> ExtractedBand:
    if artifact.temporal is None or artifact.temporal.source_interval_hours is None:
        raise SystemExit(
            f"Artifact derivation {derivation_type!r} requires source_interval_hours for {artifact.id}"
        )
    if frame_id is None:
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
        frame_id=frame_id,
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
    frame_id: str,
) -> ExtractedBand:
    if len(frame_id) != 3 or not frame_id.isdigit():
        raise SystemExit(f"Forecast hour must be a 3-digit string for {artifact.id}: {frame_id!r}")
    if int(frame_id) <= 1:
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


def _validate_output_component_ids(
    *,
    artifact: ArtifactSpec,
    derivation_type: str,
    expected_component_ids: tuple[str, ...],
) -> None:
    component_ids = artifact.component_ids
    if component_ids != expected_component_ids:
        raise SystemExit(
            f"Artifact derivation {derivation_type!r} requires output components "
            f"{list(expected_component_ids)!r} for {artifact.id}, got {list(component_ids)!r}"
        )


def _validate_derivation_input_ids(
    *,
    artifact: ArtifactSpec,
    derivation_type: str,
    expected_input_ids: tuple[str, ...],
    input_items: tuple[DerivationInputSpec, ...],
) -> None:
    input_ids = tuple(input_item.id for input_item in input_items)
    if input_ids != expected_input_ids:
        raise SystemExit(
            f"Artifact derivation {derivation_type!r} requires inputs "
            f"{list(expected_input_ids)!r} for {artifact.id}, got {list(input_ids)!r}"
        )


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
