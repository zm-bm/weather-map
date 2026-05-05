"""Encoding config parsing and validation."""

from __future__ import annotations

from typing import Any, Mapping

from ..encoding.codecs import (
    BYTE_ORDERS_BY_DTYPE,
    FORMAT_LINEAR_I8,
    FORMAT_TEMP_C_PIECEWISE_I8,
    encoding_format_for_spec,
    encoding_storage_bounds,
    is_linear_encoding_format,
    required_nodata_for_format,
)
from .primitives import parse_finite_float
from .schema import EncodingSpec

CLOUD_LAYER_COMPONENTS = ("low", "medium", "high")
VECTOR_COMPONENTS = ("u", "v")
VECTOR_DTYPE = "int8"
VECTOR_BYTE_ORDER = "none"
VECTOR_SCALE = 0.5
VECTOR_OFFSET = 0.0


def parse_encoding(
    *,
    product_id: str,
    layer_id: str,
    raw_encoding: Any,
    component_ids: tuple[str, ...],
) -> EncodingSpec:
    if not isinstance(raw_encoding, Mapping):
        raise SystemExit(f"Product {product_id!r} missing required object field 'encoding'")

    for field in ("id", "format", "byte_order", "dtype"):
        if field not in raw_encoding:
            raise SystemExit(f"Product {product_id!r} encoding missing required field {field!r}")

    encoding_id = _encoding_id(raw_encoding, product_id=product_id)
    dtype = raw_encoding.get("dtype")
    if dtype not in BYTE_ORDERS_BY_DTYPE:
        raise SystemExit(
            f"Product {product_id!r} encoding.dtype must be one of "
            f"{sorted(BYTE_ORDERS_BY_DTYPE)!r}, got: {dtype!r}"
        )

    format_raw = raw_encoding.get("format")
    if not isinstance(format_raw, str):
        raise SystemExit(f"Product {product_id!r} encoding.format must be a string")
    try:
        encoding_format = encoding_format_for_spec(dtype=str(dtype), explicit_format=format_raw)
    except ValueError as exc:
        raise SystemExit(f"Product {product_id!r} has invalid encoding.format: {exc}") from exc

    byte_order = raw_encoding.get("byte_order")
    allowed_byte_orders = BYTE_ORDERS_BY_DTYPE[str(dtype)]
    if byte_order not in allowed_byte_orders:
        raise SystemExit(
            f"Product {product_id!r} encoding.byte_order must be one of "
            f"{sorted(allowed_byte_orders)!r}, got: {byte_order!r}"
        )

    scale: float | None = None
    offset: float | None = None
    if is_linear_encoding_format(encoding_format):
        if "scale" not in raw_encoding:
            raise SystemExit(f"Product {product_id!r} encoding missing required field 'scale'")
        if "offset" not in raw_encoding:
            raise SystemExit(f"Product {product_id!r} encoding missing required field 'offset'")
        scale = parse_finite_float(raw_encoding.get("scale"), field_name=f"{product_id}.encoding.scale")
        if scale == 0:
            raise SystemExit(f"Product {product_id!r} encoding.scale must be a finite non-zero number")
        offset = parse_finite_float(raw_encoding.get("offset"), field_name=f"{product_id}.encoding.offset")
    else:
        unexpected_linear_fields = sorted(field for field in ("scale", "offset") if field in raw_encoding)
        if unexpected_linear_fields:
            raise SystemExit(
                f"Product {product_id!r} encoding fields are not supported for "
                f"format {encoding_format!r}: {unexpected_linear_fields!r}"
            )

    nodata: int | None = None
    if "nodata" in raw_encoding:
        nodata_raw = raw_encoding.get("nodata")
        min_stored, max_stored = encoding_storage_bounds(str(dtype))
        if not isinstance(nodata_raw, int) or nodata_raw < min_stored or nodata_raw > max_stored:
            raise SystemExit(
                f"Product {product_id!r} encoding.nodata must be a {dtype} integer "
                f"({min_stored}..{max_stored})"
            )
        nodata = int(nodata_raw)
    elif layer_id == "scalar":
        raise SystemExit(f"Product {product_id!r} scalar layer encoding missing required field 'nodata'")

    required_nodata = required_nodata_for_format(encoding_format)
    if required_nodata is not None and nodata != required_nodata:
        raise SystemExit(
            f"Product {product_id!r} encoding.nodata must be {required_nodata} "
            f"for format {encoding_format!r}"
        )

    _validate_component_encoding_contract(
        product_id=product_id,
        encoding_format=encoding_format,
        dtype=str(dtype),
        byte_order=str(byte_order),
        scale=scale,
        offset=offset,
        nodata=nodata,
        component_ids=component_ids,
        raw_encoding=raw_encoding,
    )

    return EncodingSpec(
        id=encoding_id,
        format=encoding_format,
        dtype=str(dtype),
        byte_order=str(byte_order),
        scale=scale,
        offset=offset,
        nodata=nodata,
    )


