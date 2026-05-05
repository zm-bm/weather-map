"""Success marker parsing for product artifacts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from ..stores.base import UriStore
from .json import read_json


@dataclass(frozen=True)
class ProductMarkerPayload:
    payload_uri: str
    byte_length: int
    sha256: str
    format: str
    encoding_id: str
    units: str
    parameter: str
    level: str
    valid_min: float
    valid_max: float
    grid_id: str
    grid: dict[str, Any]
    components: tuple[str, ...]
    style: dict[str, str]


@dataclass(frozen=True)
class ProductSuccessMarker:
    uri: str
    product: ProductMarkerPayload
    cycle: str | None = None
    fhour: str | None = None
    product_id: str | None = None


def read_product_success_marker(*, store: UriStore, uri: str) -> ProductSuccessMarker:
    return parse_product_success_marker(read_json(store=store, uri=uri), uri=uri)


def parse_product_success_marker(raw: Mapping[str, Any], *, uri: str) -> ProductSuccessMarker:
    if not isinstance(raw, Mapping):
        raise SystemExit(f"Success marker must be an object: {uri}")

    product = raw.get("product")
    if not isinstance(product, Mapping):
        raise SystemExit(f"Success marker missing product payload metadata: {uri}")

    return ProductSuccessMarker(
        uri=uri,
        cycle=_optional_str(raw.get("cycle"), field=f"{uri}.cycle"),
        fhour=_optional_str(raw.get("fhour"), field=f"{uri}.fhour"),
        product_id=_optional_str(raw.get("product_id"), field=f"{uri}.product_id"),
        product=_parse_product_marker_payload(product, uri=uri),
    )


def _parse_product_marker_payload(raw: Mapping[str, Any], *, uri: str) -> ProductMarkerPayload:
    return ProductMarkerPayload(
        payload_uri=_as_str(raw.get("payload_uri"), field=f"{uri}.product.payload_uri"),
        byte_length=_as_int(raw.get("byte_length"), field=f"{uri}.product.byte_length"),
        sha256=_as_str(raw.get("sha256"), field=f"{uri}.product.sha256"),
        format=_as_str(raw.get("format"), field=f"{uri}.product.format"),
        encoding_id=_as_str(raw.get("encoding_id"), field=f"{uri}.product.encoding_id"),
        units=_as_str(raw.get("units"), field=f"{uri}.product.units"),
        parameter=_as_str(raw.get("parameter"), field=f"{uri}.product.parameter"),
        level=_as_str(raw.get("level"), field=f"{uri}.product.level"),
        valid_min=_as_float(raw.get("valid_min"), field=f"{uri}.product.valid_min"),
        valid_max=_as_float(raw.get("valid_max"), field=f"{uri}.product.valid_max"),
        grid_id=_as_str(raw.get("grid_id"), field=f"{uri}.product.grid_id"),
        grid=_normalize_grid(raw.get("grid"), field=f"{uri}.product.grid"),
        components=tuple(_as_str_list(raw.get("components"), field=f"{uri}.product.components")),
        style=_normalize_style(raw.get("style"), field=f"{uri}.product.style"),
    )


def _normalize_style(raw: Any, *, field: str) -> dict[str, str]:
    if not isinstance(raw, Mapping):
        raise SystemExit(f"{field} must be an object, got: {raw!r}")
    return {
        "layer_id": _as_str(raw.get("layer_id"), field=f"{field}.layer_id"),
        "palette_id": _as_str(raw.get("palette_id"), field=f"{field}.palette_id"),
    }


def _normalize_grid(raw: Any, *, field: str) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise SystemExit(f"{field} must be an object, got: {raw!r}")

    return {
        "crs": _as_str(raw.get("crs"), field=f"{field}.crs"),
        "nx": _as_int(raw.get("nx"), field=f"{field}.nx"),
        "ny": _as_int(raw.get("ny"), field=f"{field}.ny"),
        "lon0": _as_float(raw.get("lon0"), field=f"{field}.lon0"),
        "lat0": _as_float(raw.get("lat0"), field=f"{field}.lat0"),
        "dx": _as_float(raw.get("dx"), field=f"{field}.dx"),
        "dy": _as_float(raw.get("dy"), field=f"{field}.dy"),
        "origin": _as_str(raw.get("origin"), field=f"{field}.origin"),
        "layout": _as_str(raw.get("layout"), field=f"{field}.layout"),
        "x_wrap": _as_str(raw.get("x_wrap"), field=f"{field}.x_wrap"),
        "y_mode": _as_str(raw.get("y_mode"), field=f"{field}.y_mode"),
    }


def _optional_str(raw: Any, *, field: str) -> str | None:
    if raw is None:
        return None
    return _as_str(raw, field=field)


def _as_str(raw: Any, *, field: str) -> str:
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    raise SystemExit(f"Invalid or missing string field {field!r}: {raw!r}")


def _as_int(raw: Any, *, field: str) -> int:
    if isinstance(raw, int):
        return int(raw)
    raise SystemExit(f"Invalid or missing integer field {field!r}: {raw!r}")


def _as_float(raw: Any, *, field: str) -> float:
    if isinstance(raw, (int, float)):
        return float(raw)
    raise SystemExit(f"Invalid or missing numeric field {field!r}: {raw!r}")


def _as_str_list(raw: Any, *, field: str) -> list[str]:
    if not isinstance(raw, list) or not raw:
        raise SystemExit(f"Invalid or missing string list field {field!r}: {raw!r}")
    return [_as_str(value, field=f"{field}[{idx}]") for idx, value in enumerate(raw)]
