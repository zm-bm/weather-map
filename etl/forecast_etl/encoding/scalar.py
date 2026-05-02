"""Scalar payload encoding contract and byte conversion helpers."""

from __future__ import annotations

import math
import struct
from typing import Any

SCALAR_LINEAR_DECODE_FORMULA = "value = stored * scale + offset"
SCALAR_DECODE_FORMULA = SCALAR_LINEAR_DECODE_FORMULA
SCALAR_FORMAT_I16_LINEAR = "scalar-i16-linear-v1"
SCALAR_FORMAT_I8_LINEAR = "scalar-i8-linear-v1"
SCALAR_FORMAT_I8_LINEAR_COMPONENTS = "scalar-i8-linear-components-v1"
SCALAR_FORMAT_I8_TEMP_C_PIECEWISE = "scalar-i8-temp-c-piecewise-v1"
SCALAR_COMPONENT_ORDER_LOW_MEDIUM_HIGH = "low_medium_high"
SCALAR_CLOUD_LAYER_COMPONENTS = ("low", "medium", "high")
SCALAR_SOURCE_TRANSFORM_IDENTITY = "identity"
SCALAR_SOURCE_TRANSFORM_KG_M2_S_TO_MM_HR = "kg_m2_s_to_mm_hr"
SCALAR_SOURCE_TRANSFORMS = {
    SCALAR_SOURCE_TRANSFORM_IDENTITY,
    SCALAR_SOURCE_TRANSFORM_KG_M2_S_TO_MM_HR,
}
SCALAR_FORMAT_BY_DTYPE = {
    "int16": SCALAR_FORMAT_I16_LINEAR,
    "int8": SCALAR_FORMAT_I8_LINEAR,
}
SCALAR_DTYPE_BY_FORMAT = {
    SCALAR_FORMAT_I16_LINEAR: "int16",
    SCALAR_FORMAT_I8_LINEAR: "int8",
    SCALAR_FORMAT_I8_LINEAR_COMPONENTS: "int8",
    SCALAR_FORMAT_I8_TEMP_C_PIECEWISE: "int8",
}
SCALAR_LINEAR_FORMATS = {
    SCALAR_FORMAT_I16_LINEAR,
    SCALAR_FORMAT_I8_LINEAR,
    SCALAR_FORMAT_I8_LINEAR_COMPONENTS,
}
SCALAR_BYTE_ORDERS_BY_DTYPE = {
    "int16": {"little", "big"},
    "int8": {"none"},
}
SCALAR_STORAGE_BOUNDS_BY_DTYPE = {
    "int16": (-32768, 32767),
    "int8": (-128, 127),
}
SCALAR_REQUIRED_NODATA_BY_FORMAT = {
    SCALAR_FORMAT_I8_LINEAR_COMPONENTS: -128,
    SCALAR_FORMAT_I8_TEMP_C_PIECEWISE: -128,
}
SCALAR_PAYLOAD_SUFFIX_BY_DTYPE = {
    "int16": "i16",
    "int8": "i8",
}

__all__ = [
    "SCALAR_BYTE_ORDERS_BY_DTYPE",
    "SCALAR_CLOUD_LAYER_COMPONENTS",
    "SCALAR_COMPONENT_ORDER_LOW_MEDIUM_HIGH",
    "SCALAR_DECODE_FORMULA",
    "SCALAR_DTYPE_BY_FORMAT",
    "SCALAR_FORMAT_I16_LINEAR",
    "SCALAR_FORMAT_I8_LINEAR",
    "SCALAR_FORMAT_I8_LINEAR_COMPONENTS",
    "SCALAR_FORMAT_I8_TEMP_C_PIECEWISE",
    "SCALAR_SOURCE_TRANSFORM_IDENTITY",
    "SCALAR_SOURCE_TRANSFORM_KG_M2_S_TO_MM_HR",
    "SCALAR_SOURCE_TRANSFORMS",
    "encode_scalar_f32_to_i16_payload",
    "encode_scalar_f32_to_payload",
    "encode_temp_c_piecewise_i8_value",
    "is_linear_scalar_format",
    "scalar_dtype_for_format",
    "scalar_format_for_dtype",
    "scalar_format_for_encoding",
    "scalar_payload_suffix_for_dtype",
    "scalar_required_nodata",
    "scalar_storage_bounds",
]