def _validate_component_encoding_contract(
    *,
    product_id: str,
    encoding_format: str,
    dtype: str,
    byte_order: str,
    scale: float | None,
    offset: float | None,
    nodata: int | None,
    component_ids: tuple[str, ...],
    raw_encoding: Mapping[str, Any],
) -> None:
    unexpected_component_fields = sorted(
        field for field in ("components", "component_count", "component_order") if field in raw_encoding
    )
    if unexpected_component_fields:
        raise SystemExit(
            f"Product {product_id!r} component metadata belongs in product components, "
            f"not encoding: {unexpected_component_fields!r}"
        )

    if component_ids == VECTOR_COMPONENTS:
        expected = {
            "format": FORMAT_LINEAR_I8,
            "dtype": VECTOR_DTYPE,
            "byte_order": VECTOR_BYTE_ORDER,
            "scale": VECTOR_SCALE,
            "offset": VECTOR_OFFSET,
        }
        actual = {
            "format": encoding_format,
            "dtype": dtype,
            "byte_order": byte_order,
            "scale": scale,
            "offset": offset,
        }
        for field, expected_value in expected.items():
            if actual[field] != expected_value:
                raise SystemExit(
                    f"Product {product_id!r} encoding.{field} must be {expected_value!r}, "
                    f"got {actual[field]!r}"
                )
        if nodata is not None:
            raise SystemExit(f"Product {product_id!r} u/v vector encoding must not define nodata")
        return

    if component_ids == CLOUD_LAYER_COMPONENTS:
        expected = {
            "format": FORMAT_LINEAR_I8,
            "dtype": "int8",
            "byte_order": "none",
            "scale": 5.0,
            "offset": 0.0,
            "nodata": -128,
        }
        actual = {
            "format": encoding_format,
            "dtype": dtype,
            "byte_order": byte_order,
            "scale": scale,
            "offset": offset,
            "nodata": nodata,
        }
        for field, expected_value in expected.items():
            if actual[field] != expected_value:
                raise SystemExit(
                    f"Product {product_id!r} encoding.{field} must be {expected_value!r} "
                    f"for cloud layer components, got {actual[field]!r}"
                )
        return

    if len(component_ids) != 1:
        raise SystemExit(
            f"Product {product_id!r} products with multiple components must use "
            f"{list(CLOUD_LAYER_COMPONENTS)!r}"
        )

    if encoding_format == FORMAT_TEMP_C_PIECEWISE_I8 and (dtype != "int8" or byte_order != "none"):
        raise SystemExit(
            f"Product {product_id!r} encoding.format {FORMAT_TEMP_C_PIECEWISE_I8!r} "
            "requires dtype 'int8' and byte_order 'none'"
        )


def _encoding_id(raw_encoding: Mapping[str, Any], *, product_id: str) -> str:
    raw = raw_encoding.get("id")
    if raw is None:
        raw = raw_encoding.get("encoding_id")
    if not isinstance(raw, str) or not raw.strip():
        raise SystemExit(f"Product {product_id!r} encoding.id must be a non-empty string")
    return raw.strip()
