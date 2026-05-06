"""Pydantic success marker contract."""

from __future__ import annotations

from typing import Any, Mapping

from pydantic import field_validator

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


class _MarkerStyle(FrozenModel):
    layer_id: NonEmptyStr
    palette_id: NonEmptyStr


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
    """Strict success-marker product payload used by manifest publishing."""

    payload_uri: NonEmptyStr
    byte_length: PositiveInt
    sha256: HexSha256
    format: NonEmptyStr
    encoding_id: NonEmptyStr
    units: NonEmptyStr
    parameter: NonEmptyStr
    level: NonEmptyStr
    valid_min: FiniteNumber
    valid_max: FiniteNumber
    grid_id: NonEmptyStr
    grid: dict[str, Any]
    components: UniqueNonEmptyStringTuple
    style: dict[str, str]

    @field_validator("style")
    @classmethod
    def _validate_style(cls, value: dict[str, str]) -> dict[str, str]:
        return validator_dict(_MarkerStyle, value)

    @field_validator("grid")
    @classmethod
    def _validate_grid(cls, value: dict[str, Any]) -> dict[str, Any]:
        return validator_dict(_MarkerGrid, value)


class ProductSuccessMarker(FrozenModel):
    """Success marker for one product, forecast cycle, and forecast hour."""

    uri: NonEmptyStr
    product: ProductMarkerPayload
    cycle: NonEmptyStr
    fhour: NonEmptyStr
    product_id: NonEmptyStr


def parse_product_success_marker_model(raw: Mapping[str, Any], *, uri: str) -> ProductSuccessMarker:
    """Validate success marker JSON and attach its storage URI."""

    if not isinstance(raw, Mapping):
        return parse_model(ProductSuccessMarker, raw)
    if "uri" in raw:
        raise SystemExit(f"Success marker contains unexpected field 'uri': {uri}")
    return parse_model(ProductSuccessMarker, {"uri": uri, **dict(raw)})


def product_marker_payload_dict(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and dump marker product metadata before writing JSON."""

    return validated_dict(ProductMarkerPayload, raw)
