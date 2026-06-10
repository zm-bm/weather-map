"""Encode extracted artifact bands into artifact payload bytes."""

from __future__ import annotations

import math
import struct
from typing import Any, Callable

from weather_etl.config.encoding import (
    FORMAT_TEMP_C_PIECEWISE_I8,
    EncodingSpec,
    encoding_format_for_spec,
    encoding_storage_bounds,
    int_item_bytes,
    is_linear_encoding_format,
)
from weather_etl.config.pipeline import ArtifactSpec
from weather_etl.processing.bands import ExtractedBand
from weather_etl.processing.float32 import iter_float32_values

_SourceValueTransform = Callable[[float], float]


def encode_artifact_payload(
    *,
    artifact: ArtifactSpec,
    grid: dict[str, Any],
    bands: list[ExtractedBand],
) -> bytes:
    """Encode and pack all extracted components for one artifact."""

    cell_count = int(grid["nx"]) * int(grid["ny"])
    try:
        component_item_bytes = int_item_bytes(artifact.encoding.dtype)
    except ValueError as exc:
        raise SystemExit(f"Unsupported artifact dtype: {artifact.encoding.dtype!r}") from exc

    expected_component_bytes = cell_count * component_item_bytes
    transform = _source_value_transform(artifact.source_transform)
    encoded_components = []
    for band in bands:
        payload_bytes = encode_component_payload(
            source_f32_bytes=band.source_f32_bytes,
            source_byte_order=band.source_byte_order,
            encoding=artifact.encoding,
            value_transform=transform,
        )

        if len(payload_bytes) != expected_component_bytes:
            raise SystemExit(
                f"Unexpected encoded component byte length for {artifact.id}.{band.component_id}: "
                f"got={len(payload_bytes)} expected={expected_component_bytes}"
            )

        encoded_components.append(payload_bytes)
    return b"".join(encoded_components)


def encode_temp_c_piecewise_i8_value(value: float, *, nodata: int) -> int:
    """Encode Celsius temperature into the piecewise int8 storage scale."""

    if not math.isfinite(value):
        return nodata

    clamped = min(max(value, -35.0), 50.0)
    if clamped <= -8.0:
        idx = math.floor(((clamped + 35.0) / 0.5) + 0.5)
    elif clamped <= 34.0:
        idx = 55 + math.floor(((clamped + 7.75) / 0.25) + 0.5)
    else:
        idx = 223 + math.floor(((clamped - 34.5) / 0.5) + 0.5)

    idx = min(max(int(idx), 0), 254)
    return idx - 127


def encode_component_payload(
    *,
    source_f32_bytes: bytes,
    source_byte_order: str,
    encoding: EncodingSpec,
    value_transform: Callable[[float], float] | None = None,
) -> bytes:
    """Encode one extracted float32 artifact component into payload bytes."""
    encoding_format = encoding_format_for_spec(dtype=encoding.dtype, explicit_format=encoding.format)
    target_item_bytes = int_item_bytes(encoding.dtype)
    target_pack = _signed_int_pack_format(dtype=encoding.dtype, byte_order=encoding.byte_order)

    if is_linear_encoding_format(encoding_format):
        assert encoding.scale is not None
        assert encoding.offset is not None
        linear_scale = encoding.scale
        linear_offset = encoding.offset
    else:
        linear_scale = 1.0
        linear_offset = 0.0

    finite_value_range = encoding.finite_value_range
    if finite_value_range is not None:
        finite_min = finite_value_range.min
        finite_max = finite_value_range.max

    min_stored, max_stored = encoding_storage_bounds(encoding.dtype)
    nodata = encoding.nodata
    invalid_stored = nodata if nodata is not None else 0

    transform = value_transform or _identity

    out = bytearray((len(source_f32_bytes) // 4) * target_item_bytes)
    offset_bytes = 0
    for raw_value in iter_float32_values(source_f32_bytes, byte_order=source_byte_order):
        if not math.isfinite(raw_value):
            stored = invalid_stored
        else:
            transformed_value = transform(float(raw_value))
            if not math.isfinite(transformed_value):
                stored = invalid_stored
            elif encoding_format == FORMAT_TEMP_C_PIECEWISE_I8:
                assert nodata is not None
                stored = encode_temp_c_piecewise_i8_value(transformed_value, nodata=nodata)
            else:
                if finite_value_range is not None:
                    transformed_value = min(max(transformed_value, finite_min), finite_max)
                stored = int(round((transformed_value - linear_offset) / linear_scale))
                stored = min(max(stored, min_stored), max_stored)
                if nodata is not None and stored == nodata:
                    stored = stored + 1 if stored < max_stored else stored - 1

        struct.pack_into(target_pack, out, offset_bytes, stored)
        offset_bytes += target_item_bytes

    return bytes(out)


def _source_value_transform(source_transform: str) -> _SourceValueTransform:
    """Return the scalar value transform used before payload encoding."""

    try:
        return _SOURCE_VALUE_TRANSFORMS[source_transform.strip()]
    except KeyError as exc:
        raise SystemExit(f"Unsupported source transform: {source_transform!r}") from exc


def _identity(value: float) -> float:
    return value


def _kg_m2_s_to_mm_hr(value: float) -> float:
    return value * 3600.0


def _cin_magnitude(value: float) -> float:
    return abs(value)


def _signed_int_pack_format(*, dtype: str, byte_order: str) -> str:
    if dtype == "int8":
        if byte_order != "none":
            raise SystemExit(f"Unsupported byte order for int8: {byte_order!r}")
        return "b"
    if dtype == "int16":
        if byte_order not in {"little", "big"}:
            raise SystemExit(f"Unsupported byte order for int16: {byte_order!r}")
        return "<h" if byte_order == "little" else ">h"
    raise SystemExit(f"Unsupported signed integer dtype: {dtype!r}")


_SOURCE_VALUE_TRANSFORMS: dict[str, _SourceValueTransform] = {
    "identity": _identity,
    "kg_m2_s_to_mm_hr": _kg_m2_s_to_mm_hr,
    "cin_magnitude": _cin_magnitude,
}
