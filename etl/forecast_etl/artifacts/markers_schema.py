"""Pydantic success marker contract."""

from __future__ import annotations

import hashlib
from typing import Any, Mapping

from pydantic import ConfigDict, field_validator

from ..config.resolved import ProductSpec
from ..validation import (
    FiniteNumber,
    FrozenModel,
    HexSha256,
    NonEmptyStr,
    PositiveInt,
    UniqueNonEmptyStringTuple,
    parse_model,
    validated_dict,
    validator_dict,
)


class _MarkerGrid(FrozenModel):
    crs: NonEmptyStr
    nx: PositiveInt
    ny: PositiveInt
    lon0: FiniteNumber
    lat0: FiniteNumber
    dx: FiniteNumber
    dy: FiniteNumber
    origin: NonEmptyStr
    layout: NonEmptyStr
    x_wrap: NonEmptyStr
    y_mode: NonEmptyStr


class ProductMarkerPayload(FrozenModel):
    """Artifact success-marker payload used by manifest publishing."""

    model_config = ConfigDict(
        extra="ignore",
        frozen=True,
        str_strip_whitespace=True,
    )

    payload_uri: NonEmptyStr
    byte_length: PositiveInt
    sha256: HexSha256
    format: NonEmptyStr
    encoding_id: NonEmptyStr
    units: NonEmptyStr
    parameter: NonEmptyStr
    level: NonEmptyStr
    grid_id: NonEmptyStr
    grid: dict[str, Any]
    components: UniqueNonEmptyStringTuple

    @field_validator("grid")
    @classmethod
    def _validate_grid(cls, value: dict[str, Any]) -> dict[str, Any]:
        return validator_dict(_MarkerGrid, value)


class StoredProductSuccessMarker(FrozenModel):
    """Success marker JSON persisted for one product, cycle, and forecast hour."""

    product: ProductMarkerPayload
    cycle: NonEmptyStr
    fhour: NonEmptyStr
    product_id: NonEmptyStr


class ProductSuccessMarker(StoredProductSuccessMarker):
    """Success marker read from storage, including its storage URI."""

    uri: NonEmptyStr


def parse_product_success_marker_model(raw: Mapping[str, Any], *, uri: str) -> ProductSuccessMarker:
    """Validate success marker JSON and attach its storage URI."""

    if not isinstance(raw, Mapping):
        return parse_model(ProductSuccessMarker, raw)
    if "uri" in raw:
        raise SystemExit(f"Success marker contains unexpected field 'uri': {uri}")
    return parse_model(ProductSuccessMarker, {"uri": uri, **dict(raw)})


def parse_product_success_marker(raw: Mapping[str, Any], *, uri: str) -> ProductSuccessMarker:
    """Validate a raw success marker object from the given marker URI."""

    return parse_product_success_marker_model(raw, uri=uri)


def product_success_marker_dict(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and dump success marker JSON before writing it."""

    return validated_dict(StoredProductSuccessMarker, raw)


def build_product_marker_payload(
    *,
    product: ProductSpec,
    payload_uri: str,
    payload: bytes,
    grid_id: str,
    grid: dict[str, Any],
) -> dict[str, Any]:
    """Build and validate marker metadata for one product payload."""

    return validated_dict(ProductMarkerPayload, {
        "payload_uri": payload_uri,
        "byte_length": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "format": product.encoding.format,
        "encoding_id": product.encoding.id,
        "units": product.units,
        "parameter": product.parameter,
        "level": product.level,
        "components": product.component_ids,
        "grid_id": grid_id,
        "grid": grid,
    })
