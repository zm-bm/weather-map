"""Shared derivation identifiers and source-key helpers."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

DERIVATION_ICON_TOT_PREC_DELTA_RATE = "icon_tot_prec_delta_rate"
DERIVATION_PRECIP_TYPE_FROM_GFS_CATEGORIES = "precip_type_from_gfs_categories"
DERIVATION_PRECIP_TYPE_FROM_ICON_WW = "precip_type_from_icon_ww"
DERIVATION_THUNDERSTORM_MASK_FROM_ICON_WW = "thunderstorm_mask_from_icon_ww"
GFS_DERIVATION_TYPES = {
    DERIVATION_PRECIP_TYPE_FROM_GFS_CATEGORIES,
}
ICON_WEATHER_CODE_DERIVATION_TYPES = {
    DERIVATION_PRECIP_TYPE_FROM_ICON_WW,
    DERIVATION_THUNDERSTORM_MASK_FROM_ICON_WW,
}
ICON_DERIVATION_TYPES = {
    DERIVATION_ICON_TOT_PREC_DELTA_RATE,
    *ICON_WEATHER_CODE_DERIVATION_TYPES,
}
DERIVATION_TYPES = {
    *GFS_DERIVATION_TYPES,
    *ICON_DERIVATION_TYPES,
}
ICON_PARAM_MATCH_KEY = "ICON_PARAM"
ICON_PREVIOUS_PARAM_SUFFIX = "@previous"


def previous_icon_param_key(icon_param: str) -> str:
    """Return the prepared-source key for a previous-hour ICON parameter."""

    return f"{icon_param.strip().lower()}{ICON_PREVIOUS_PARAM_SUFFIX}"


def icon_param_from_grib_match(
    *,
    product_id: str,
    grib_match: Mapping[str, str],
    selector_id: str | None = None,
) -> str:
    """Return the normalized ICON parameter from one GRIB selector."""

    icon_param = grib_match.get(ICON_PARAM_MATCH_KEY, "").strip().lower()
    if not icon_param:
        suffix = f".{selector_id}" if selector_id else ""
        raise SystemExit(f"ICON product {product_id}{suffix} missing {ICON_PARAM_MATCH_KEY}")
    return icon_param


def single_icon_derivation_input_param(*, product_id: str, derivation: Any) -> str:
    """Return the ICON parameter for a single-input derivation."""

    inputs = tuple(getattr(derivation, "inputs", ()))
    if len(inputs) != 1:
        raise SystemExit(f"ICON derived product {product_id} requires exactly one derivation input")
    input_item = inputs[0]
    return icon_param_from_grib_match(
        product_id=product_id,
        selector_id=str(getattr(input_item, "id", "")) or None,
        grib_match=getattr(input_item, "grib_match"),
    )