def scalar_format_for_dtype(dtype: str) -> str:
    try:
        return SCALAR_FORMAT_BY_DTYPE[dtype]
    except KeyError as exc:
        raise ValueError(f"Unsupported scalar dtype: {dtype!r}") from exc


def scalar_format_for_encoding(*, dtype: str, explicit_format: str | None = None) -> str:
    if explicit_format is None or explicit_format == "":
        return scalar_format_for_dtype(dtype)
    if explicit_format not in SCALAR_DTYPE_BY_FORMAT:
        raise ValueError(f"Unsupported scalar format: {explicit_format!r}")
    expected_dtype = scalar_dtype_for_format(explicit_format)
    if dtype != expected_dtype:
        raise ValueError(
            f"Scalar format {explicit_format!r} requires dtype {expected_dtype!r}, got {dtype!r}"
        )
    return explicit_format


def scalar_dtype_for_format(scalar_format: str) -> str:
    try:
        return SCALAR_DTYPE_BY_FORMAT[scalar_format]
    except KeyError as exc:
        raise ValueError(f"Unsupported scalar format: {scalar_format!r}") from exc


def is_linear_scalar_format(scalar_format: str) -> bool:
    return scalar_format in SCALAR_LINEAR_FORMATS


def scalar_required_nodata(scalar_format: str) -> int | None:
    return SCALAR_REQUIRED_NODATA_BY_FORMAT.get(scalar_format)


def scalar_storage_bounds(dtype: str) -> tuple[int, int]:
    try:
        return SCALAR_STORAGE_BOUNDS_BY_DTYPE[dtype]
    except KeyError as exc:
        raise ValueError(f"Unsupported scalar dtype: {dtype!r}") from exc


def scalar_payload_suffix_for_dtype(dtype: str) -> str:
    try:
        return SCALAR_PAYLOAD_SUFFIX_BY_DTYPE[dtype]
    except KeyError as exc:
        raise ValueError(f"Unsupported scalar dtype: {dtype!r}") from exc


def _normalize_scalar_source_transform(raw: Any, *, layer: str) -> str:
    if raw is None:
        return SCALAR_SOURCE_TRANSFORM_IDENTITY
    if isinstance(raw, str):
        normalized = raw.strip()
        if normalized in SCALAR_SOURCE_TRANSFORMS:
            return normalized
    raise SystemExit(
        f"Layer {layer} has invalid scalar_source_transform: {raw!r}; "
        f"expected one of {sorted(SCALAR_SOURCE_TRANSFORMS)!r}"
    )


def _apply_scalar_source_transform(value: float, *, source_transform: str) -> float:
    if source_transform == SCALAR_SOURCE_TRANSFORM_IDENTITY:
        return value
    if source_transform == SCALAR_SOURCE_TRANSFORM_KG_M2_S_TO_MM_HR:
        return value * 3600.0
    raise SystemExit(f"Unsupported scalar source transform: {source_transform!r}")


def encode_temp_c_piecewise_i8_value(value: float, *, nodata: int) -> int:
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


