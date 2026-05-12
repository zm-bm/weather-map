"""Encoding config parsing and validation."""

from __future__ import annotations

from typing import Any

from ..encoding.codecs import (
    BYTE_ORDERS_BY_DTYPE,
    encoding_format_for_spec,
    encoding_storage_bounds,
    is_linear_encoding_format,
    required_nodata_for_format,
)
from ._types import parse_config_model
from .input import EncodingInput
from .resolved import EncodingSpec


def parse_encoding(
    *,
    product_id: str,
    layer_id: str,
    raw_encoding: Any,
    component_ids: tuple[str, ...],
) -> EncodingSpec:
    """Parse and normalize a product encoding contract from config."""

    raw = parse_config_model(EncodingInput, raw_encoding)
    dtype = raw.dtype
    if dtype not in BYTE_ORDERS_BY_DTYPE:
        raise SystemExit(
            f"Product {product_id!r} encoding.dtype must be one of "
            f"{sorted(BYTE_ORDERS_BY_DTYPE)!r}, got: {dtype!r}"
        )

    try:
        encoding_format = encoding_format_for_spec(dtype=dtype, explicit_format=raw.format)
    except ValueError as exc:
        raise SystemExit(f"Product {product_id!r} has invalid encoding.format: {exc}") from exc

    byte_order = raw.byte_order
    allowed_byte_orders = BYTE_ORDERS_BY_DTYPE[dtype]
    if byte_order not in allowed_byte_orders:
        raise SystemExit(
            f"Product {product_id!r} encoding.byte_order must be one of "
            f"{sorted(allowed_byte_orders)!r}, got: {byte_order!r}"
        )

    scale: float | None = None
    offset: float | None = None
    if is_linear_encoding_format(encoding_format):
        if raw.scale is None:
            raise SystemExit(f"Product {product_id!r} encoding missing required field 'scale'")
        if raw.offset is None:
            raise SystemExit(f"Product {product_id!r} encoding missing required field 'offset'")
        scale = raw.scale
        if scale == 0:
            raise SystemExit(f"Product {product_id!r} encoding.scale must be a finite non-zero number")
        offset = raw.offset
    else:
        unexpected_linear_fields = sorted(
            field
            for field, value in (("scale", raw.scale), ("offset", raw.offset))
            if value is not None
        )
        if unexpected_linear_fields:
            raise SystemExit(
                f"Product {product_id!r} encoding fields are not supported for "
                f"format {encoding_format!r}: {unexpected_linear_fields!r}"
            )

    nodata = raw.nodata
    if nodata is not None:
        min_stored, max_stored = encoding_storage_bounds(dtype)
        if nodata < min_stored or nodata > max_stored:
            raise SystemExit(
                f"Product {product_id!r} encoding.nodata must be a {dtype} integer "
                f"({min_stored}..{max_stored})"
            )

    required_nodata = required_nodata_for_format(encoding_format)
    if required_nodata is not None and nodata != required_nodata:
        raise SystemExit(
            f"Product {product_id!r} encoding.nodata must be {required_nodata} "
            f"for format {encoding_format!r}"
        )

    encoding = EncodingSpec(
        id=raw.id,
        format=encoding_format,
        dtype=dtype,
        byte_order=byte_order,
        scale=scale,
        offset=offset,
        nodata=nodata,
    )
    return encoding
