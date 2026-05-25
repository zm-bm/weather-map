"""Encode extracted artifact components into artifact payload bytes."""

from __future__ import annotations

import math
import struct
from typing import Any

from ..config.resolved import ArtifactSpec
from ..extract.types import ExtractedBand
from .codecs import encode_component_payload
from .numeric import int_item_bytes, iter_float32_values
from .transforms import source_value_transform


def encode_artifact_payload(
    *,
    artifact: ArtifactSpec,
    grid: dict[str, Any],
    bands: list[ExtractedBand],
) -> bytes:
    """Encode and pack all extracted components for one artifact."""

    cell_count = int(grid["nx"]) * int(grid["ny"])
    source_bands = _sanitize_wind10m_uv_bands(artifact=artifact, bands=bands, cell_count=cell_count)
    expected_component_bytes = cell_count * _component_item_bytes(artifact.encoding.dtype)
    encoded_components = [
        encode_artifact_component(
            artifact=artifact,
            expected_component_bytes=expected_component_bytes,
            band=band,
        )
        for band in source_bands
    ]
    return b"".join(encoded_components)


def encode_artifact_component(
    *,
    artifact: ArtifactSpec,
    expected_component_bytes: int,
    band: ExtractedBand,
) -> bytes:
    """Encode one extracted component and verify its byte length."""

    encoding = artifact.encoding
    transform = source_value_transform(artifact.source_transform)
    payload_bytes = encode_component_payload(
        source_f32_bytes=band.source_f32_bytes,
        source_byte_order=band.source_byte_order,
        target_dtype=encoding.dtype,
        target_byte_order=encoding.byte_order,
        target_format=encoding.format,
        scale=encoding.scale,
        offset=encoding.offset,
        nodata=encoding.nodata,
        value_transform=transform,
        finite_value_range=_finite_value_range_tuple(artifact),
    )

    if len(payload_bytes) != expected_component_bytes:
        raise SystemExit(
            f"Unexpected encoded component byte length for {artifact.id}.{band.component_id}: "
            f"got={len(payload_bytes)} expected={expected_component_bytes}"
        )

    return payload_bytes


def _finite_value_range_tuple(artifact: ArtifactSpec) -> tuple[float, float] | None:
    finite_value_range = artifact.encoding.finite_value_range
    if finite_value_range is None:
        return None
    return (finite_value_range.min, finite_value_range.max)


def _sanitize_wind10m_uv_bands(
    *,
    artifact: ArtifactSpec,
    bands: list[ExtractedBand],
    cell_count: int,
) -> list[ExtractedBand]:
    if artifact.id != "wind10m_uv" or artifact.component_ids != ("u", "v"):
        return bands

    bands_by_component = {band.component_id: band for band in bands}
    u_band = bands_by_component.get("u")
    v_band = bands_by_component.get("v")
    if u_band is None or v_band is None:
        return bands

    u_values = list(iter_float32_values(u_band.source_f32_bytes, byte_order=u_band.source_byte_order))
    v_values = list(iter_float32_values(v_band.source_f32_bytes, byte_order=v_band.source_byte_order))
    if len(u_values) != cell_count or len(v_values) != cell_count:
        raise SystemExit(
            f"Wind vector source component count mismatch for {artifact.id}: "
            f"u={len(u_values)} v={len(v_values)} expected={cell_count}"
        )

    u_out = bytearray(cell_count * 4)
    v_out = bytearray(cell_count * 4)
    for idx, (u_value, v_value) in enumerate(zip(u_values, v_values)):
        if not math.isfinite(u_value) or not math.isfinite(v_value):
            u_value = 0.0
            v_value = 0.0
        struct.pack_into("<f", u_out, idx * 4, u_value)
        struct.pack_into("<f", v_out, idx * 4, v_value)

    return [
        ExtractedBand(component_id="u", source_f32_bytes=bytes(u_out), source_byte_order="little"),
        ExtractedBand(component_id="v", source_f32_bytes=bytes(v_out), source_byte_order="little"),
    ]


def _component_item_bytes(dtype: str) -> int:
    try:
        return int_item_bytes(dtype)
    except ValueError as exc:
        raise SystemExit(f"Unsupported artifact dtype: {dtype!r}") from exc
