"""ICON GRIB selector and prepared-source key helpers."""

from __future__ import annotations

from collections.abc import Mapping

from ...config.pipeline import ArtifactDerivationSpec

ICON_PARAM_SELECTOR_KEY = "ICON_PARAM"
ICON_PREVIOUS_PARAM_SUFFIX = "@previous"


def previous_icon_prepared_source_key(icon_param: str) -> str:
    """Return the prepared-source key for a previous-hour ICON parameter."""

    normalized = icon_param.strip().lower()
    if not normalized:
        raise SystemExit("ICON previous parameter key requires a non-empty parameter")
    return f"{normalized}{ICON_PREVIOUS_PARAM_SUFFIX}"


def icon_param_from_grib_match(
    *,
    artifact_id: str,
    grib_match: Mapping[str, str],
    selector_id: str | None = None,
) -> str:
    """Return the normalized ICON parameter from one GRIB selector."""

    raw_icon_param = grib_match.get(ICON_PARAM_SELECTOR_KEY)
    icon_param = raw_icon_param.strip().lower() if isinstance(raw_icon_param, str) else ""
    if not icon_param:
        suffix = f".{selector_id}" if selector_id else ""
        raise SystemExit(f"ICON artifact {artifact_id}{suffix} missing {ICON_PARAM_SELECTOR_KEY}")
    return icon_param


def icon_derivation_input_params(*, artifact_id: str, derivation: ArtifactDerivationSpec) -> tuple[str, ...]:
    """Return normalized ICON parameters used by a derivation's source inputs."""

    return tuple(
        icon_param_from_grib_match(
            artifact_id=artifact_id,
            selector_id=input_item.id,
            grib_match=input_item.grib_match,
        )
        for input_item in derivation.inputs
    )