def encode_scalar_f32_to_payload(
    *,
    source_f32_bytes: bytes,
    source_byte_order: str,
    target_dtype: str,
    target_byte_order: str,
    nodata: int,
    scale: float | None = None,
    offset: float | None = None,
    target_format: str | None = None,
    source_transform: str = SCALAR_SOURCE_TRANSFORM_IDENTITY,
) -> bytes:
    """Encode float32 source bytes into scalar payload bytes."""
    if len(source_f32_bytes) % 4 != 0:
        raise SystemExit(f"Invalid float32 source byte length: {len(source_f32_bytes)}")
    if source_byte_order not in {"little", "big"}:
        raise SystemExit(f"Unsupported source byte order: {source_byte_order!r}")
    try:
        scalar_format = scalar_format_for_encoding(dtype=target_dtype, explicit_format=target_format)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    if target_dtype == "int16":
        if target_byte_order not in {"little", "big"}:
            raise SystemExit(f"Unsupported target byte order for int16: {target_byte_order!r}")
        target_pack = "<h" if target_byte_order == "little" else ">h"
        target_item_bytes = 2
    elif target_dtype == "int8":
        if target_byte_order != "none":
            raise SystemExit(f"Unsupported target byte order for int8: {target_byte_order!r}")
        target_pack = "b"
        target_item_bytes = 1
    else:
        raise SystemExit(f"Unsupported scalar target dtype: {target_dtype!r}")
    if is_linear_scalar_format(scalar_format):
        if scale is None or scale == 0 or not math.isfinite(scale):
            raise SystemExit(f"Invalid scalar scale (must be finite and non-zero): {scale!r}")
        if offset is None or not math.isfinite(offset):
            raise SystemExit(f"Invalid scalar offset (must be finite): {offset!r}")
        linear_scale = scale
        linear_offset = offset
    else:
        linear_scale = 1.0
        linear_offset = 0.0
    min_stored, max_stored = scalar_storage_bounds(target_dtype)
    if nodata < min_stored or nodata > max_stored:
        raise SystemExit(f"Invalid {target_dtype} nodata sentinel: {nodata!r}")
    required_nodata = scalar_required_nodata(scalar_format)
    if required_nodata is not None and nodata != required_nodata:
        raise SystemExit(f"Invalid nodata sentinel for {scalar_format}: {nodata!r}")

    normalized_transform = _normalize_scalar_source_transform(source_transform, layer="__internal__")
    source_unpack = "<f" if source_byte_order == "little" else ">f"

    out = bytearray((len(source_f32_bytes) // 4) * target_item_bytes)
    offset_bytes = 0
    for (raw_value,) in struct.iter_unpack(source_unpack, source_f32_bytes):
        if not math.isfinite(raw_value):
            stored = nodata
        else:
            transformed_value = _apply_scalar_source_transform(
                float(raw_value),
                source_transform=normalized_transform,
            )
            if not math.isfinite(transformed_value):
                stored = nodata
            elif scalar_format == SCALAR_FORMAT_I8_TEMP_C_PIECEWISE:
                stored = encode_temp_c_piecewise_i8_value(transformed_value, nodata=nodata)
            else:
                stored = int(round((transformed_value - linear_offset) / linear_scale))
                if stored < min_stored:
                    stored = min_stored
                elif stored > max_stored:
                    stored = max_stored
                if stored == nodata:
                    stored = stored + 1 if stored < max_stored else stored - 1

        struct.pack_into(target_pack, out, offset_bytes, stored)
        offset_bytes += target_item_bytes

    return bytes(out)


def encode_scalar_f32_to_i16_payload(
    *,
    source_f32_bytes: bytes,
    source_byte_order: str,
    target_byte_order: str,
    scale: float,
    offset: float,
    nodata: int,
    source_transform: str = SCALAR_SOURCE_TRANSFORM_IDENTITY,
) -> bytes:
    """Encode float32 source bytes into scalar-i16-linear-v1 payload bytes."""
    return encode_scalar_f32_to_payload(
        source_f32_bytes=source_f32_bytes,
        source_byte_order=source_byte_order,
        target_dtype="int16",
        target_byte_order=target_byte_order,
        scale=scale,
        offset=offset,
        nodata=nodata,
        source_transform=source_transform,
    )
