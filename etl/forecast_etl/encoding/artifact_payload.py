"""Encode extracted artifact components into artifact payload bytes."""

from __future__ import annotations

from typing import Any

from ..config.resolved import ArtifactSpec
from ..extract.types import ExtractedBand
from .codecs import encode_component_payload
from .numeric import int_item_bytes
from .transforms import source_value_transform


def encode_artifact_payload(
    *,
    artifact: ArtifactSpec,
    grid: dict[str, Any],
    bands: list[ExtractedBand],
) -> bytes:
    """Encode and pack all extracted components for one artifact."""

    expected_component_bytes = int(grid["nx"]) * int(grid["ny"]) * _component_item_bytes(artifact.encoding.dtype)
    encoded_components = [
        encode_artifact_component(
            artifact=artifact,
            expected_component_bytes=expected_component_bytes,
            band=band,
        )
        for band in bands
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
    )

    if len(payload_bytes) != expected_component_bytes:
        raise SystemExit(
            f"Unexpected encoded component byte length for {artifact.id}.{band.component_id}: "
            f"got={len(payload_bytes)} expected={expected_component_bytes}"
        )

    return payload_bytes


def _component_item_bytes(dtype: str) -> int:
    try:
        return int_item_bytes(dtype)
    except ValueError as exc:
        raise SystemExit(f"Unsupported artifact dtype: {dtype!r}") from exc
