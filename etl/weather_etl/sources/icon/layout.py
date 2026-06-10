"""DWD ICON source naming and input planning helpers."""

from __future__ import annotations

from typing import Iterable

from ...config.derivations import ICON_AVERAGE_RATE_DERIVATION_TYPES, ICON_WEATHER_CODE_DERIVATION_TYPES
from ...config.pipeline import ArtifactSpec, DatasetConfig
from ...core.cycles import parse_cycle
from ...core.frames import format_lead_hour_frame_id, parse_lead_hour_frame_id
from .params import icon_derivation_input_params, icon_param_from_grib_match


def icon_dwd_filename(*, cycle: str, frame_id: str, icon_param: str) -> str:
    """Return the DWD ICON GRIB2.bz2 filename for one parameter."""

    return f"icon_global_icosahedral_single-level_{cycle}_{frame_id}_{icon_param.upper()}.grib2.bz2"


def icon_dwd_url(*, base_url: str, cycle: str, frame_id: str, icon_param: str) -> str:
    """Return the DWD ICON download URL for one cycle/lead-hour frame/parameter."""

    _, cycle_hour = parse_cycle(cycle)
    filename = icon_dwd_filename(cycle=cycle, frame_id=frame_id, icon_param=icon_param)
    return f"{base_url.rstrip('/')}/{cycle_hour}/{icon_param.lower()}/{filename}"


def required_icon_params(dataset: DatasetConfig, artifact_ids: Iterable[str] | None = None) -> tuple[str, ...]:
    """Return the unique ICON parameters required by the dataset workload."""

    params: set[str] = set()
    for artifact in _selected_icon_artifacts(dataset, artifact_ids):
        for component in artifact.components:
            if component.grib_match is None:
                continue
            params.add(
                icon_param_from_grib_match(
                    artifact_id=artifact.id,
                    selector_id=component.id,
                    grib_match=component.grib_match,
                )
            )
        derivation = artifact.derivation
        if derivation is not None:
            params.update(icon_derivation_input_params(artifact_id=artifact.id, derivation=derivation))
    return tuple(sorted(params))


def required_previous_icon_params(dataset: DatasetConfig, artifact_ids: Iterable[str] | None = None) -> tuple[str, ...]:
    """Return ICON parameters needed from the previous lead-hour frame."""

    params: set[str] = set()
    for artifact in _selected_icon_artifacts(dataset, artifact_ids):
        derivation = artifact.derivation
        if derivation is None:
            continue
        if derivation.type in ICON_AVERAGE_RATE_DERIVATION_TYPES:
            params.update(icon_derivation_input_params(artifact_id=artifact.id, derivation=derivation))
            continue
        if derivation.type in ICON_WEATHER_CODE_DERIVATION_TYPES:
            continue
        raise SystemExit(f"Unsupported ICON derivation for {artifact.id}: {derivation.type!r}")
    return tuple(sorted(params))


def previous_icon_frame_id(frame_id: str) -> str | None:
    """Return the previous ICON frame id, or None for zero-baseline frames."""

    try:
        hour = parse_lead_hour_frame_id(frame_id)
    except ValueError as exc:
        raise SystemExit(f"ICON frame id must be a lead-hour frame: {exc}") from None
    if hour <= 1:
        return None
    return format_lead_hour_frame_id(hour - 1)


def _selected_icon_artifacts(dataset: DatasetConfig, artifact_ids: Iterable[str] | None) -> tuple[ArtifactSpec, ...]:
    selected_ids = tuple(artifact_ids or dataset.workload.artifacts)
    artifacts: list[ArtifactSpec] = []
    for artifact_id in selected_ids:
        artifact = dataset.artifacts.get(artifact_id)
        if artifact is None:
            raise SystemExit(f"Unknown ICON workload artifact: {artifact_id}")
        artifacts.append(artifact)
    return tuple(artifacts)
