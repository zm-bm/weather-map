"""Shared derivation identifiers and source-key helpers."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

DERIVATION_ICON_TOT_PREC_DELTA_RATE = "icon_tot_prec_delta_rate"
DERIVATION_GFS_RUN_TOTAL_PRECIP = "gfs_run_total_precip"
DERIVATION_PRECIP_TYPE_OVERLAY_FROM_GFS = "precip_type_overlay_from_gfs"
DERIVATION_PRECIP_TYPE_OVERLAY_FROM_ICON_COMPONENTS = "precip_type_overlay_from_icon_components"
DERIVATION_THUNDERSTORM_MASK_FROM_ICON_WW = "thunderstorm_mask_from_icon_ww"
GFS_DERIVATION_TYPES = {
    DERIVATION_GFS_RUN_TOTAL_PRECIP,
    DERIVATION_PRECIP_TYPE_OVERLAY_FROM_GFS,
}
ICON_WEATHER_CODE_DERIVATION_TYPES = {
    DERIVATION_THUNDERSTORM_MASK_FROM_ICON_WW,
}
ICON_DERIVATION_TYPES = {
    DERIVATION_ICON_TOT_PREC_DELTA_RATE,
    DERIVATION_PRECIP_TYPE_OVERLAY_FROM_ICON_COMPONENTS,
    *ICON_WEATHER_CODE_DERIVATION_TYPES,
}
ICON_AVERAGE_RATE_DERIVATION_TYPES = {
    DERIVATION_ICON_TOT_PREC_DELTA_RATE,
    DERIVATION_PRECIP_TYPE_OVERLAY_FROM_ICON_COMPONENTS,
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
    artifact_id: str,
    grib_match: Mapping[str, str],
    selector_id: str | None = None,
) -> str:
    """Return the normalized ICON parameter from one GRIB selector."""

    icon_param = grib_match.get(ICON_PARAM_MATCH_KEY, "").strip().lower()
    if not icon_param:
        suffix = f".{selector_id}" if selector_id else ""
        raise SystemExit(f"ICON artifact {artifact_id}{suffix} missing {ICON_PARAM_MATCH_KEY}")
    return icon_param


def icon_derivation_input_params(*, artifact_id: str, derivation: Any) -> tuple[str, ...]:
    """Return normalized ICON parameters used by a derivation's source inputs."""

    return tuple(
        icon_param_from_grib_match(
            artifact_id=artifact_id,
            selector_id=str(getattr(input_item, "id", "")) or None,
            grib_match=getattr(input_item, "grib_match"),
        )
        for input_item in tuple(getattr(derivation, "inputs", ()))
    )
