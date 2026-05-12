"""Shared derivation identifiers and source-key helpers."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

DERIVATION_ICON_TOT_PREC_DELTA_RATE = "icon_tot_prec_delta_rate"
ICON_PARAM_MATCH_KEY = "ICON_PARAM"
ICON_PREVIOUS_PARAM_SUFFIX = "@previous"


def previous_icon_param_key(icon_param: str) -> str:
    """Return the prepared-source key for a previous-hour ICON parameter."""

    return f"{icon_param.strip().lower()}{ICON_PREVIOUS_PARAM_SUFFIX}"


def icon_param_from_grib_match(
    *,
    product_id: str,
    grib_match: Mapping[str, str],
    component_id: str | None = None,
) -> str:
    """Return the normalized ICON parameter from one component selector."""

    icon_param = grib_match.get(ICON_PARAM_MATCH_KEY, "").strip().lower()
    if not icon_param:
        suffix = f".{component_id}" if component_id else ""
        raise SystemExit(f"ICON product {product_id}{suffix} missing {ICON_PARAM_MATCH_KEY}")
    return icon_param


def single_component_icon_param(*, product_id: str, components: Sequence[Any]) -> str:
    """Return the ICON parameter for a single-input derived product."""

    if len(components) != 1:
        raise SystemExit(f"ICON derived product {product_id} requires exactly one component")
    component = components[0]
    return icon_param_from_grib_match(
        product_id=product_id,
        component_id=str(getattr(component, "id", "")) or None,
        grib_match=getattr(component, "grib_match"),
    )
