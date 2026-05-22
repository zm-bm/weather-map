"""Config assembly and cross-object validation helpers."""

from __future__ import annotations

from typing import Any, Mapping

from ..derivations import (
    DERIVATION_GFS_RUN_TOTAL_PRECIP,
    DERIVATION_ICON_TOT_PREC_DELTA_RATE,
    GFS_DERIVATION_TYPES,
    ICON_AVERAGE_RATE_DERIVATION_TYPES,
    ICON_DERIVATION_TYPES,
    ICON_PARAM_MATCH_KEY,
)
from ._types import parse_config_model
from .encoding import parse_encoding
from .input import (
    ArtifactComponentInput,
    ArtifactInput,
    CatalogArtifactInput,
    GfsNomadsSourceInput,
    IconDwdSourceInput,
    ModelArtifactInput,
    ModelSourceInputEnvelope,
    WorkloadInput,
)
from .resolved import (
    ArtifactCatalogSpec,
    ArtifactDerivationSpec,
    ArtifactGridTransformSpec,
    ArtifactSpec,
    ArtifactTemporalSpec,
    ComponentSpec,
    DerivationInputSpec,
    GfsNomadsSourceConfig,
    IconDwdConfig,
    IconDwdSourceConfig,
    ModelArtifactSpec,
    ModelSourceConfig,
    NomadsConfig,
    WorkloadConfig,
)


def parse_workload_config(raw: Any) -> WorkloadConfig:
    """Normalize raw workload ranges into explicit forecast-hour ids."""

    parsed = parse_config_model(WorkloadInput, raw)
    return WorkloadConfig(forecast_hours=parsed.forecast_hours, artifacts=parsed.artifacts)


def parse_model_source_config(raw: Any) -> ModelSourceConfig:
    """Parse source config and attach the active source-specific settings."""

    parsed = parse_config_model(ModelSourceInputEnvelope, {"source": raw}).source
    if isinstance(parsed, GfsNomadsSourceInput):
        return GfsNomadsSourceConfig(
            grid_id=parsed.grid_id,
            nomads=NomadsConfig(
                base_url=parsed.base_url,
                vars_levels=dict(parsed.vars_levels),
                rate_limit_seconds=parsed.rate_limit_seconds,
            ),
        )

    if isinstance(parsed, IconDwdSourceInput):
        return IconDwdSourceConfig(
            grid_id=parsed.grid_id,
            icon_dwd=IconDwdConfig(
                base_url=parsed.base_url.rstrip("/"),
                rate_limit_seconds=parsed.rate_limit_seconds,
            ),
        )

    raise SystemExit(f"Unsupported source config: {raw!r}")


def validate_model_artifacts_for_source(
    *,
    model_id: str,
    source: ModelSourceConfig,
    model_artifacts: Mapping[str, ModelArtifactSpec],
) -> None:
    """Validate model-artifact selectors that depend on the source adapter."""

    for artifact_id, model_artifact in model_artifacts.items():
        derivation = model_artifact.derivation
        if derivation is None:
            for component_id, grib_match in model_artifact.component_grib_matches.items():
                if grib_match is None:
                    raise SystemExit(
                        f"models.{model_id}.artifacts.{artifact_id}.{component_id} "
                        "requires grib_match for direct artifacts"
                    )
            continue

        _validate_derived_output_components(
            model_id=model_id,
            artifact_id=artifact_id,
            component_grib_matches=model_artifact.component_grib_matches,
        )

        if derivation.type in GFS_DERIVATION_TYPES:
            if not isinstance(source, GfsNomadsSourceConfig):
                raise SystemExit(
                    f"models.{model_id}.artifacts.{artifact_id} uses derivation "
                    f"{derivation.type!r}, which is only supported for gfs_nomads sources"
                )
            if not derivation.inputs:
                raise SystemExit(f"GFS derivation {derivation.type!r} requires derivation.inputs for {artifact_id}")
            if derivation.type == DERIVATION_GFS_RUN_TOTAL_PRECIP:
                _validate_gfs_run_total_precip_derivation(
                    artifact_id=artifact_id,
                    model_artifact=model_artifact,
                )
            continue

        if not isinstance(source, IconDwdSourceConfig):
            raise SystemExit(
                f"models.{model_id}.artifacts.{artifact_id} uses derivation "
                f"{model_artifact.derivation.type!r}, which is only supported for icon_dwd_icosahedral sources"
            )
        if derivation.type not in ICON_DERIVATION_TYPES:
            raise SystemExit(f"Unsupported derivation for {artifact_id}: {derivation.type!r}")

    if not isinstance(source, IconDwdSourceConfig):
        return

    for artifact_id, model_artifact in model_artifacts.items():
        derivation = model_artifact.derivation
        if derivation is None:
            _validate_icon_component_selectors(
                model_id=model_id,
                artifact_id=artifact_id,
                component_grib_matches=model_artifact.component_grib_matches,
            )
            continue
        if derivation.type not in ICON_DERIVATION_TYPES:
            raise SystemExit(f"Unsupported ICON derivation for {artifact_id}: {derivation.type!r}")

        _validate_icon_derivation_inputs(
            model_id=model_id,
            artifact_id=artifact_id,
            inputs=derivation.inputs,
        )
        if derivation.type == DERIVATION_ICON_TOT_PREC_DELTA_RATE and len(derivation.inputs) != 1:
            raise SystemExit(
                f"ICON derivation {derivation.type!r} requires exactly one derivation input for {artifact_id}"
            )
        if derivation.type in ICON_AVERAGE_RATE_DERIVATION_TYPES:
            _validate_icon_average_rate_derivation(artifact_id=artifact_id, model_artifact=model_artifact)


