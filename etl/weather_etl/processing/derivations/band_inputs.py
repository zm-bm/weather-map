"""Shared helpers for derived artifact source inputs and output bands."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from weather_etl.processing.bands import ExtractedBand
from weather_etl.processing.grib import extract_grib_source_band

from ...config.pipeline import ArtifactSpec, DerivationInputSpec
from ...core.frames import parse_lead_hour_frame_id
from ...sources.prepared_grib import PreparedGribSource
from ..proc import RunFn


def bands_from_component_bytes(
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


def zero_float32_band(*, component_id: str, byte_length: int, byte_order: str = "little") -> ExtractedBand:
    return ExtractedBand(
        component_id=component_id,
        source_f32_bytes=b"\x00" * byte_length,
        source_byte_order=byte_order,
    )


def extract_derivation_input_band(
    *,
    artifact: ArtifactSpec,
    input_item: DerivationInputSpec,
    grid: dict[str, Any],
    source: PreparedGribSource,
    workdir: Path,
    run: RunFn,
    suffix: str | None = None,
) -> ExtractedBand:
    file_suffix = f".{suffix}" if suffix else ""
    return extract_grib_source_band(
        artifact=artifact,
        band_id=input_item.id,
        grib_match=input_item.grib_match,
        grid=grid,
        source=source,
        workdir_path=workdir / f"{artifact.id}.{input_item.id}{file_suffix}.f32.bin",
        run=run,
    )


def single_output_component_id(*, artifact: ArtifactSpec, derivation_type: str) -> str:
    if len(artifact.components) != 1:
        raise SystemExit(
            f"Artifact derivation {derivation_type!r} requires exactly one output component for {artifact.id}"
        )
    return artifact.components[0].id


def validate_output_component_ids(
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


def validate_derivation_input_ids(
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


def expected_derivation_inputs(
    *,
    artifact: ArtifactSpec,
    derivation_type: str,
    expected_input_ids: tuple[str, ...],
) -> tuple[DerivationInputSpec, ...]:
    input_items = derivation_inputs(artifact=artifact, derivation_type=derivation_type)
    validate_derivation_input_ids(
        artifact=artifact,
        derivation_type=derivation_type,
        expected_input_ids=expected_input_ids,
        input_items=input_items,
    )
    return input_items


def derivation_inputs(*, artifact: ArtifactSpec, derivation_type: str) -> tuple[DerivationInputSpec, ...]:
    derivation = artifact.derivation
    if derivation is None:
        raise SystemExit(f"Artifact {artifact.id} does not declare a derivation")
    if not derivation.inputs:
        raise SystemExit(f"Artifact derivation {derivation_type!r} requires derivation.inputs for {artifact.id}")
    return derivation.inputs


def single_derivation_input(
    *,
    artifact: ArtifactSpec,
    derivation_type: str,
    input_id: str | None = None,
) -> DerivationInputSpec:
    derivation_items = derivation_inputs(artifact=artifact, derivation_type=derivation_type)
    inputs = (
        tuple(input_item for input_item in derivation_items if input_item.id == input_id)
        if input_id is not None
        else derivation_items
    )
    if len(inputs) != 1:
        input_label = f"{input_id!r} " if input_id is not None else ""
        raise SystemExit(
            f"Artifact derivation {derivation_type!r} requires exactly one {input_label}input for {artifact.id}"
        )
    return inputs[0]


def parse_derivation_lead_hour_frame_id(*, artifact: ArtifactSpec, derivation_type: str, frame_id: str | None) -> int:
    if frame_id is None:
        raise SystemExit(f"Artifact derivation {derivation_type!r} requires frame id context for {artifact.id}")
    try:
        return parse_lead_hour_frame_id(frame_id)
    except ValueError as exc:
        raise SystemExit(
            f"Artifact derivation {derivation_type!r} requires a lead-hour frame id for {artifact.id}: {exc}"
        ) from None
