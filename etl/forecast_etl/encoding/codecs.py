"""Payload codec contracts and component byte conversion helpers."""

from __future__ import annotations

import math
import struct
from typing import Callable

from .numeric import (
    clamp_int,
    int_item_bytes,
    int_storage_bounds,
    iter_float32_values,
    signed_int_pack_format,
)

LINEAR_DECODE_FORMULA = "value = stored * scale + offset"
FORMAT_LINEAR_I16 = "linear-i16-v1"
FORMAT_LINEAR_I8 = "linear-i8-v1"
FORMAT_TEMP_C_PIECEWISE_I8 = "temp-c-piecewise-i8-v1"
FORMAT_BY_DTYPE = {
    "int16": FORMAT_LINEAR_I16,
    "int8": FORMAT_LINEAR_I8,
}
DTYPE_BY_FORMAT = {
    FORMAT_LINEAR_I16: "int16",
    FORMAT_LINEAR_I8: "int8",
    FORMAT_TEMP_C_PIECEWISE_I8: "int8",
}
LINEAR_FORMATS = {
    FORMAT_LINEAR_I16,
    FORMAT_LINEAR_I8,
}
BYTE_ORDERS_BY_DTYPE = {
    "int16": {"little", "big"},
    "int8": {"none"},
}
REQUIRED_NODATA_BY_FORMAT = {
    FORMAT_TEMP_C_PIECEWISE_I8: -128,
}
PAYLOAD_SUFFIX_BY_DTYPE = {
    "int16": "i16",
    "int8": "i8",
}


def encoding_format_for_spec(*, dtype: str, explicit_format: str | None = None) -> str:
    """Resolve and validate the concrete encoding format for a dtype."""

    if explicit_format is None or explicit_format == "":
        try:
            return FORMAT_BY_DTYPE[dtype]
        except KeyError as exc:
            raise ValueError(f"Unsupported encoding dtype: {dtype!r}") from exc
    if explicit_format not in DTYPE_BY_FORMAT:
        raise ValueError(f"Unsupported encoding format: {explicit_format!r}")
    expected_dtype = DTYPE_BY_FORMAT[explicit_format]
    if dtype != expected_dtype:
        raise ValueError(
            f"Encoding format {explicit_format!r} requires dtype {expected_dtype!r}, got {dtype!r}"
        )
    return explicit_format


def is_linear_encoding_format(encoding_format: str) -> bool:
    """Return whether an encoding format uses scale/offset decoding."""

    return encoding_format in LINEAR_FORMATS


def required_nodata_for_format(encoding_format: str) -> int | None:
    """Return the required nodata sentinel for a format, if fixed."""

    return REQUIRED_NODATA_BY_FORMAT.get(encoding_format)


def encoding_storage_bounds(dtype: str) -> tuple[int, int]:
    """Return inclusive integer storage bounds for an encoding dtype."""

    try:
        return int_storage_bounds(dtype)
    except ValueError as exc:
        raise ValueError(f"Unsupported encoding dtype: {dtype!r}") from exc


def payload_suffix_for_dtype(dtype: str) -> str:
    """Return the artifact filename dtype suffix for a payload dtype."""

    try:
        return PAYLOAD_SUFFIX_BY_DTYPE[dtype]
    except KeyError as exc:
        raise ValueError(f"Unsupported encoding dtype: {dtype!r}") from exc


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
    target_dtype: str,
    target_byte_order: str,
    target_format: str,
    scale: float | None = None,
    offset: float | None = None,
    nodata: int | None = None,
    value_transform: Callable[[float], float] | None = None,
) -> bytes:
    """Encode one extracted float32 product component into payload bytes."""
    try:
        encoding_format = encoding_format_for_spec(dtype=target_dtype, explicit_format=target_format)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    try:
        target_item_bytes = int_item_bytes(target_dtype)
    except ValueError:
        raise SystemExit(f"Unsupported target dtype: {target_dtype!r}")
    target_pack = signed_int_pack_format(dtype=target_dtype, byte_order=target_byte_order)

    if is_linear_encoding_format(encoding_format):
        if scale is None or scale == 0 or not math.isfinite(scale):
            raise SystemExit(f"Invalid encoding scale (must be finite and non-zero): {scale!r}")
        if offset is None or not math.isfinite(offset):
            raise SystemExit(f"Invalid encoding offset (must be finite): {offset!r}")
        linear_scale = scale
        linear_offset = offset
    elif encoding_format == FORMAT_TEMP_C_PIECEWISE_I8:
        if scale is not None:
            raise SystemExit(f"Encoding format {encoding_format!r} does not use scale")
        if offset is not None:
            raise SystemExit(f"Encoding format {encoding_format!r} does not use offset")
        if target_dtype != "int8" or target_byte_order != "none":
            raise SystemExit(f"Encoding format {encoding_format!r} requires int8 byte_order 'none'")
        linear_scale = 1.0
        linear_offset = 0.0
    else:
        raise SystemExit(f"Unsupported encoding format: {encoding_format!r}")

    min_stored, max_stored = encoding_storage_bounds(target_dtype)
    if nodata is not None and (nodata < min_stored or nodata > max_stored):
        raise SystemExit(f"Invalid {target_dtype} nodata sentinel: {nodata!r}")
    required_nodata = required_nodata_for_format(encoding_format)
    if required_nodata is not None and nodata != required_nodata:
        raise SystemExit(f"Invalid nodata sentinel for {encoding_format}: {nodata!r}")
    invalid_stored = nodata if nodata is not None else 0

    transform = value_transform or _identity_value

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
                if nodata is None:
                    raise SystemExit(f"Encoding format {encoding_format!r} requires nodata")
                stored = encode_temp_c_piecewise_i8_value(transformed_value, nodata=nodata)
            else:
                stored = int(round((transformed_value - linear_offset) / linear_scale))
                stored = clamp_int(stored, bounds=(min_stored, max_stored))
                if nodata is not None and stored == nodata:
                    stored = stored + 1 if stored < max_stored else stored - 1

        struct.pack_into(target_pack, out, offset_bytes, stored)
        offset_bytes += target_item_bytes

    return bytes(out)


def _identity_value(value: float) -> float:
    return value
