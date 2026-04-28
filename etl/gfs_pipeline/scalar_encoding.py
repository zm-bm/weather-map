"""Scalar payload encoding contract helpers."""

from __future__ import annotations

SCALAR_LINEAR_DECODE_FORMULA = "value = stored * scale + offset"
SCALAR_DECODE_FORMULA = SCALAR_LINEAR_DECODE_FORMULA
SCALAR_FORMAT_I16_LINEAR = "scalar-i16-linear-v1"
SCALAR_FORMAT_I8_LINEAR = "scalar-i8-linear-v1"
SCALAR_FORMAT_I8_TEMP_C_PIECEWISE = "scalar-i8-temp-c-piecewise-v1"
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
    SCALAR_FORMAT_I8_TEMP_C_PIECEWISE: "int8",
}
SCALAR_LINEAR_FORMATS = {
    SCALAR_FORMAT_I16_LINEAR,
    SCALAR_FORMAT_I8_LINEAR,
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
    SCALAR_FORMAT_I8_TEMP_C_PIECEWISE: -128,
}
SCALAR_PAYLOAD_SUFFIX_BY_DTYPE = {
    "int16": "i16",
    "int8": "i8",
}


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
