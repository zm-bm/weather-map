"""Product encoding and success-marker metadata helpers."""

from __future__ import annotations

import hashlib
from typing import Any

from ..config.schema import ProductSpec
from ..encoding.codecs import LINEAR_DECODE_FORMULA, is_linear_encoding_format
from .model import EncodedComponent


def encoding_marker_metadata_for_product(product: ProductSpec) -> dict[str, Any]:
    encoding = product.encoding
    metadata: dict[str, Any] = {
        "format": encoding.format,
        "dtype": encoding.dtype,
        "byte_order": encoding.byte_order,
        "encoding_id": encoding.id,
    }
    if encoding.nodata is not None:
        metadata["nodata"] = encoding.nodata
    if is_linear_encoding_format(encoding.format):
        metadata["scale"] = encoding.scale
        metadata["offset"] = encoding.offset
        metadata["decode_formula"] = LINEAR_DECODE_FORMULA
    return metadata


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
        "payload_uri": payload_uri,
        "byte_length": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        **encoding_marker_metadata_for_product(product),
        "components": list(product.component_ids),
        "style": {
            "layer_id": product.style.layer_id,
            "palette_id": product.style.palette_id,
        },
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
