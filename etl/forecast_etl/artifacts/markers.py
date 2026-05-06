"""Success marker parsing for product artifacts."""

from __future__ import annotations

from typing import Any, Mapping

from ..stores.base import UriStore
from ._marker_schema import (
    ProductMarkerPayload,
    ProductSuccessMarker,
    parse_product_success_marker_model,
    product_marker_payload_dict,
)
from .json import read_json

__all__ = [
    "ProductMarkerPayload",
    "ProductSuccessMarker",
    "parse_product_success_marker",
    "product_marker_payload_dict",
    "read_product_success_marker",
]


def read_product_success_marker(*, store: UriStore, uri: str) -> ProductSuccessMarker:
    """Read and validate one product success marker from storage."""

    return parse_product_success_marker(read_json(store=store, uri=uri), uri=uri)


def parse_product_success_marker(raw: Mapping[str, Any], *, uri: str) -> ProductSuccessMarker:
    """Validate a raw success marker object from the given marker URI."""

    return parse_product_success_marker_model(raw, uri=uri)
