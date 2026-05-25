"""Encoding config parsing and validation."""

from __future__ import annotations

import math
from typing import Any

from ..encoding.codecs import (
    BYTE_ORDERS_BY_DTYPE,
    encoding_format_for_spec,
    encoding_storage_bounds,
    is_linear_encoding_format,
    required_nodata_for_format,
)
from ._types import parse_config_model
from .input import EncodingInput, FiniteValueRangeInput
from .resolved import EncodingSpec, FiniteValueRangeSpec


def parse_encoding(
    *,
    artifact_id: str,
    raw_encoding: Any,
) -> EncodingSpec:
    """Parse and normalize an artifact encoding contract from config."""

    raw = parse_config_model(EncodingInput, raw_encoding)
    dtype = raw.dtype
    if dtype not in BYTE_ORDERS_BY_DTYPE:
        raise SystemExit(
            f"Artifact {artifact_id!r} encoding.dtype must be one of "
            f"{sorted(BYTE_ORDERS_BY_DTYPE)!r}, got: {dtype!r}"
        )

    try:
        encoding_format = encoding_format_for_spec(dtype=dtype, explicit_format=raw.format)
    except ValueError as exc:
        raise SystemExit(f"Artifact {artifact_id!r} has invalid encoding.format: {exc}") from exc

    byte_order = raw.byte_order
    allowed_byte_orders = BYTE_ORDERS_BY_DTYPE[dtype]
    if byte_order not in allowed_byte_orders:
        raise SystemExit(
            f"Artifact {artifact_id!r} encoding.byte_order must be one of "
            f"{sorted(allowed_byte_orders)!r}, got: {byte_order!r}"
        )

    scale: float | None = None
    offset: float | None = None
    if is_linear_encoding_format(encoding_format):
        if raw.scale is None:
            raise SystemExit(f"Artifact {artifact_id!r} encoding missing required field 'scale'")
        if raw.offset is None:
            raise SystemExit(f"Artifact {artifact_id!r} encoding missing required field 'offset'")
        scale = raw.scale
        if scale == 0:
            raise SystemExit(f"Artifact {artifact_id!r} encoding.scale must be a finite non-zero number")
        offset = raw.offset
    else:
        unexpected_linear_fields = sorted(
            field
            for field, value in (("scale", raw.scale), ("offset", raw.offset))
            if value is not None
        )
        if unexpected_linear_fields:
            raise SystemExit(
                f"Artifact {artifact_id!r} encoding fields are not supported for "
                f"format {encoding_format!r}: {unexpected_linear_fields!r}"
            )

    nodata = raw.nodata
    if nodata is not None:
        min_stored, max_stored = encoding_storage_bounds(dtype)
        if nodata < min_stored or nodata > max_stored:
            raise SystemExit(
                f"Artifact {artifact_id!r} encoding.nodata must be a {dtype} integer "
                f"({min_stored}..{max_stored})"
            )

    required_nodata = required_nodata_for_format(encoding_format)
    if required_nodata is not None and nodata != required_nodata:
        raise SystemExit(
            f"Artifact {artifact_id!r} encoding.nodata must be {required_nodata} "
            f"for format {encoding_format!r}"
        )

    finite_value_range = _parse_finite_value_range(
        artifact_id=artifact_id,
        encoding_format=encoding_format,
        dtype=dtype,
        scale=scale,
        offset=offset,
        nodata=nodata,
        raw_range=raw.finite_value_range,
    )

    encoding = EncodingSpec(
        id=raw.id,
        format=encoding_format,
        dtype=dtype,
        byte_order=byte_order,
        scale=scale,
        offset=offset,
        nodata=nodata,
        finite_value_range=finite_value_range,
    )
    return encoding


def _parse_finite_value_range(
    *,
    artifact_id: str,
    encoding_format: str,
    dtype: str,
    scale: float | None,
    offset: float | None,
    nodata: int | None,
    raw_range: FiniteValueRangeInput | None,
) -> FiniteValueRangeSpec | None:
    if raw_range is None:
        return None

    if not is_linear_encoding_format(encoding_format):
        raise SystemExit(
            f"Artifact {artifact_id!r} encoding.finite_value_range is not supported "
            f"for format {encoding_format!r}"
        )
    if scale is None or offset is None:
        raise SystemExit(f"Artifact {artifact_id!r} encoding.finite_value_range requires scale and offset")

    min_stored, max_stored = encoding_storage_bounds(dtype)
    for label, value in (("min", raw_range.min), ("max", raw_range.max)):
        stored = round((value - offset) / scale)
        if stored < min_stored or stored > max_stored:
            raise SystemExit(
                f"Artifact {artifact_id!r} encoding.finite_value_range.{label} "
                f"does not fit {dtype} storage"
            )
        decoded = stored * scale + offset
        if not math.isclose(decoded, value, rel_tol=1e-12, abs_tol=abs(scale) * 1e-9):
            raise SystemExit(
                f"Artifact {artifact_id!r} encoding.finite_value_range.{label} "
                "must be exactly representable by scale and offset"
            )
        if nodata is not None and stored == nodata:
            raise SystemExit(
                f"Artifact {artifact_id!r} encoding.finite_value_range.{label} "
                "quantizes to the nodata sentinel"
            )

    return FiniteValueRangeSpec(min=raw_range.min, max=raw_range.max)