def _validate_icon_average_rate_derivation(
    *,
    artifact_id: str,
    model_artifact: ModelArtifactSpec,
) -> None:
    derivation = model_artifact.derivation
    if derivation is None:
        raise SystemExit(f"Artifact {artifact_id} does not declare a derivation")
    if model_artifact.temporal is None:
        raise SystemExit(f"ICON derivation {derivation.type!r} requires temporal metadata for {artifact_id}")
    if model_artifact.temporal.kind != "average_rate":
        raise SystemExit(
            f"ICON derivation {derivation.type!r} requires temporal.kind='average_rate' for {artifact_id}"
        )
    if model_artifact.temporal.source_interval_hours != 1:
        raise SystemExit(
            f"ICON derivation {derivation.type!r} requires source_interval_hours=1 for {artifact_id}"
        )
    if derivation.first_hour_previous != "zero":
        raise SystemExit(
            f"ICON derivation {derivation.type!r} requires first_hour_previous='zero' for {artifact_id}"
        )


def _validate_gfs_run_total_precip_derivation(
    *,
    artifact_id: str,
    model_artifact: ModelArtifactSpec,
) -> None:
    derivation = model_artifact.derivation
    if derivation is None:
        raise SystemExit(f"Artifact {artifact_id} does not declare a derivation")
    if len(derivation.inputs) != 1:
        raise SystemExit(
            f"GFS derivation {derivation.type!r} requires exactly one derivation input for {artifact_id}"
        )
    if model_artifact.temporal is None:
        raise SystemExit(f"GFS derivation {derivation.type!r} requires temporal metadata for {artifact_id}")
    if model_artifact.temporal.kind != "accumulation":
        raise SystemExit(
            f"GFS derivation {derivation.type!r} requires temporal.kind='accumulation' for {artifact_id}"
        )


def parse_artifact_catalog_spec(*, artifact_id: str, raw: Any) -> ArtifactCatalogSpec:
    """Parse one catalog artifact definition."""

    parsed = parse_config_model(CatalogArtifactInput, raw)
    encoding = parse_encoding(
        artifact_id=artifact_id,
        raw_encoding=parsed.encoding,
    )
    return ArtifactCatalogSpec(
        id=artifact_id,
        kind=parsed.kind,
        parameter=parsed.parameter,
        level=parsed.level,
        units=parsed.units,
        source_transform=parsed.source_transform,
        encoding=encoding,
        component_ids=parsed.component_ids,
    )


def parse_artifact_spec(*, artifact_id: str, raw: Any) -> ArtifactSpec:
    """Parse a fully resolved artifact spec from test or fixture input."""

    parsed = parse_config_model(ArtifactInput, raw)
    components = _component_specs(parsed.components)
    encoding = parse_encoding(
        artifact_id=artifact_id,
        raw_encoding=parsed.encoding,
    )
    return ArtifactSpec(
        id=artifact_id,
        kind=parsed.kind,
        parameter=parsed.parameter,
        level=parsed.level,
        units=parsed.units,
        source_transform=parsed.source_transform,
        encoding=encoding,
        components=components,
        temporal=_temporal_spec(parsed.temporal),
        derivation=_derivation_spec(parsed.derivation),
        grid_transform=_grid_transform_spec(parsed.grid_transform),
    )


def parse_model_artifact_spec(
    *,
    artifact_id: str,
    raw: Any,
    catalog_artifact: ArtifactCatalogSpec,
) -> ModelArtifactSpec:
    """Parse one model artifact and verify catalog component order."""

    parsed = parse_config_model(ModelArtifactInput, raw)
    matches = parsed.component_grib_matches

    expected = catalog_artifact.component_ids
    actual = tuple(matches)
    if actual != expected:
        raise SystemExit(
            f"artifacts.{artifact_id}.components must match artifact_catalog order "
            f"{list(expected)!r}, got {list(actual)!r}"
        )

    return ModelArtifactSpec(
        artifact_id=artifact_id,
        component_grib_matches=matches,
        temporal=_temporal_spec(parsed.temporal),
        derivation=_derivation_spec(parsed.derivation),
        grid_transform=_grid_transform_spec(parsed.grid_transform),
    )


