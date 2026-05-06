"""Product encoding and success-marker metadata helpers."""

from __future__ import annotations

import hashlib
from typing import Any

from ..artifacts.markers import product_marker_payload_dict
from ..config.schema import ProductSpec
from ..encoding.codecs import LINEAR_DECODE_FORMULA, is_linear_encoding_format


def encoding_marker_metadata_for_product(product: ProductSpec) -> dict[str, Any]:
    """Build manifest encoding metadata from a resolved product config."""

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
    grid_id: str,
    grid: dict[str, Any],
) -> dict[str, Any]:
    """Build and validate the slim success-marker product payload."""

    return product_marker_payload_dict({
        "payload_uri": payload_uri,
        "byte_length": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "format": product.encoding.format,
        "encoding_id": product.encoding.id,
        "units": product.units,
        "parameter": product.parameter,
        "level": product.level,
        "valid_min": product.valid_min,
        "valid_max": product.valid_max,
        "components": product.component_ids,
        "style": {
            "layer_id": product.style.layer_id,
            "palette_id": product.style.palette_id,
        },
        "grid_id": grid_id,
        "grid": grid,
    })
