"""Product encoding and success-marker metadata helpers."""

from __future__ import annotations

import hashlib
from typing import Any

from ..config.schema import ProductSpec, ScalarEncodingSpec, VectorEncodingSpec
from ..encoding.scalar import (
    SCALAR_DECODE_FORMULA,
    SCALAR_FORMAT_I8_LINEAR_COMPONENTS,
    is_linear_scalar_format,
)
from ..encoding.wind import WIND_DECODE_FORMULA
from .model import EncodedComponent


def component_item_bytes(dtype: str) -> int:
    if dtype == "int8":
        return 1
    if dtype == "int16":
        return 2
    raise SystemExit(f"Unsupported product dtype: {dtype!r}")


def encoding_entry_for_product(product: ProductSpec) -> tuple[str, dict[str, Any]]:
    metadata = encoding_marker_metadata_for_product(product)
    encoding_id = str(metadata.pop("encoding_id"))
    return encoding_id, metadata


def encoding_marker_metadata_for_product(product: ProductSpec) -> dict[str, Any]:
    encoding = product.encoding
    if isinstance(encoding, ScalarEncodingSpec):
        metadata: dict[str, Any] = {
            "format": encoding.format,
            "dtype": encoding.dtype,
            "byte_order": encoding.byte_order,
            "encoding_id": encoding.id,
            "nodata": encoding.nodata,
        }
        if is_linear_scalar_format(encoding.format):
            metadata["scale"] = encoding.scale
            metadata["offset"] = encoding.offset
            metadata["decode_formula"] = SCALAR_DECODE_FORMULA
        if encoding.format == SCALAR_FORMAT_I8_LINEAR_COMPONENTS:
            metadata["components"] = list(product.component_ids)
            metadata["component_count"] = len(product.components)
            metadata["component_order"] = encoding.component_order
        return metadata

    if isinstance(encoding, VectorEncodingSpec):
        return {
            "format": encoding.format,
            "dtype": encoding.dtype,
            "byte_order": encoding.byte_order,
            "encoding_id": encoding.id,
            "scale": encoding.scale,
            "offset": encoding.offset,
            "decode_formula": WIND_DECODE_FORMULA,
            "components": list(product.component_ids),
            "component_count": len(product.components),
            "component_order": encoding.component_order,
        }

    raise SystemExit(f"Unsupported product encoding for {product.id!r}")


def build_product_marker_metadata(
    *,
    product: ProductSpec,
    payload_uri: str,
    payload: bytes,
    encoded_components: list[EncodedComponent],
    grid_id: str,
    grid: dict[str, Any],
) -> dict[str, Any]:
    component_grib_matches = {
        component.component_id: component.grib_match
        for component in encoded_components
    }
    component_band_indices = {
        component.component_id: component.band_index
        for component in encoded_components
    }
    component_band_metadata = {
        component.component_id: component.band_metadata
        for component in encoded_components
    }
    component_source_byte_orders = {
        component.component_id: component.source_byte_order
        for component in encoded_components
    }

    return {
        "kind": product.kind,
        "payload_uri": payload_uri,
        "byte_length": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        **encoding_marker_metadata_for_product(product),
        "units": product.units,
        "parameter": product.parameter,
        "level": product.level,
        "valid_min": product.valid_min,
        "valid_max": product.valid_max,
        "source_transform": product.source_transform,
        "component_grib_matches": component_grib_matches,
        "component_band_indices": component_band_indices,
        "component_band_metadata": component_band_metadata,
        "component_source_byte_orders": component_source_byte_orders,
        "grid_id": grid_id,
        "grid": grid,
    }