def resolve_artifact_spec(
    *,
    catalog_artifact: ArtifactCatalogSpec,
    model_artifact: ModelArtifactSpec,
) -> ArtifactSpec:
    """Merge catalog artifact metadata with model-specific component selectors."""

    components = tuple(
        ComponentSpec(
            id=component_id,
            grib_match=model_artifact.component_grib_matches[component_id],
        )
        for component_id in catalog_artifact.component_ids
    )
    return ArtifactSpec(
        id=catalog_artifact.id,
        kind=catalog_artifact.kind,
        parameter=catalog_artifact.parameter,
        level=catalog_artifact.level,
        units=catalog_artifact.units,
        source_transform=catalog_artifact.source_transform,
        encoding=catalog_artifact.encoding,
        components=components,
        temporal=model_artifact.temporal,
        derivation=model_artifact.derivation,
        grid_transform=model_artifact.grid_transform,
    )


def validate_workload_artifacts(
    *,
    artifact_ids: tuple[str, ...],
    artifacts: Mapping[str, object],
) -> None:
    """Ensure every workload artifact exists in the artifact catalog."""

    for artifact_id in artifact_ids:
        if artifact_id not in artifacts:
            raise SystemExit(f"workload.artifacts references unknown artifact: {artifact_id!r}")


def _component_specs(raw_components: tuple[ArtifactComponentInput, ...]) -> tuple[ComponentSpec, ...]:
    return tuple(
        ComponentSpec(
            id=component.id,
            grib_match=dict(component.grib_match) if component.grib_match is not None else None,
        )
        for component in raw_components
    )


def _temporal_spec(raw: object | None) -> ArtifactTemporalSpec | None:
    if raw is None:
        return None
    return ArtifactTemporalSpec(
        kind=getattr(raw, "kind"),
        source_interval_hours=getattr(raw, "source_interval_hours"),
    )


def _derivation_spec(raw: object | None) -> ArtifactDerivationSpec | None:
    if raw is None:
        return None
    return ArtifactDerivationSpec(
        type=getattr(raw, "type"),
        first_hour_previous=getattr(raw, "first_hour_previous"),
        inputs=tuple(
            DerivationInputSpec(id=input_item.id, grib_match=dict(input_item.grib_match))
            for input_item in getattr(raw, "inputs", ())
        ),
    )


def _grid_transform_spec(raw: object | None) -> ArtifactGridTransformSpec | None:
    if raw is None:
        return None
    return ArtifactGridTransformSpec(
        type=getattr(raw, "type"),
        grid_id=getattr(raw, "grid_id"),
    )


def _validate_icon_component_selectors(
    *,
    model_id: str,
    artifact_id: str,
    component_grib_matches: Mapping[str, Mapping[str, str] | None],
) -> None:
    for component_id, grib_match in component_grib_matches.items():
        if grib_match is None:
            raise SystemExit(
                f"models.{model_id}.artifacts.{artifact_id}.{component_id} "
                f"requires grib_match.{ICON_PARAM_MATCH_KEY} for icon_dwd_icosahedral sources"
            )
        _validate_icon_grib_match(
            model_id=model_id,
            artifact_id=artifact_id,
            selector_id=component_id,
            grib_match=grib_match,
        )


def _validate_derived_output_components(
    *,
    model_id: str,
    artifact_id: str,
    component_grib_matches: Mapping[str, Mapping[str, str] | None],
) -> None:
    for component_id, grib_match in component_grib_matches.items():
        if grib_match is not None:
            raise SystemExit(
                f"models.{model_id}.artifacts.{artifact_id}.{component_id} is a derived output component; "
                "put source selectors in derivation.inputs instead of components"
            )


def _validate_icon_derivation_inputs(
    *,
    model_id: str,
    artifact_id: str,
    inputs: tuple[DerivationInputSpec, ...],
) -> None:
    if not inputs:
        raise SystemExit(f"ICON derivation for {artifact_id} requires derivation.inputs")
    for input_item in inputs:
        _validate_icon_grib_match(
            model_id=model_id,
            artifact_id=artifact_id,
            selector_id=f"derivation.inputs.{input_item.id}",
            grib_match=input_item.grib_match,
        )


def _validate_icon_grib_match(
    *,
    model_id: str,
    artifact_id: str,
    selector_id: str,
    grib_match: Mapping[str, str],
) -> None:
    icon_param = grib_match.get(ICON_PARAM_MATCH_KEY)
    if not isinstance(icon_param, str) or not icon_param.strip():
        raise SystemExit(
            f"models.{model_id}.artifacts.{artifact_id}.{selector_id} "
            f"requires grib_match.{ICON_PARAM_MATCH_KEY} for icon_dwd_icosahedral sources"
        )
