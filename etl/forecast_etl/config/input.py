"""Pydantic models for raw pipeline config JSON objects."""

from __future__ import annotations

from typing import Annotated, Any, Literal, TypeAlias

from pydantic import Field, StrictInt, model_validator

from ..derivations import DERIVATION_TYPES
from ..encoding.transforms import SOURCE_TRANSFORM_IDENTITY, SOURCE_TRANSFORMS
from ._types import (
    ConfigModel,
    FiniteNumber,
    ForecastHourInt,
    NonEmptyStr,
    NonEmptyStringMap,
    UniqueNonEmptyStringTuple,
)
from .resolved import SOURCE_TYPE_GFS_NOMADS, SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL


class PipelineConfigInput(ConfigModel):
    """Raw top-level pipeline config shape."""

    version: Literal[3]
    artifact_catalog: dict[NonEmptyStr, Any] = Field(min_length=1)
    models: dict[NonEmptyStr, "ModelConfigInput"] = Field(min_length=1)


class ModelConfigInput(ConfigModel):
    """Raw model config before catalog artifacts are resolved."""

    label: NonEmptyStr
    source: dict[str, Any]
    workload: dict[str, Any]
    artifacts: dict[NonEmptyStr, Any] = Field(min_length=1)


class WorkloadInput(ConfigModel):
    """Raw workload range, normalized to concrete forecast-hour ids."""

    forecast_hour_start: ForecastHourInt
    forecast_hour_end: ForecastHourInt
    artifacts: UniqueNonEmptyStringTuple

    @model_validator(mode="after")
    def _validate_range(self) -> "WorkloadInput":
        if self.forecast_hour_end < self.forecast_hour_start:
            raise ValueError("forecast_hour_end must be greater than or equal to forecast_hour_start")
        return self

    @property
    def forecast_hours(self) -> tuple[str, ...]:
        return tuple(f"{hour:03d}" for hour in range(self.forecast_hour_start, self.forecast_hour_end + 1))


class BaseModelSourceInput(ConfigModel):
    """Raw source config fields shared by supported acquisition adapters."""

    type: str
    grid_id: NonEmptyStr
    base_url: NonEmptyStr
    rate_limit_seconds: FiniteNumber


class GfsNomadsSourceInput(BaseModelSourceInput):
    """Raw GFS NOMADS source config."""

    type: Literal["gfs_nomads"] = SOURCE_TYPE_GFS_NOMADS
    vars_levels: dict[NonEmptyStr, NonEmptyStr]


class IconDwdSourceInput(BaseModelSourceInput):
    """Raw ICON DWD source config."""

    type: Literal["icon_dwd_icosahedral"] = SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL


ModelSourceInput: TypeAlias = Annotated[
    GfsNomadsSourceInput | IconDwdSourceInput,
    Field(discriminator="type"),
]


class ModelSourceInputEnvelope(ConfigModel):
    """Wrapper for validating the discriminated source input union."""

    source: ModelSourceInput


class ArtifactBaseInput(ConfigModel):
    """Raw artifact fields shared by catalog and resolved artifact fixtures."""

    kind: Literal["scalar", "vector"]
    parameter: NonEmptyStr
    level: NonEmptyStr
    units: NonEmptyStr
    encoding: dict[str, Any]
    source_transform: NonEmptyStr = SOURCE_TRANSFORM_IDENTITY

    @model_validator(mode="after")
    def _validate_artifact_fields(self) -> "ArtifactBaseInput":
        if self.source_transform not in SOURCE_TRANSFORMS:
            raise ValueError(f"source_transform must be one of {sorted(SOURCE_TRANSFORMS)!r}")
        return self


class CatalogComponentInput(ConfigModel):
    id: NonEmptyStr


class ArtifactComponentInput(ConfigModel):
    id: NonEmptyStr
    grib_match: NonEmptyStringMap | None = None


class ArtifactTemporalInput(ConfigModel):
    kind: Literal["instantaneous_rate", "average_rate", "accumulation"]
    source_interval_hours: FiniteNumber | None = None

    @model_validator(mode="after")
    def _validate_interval(self) -> "ArtifactTemporalInput":
        if self.source_interval_hours is not None and self.source_interval_hours <= 0:
            raise ValueError("source_interval_hours must be positive when provided")
        return self


class ArtifactGridTransformInput(ConfigModel):
    type: Literal["regular_grid_downsample_2x"]
    grid_id: NonEmptyStr


class ArtifactDerivationSourceInput(ConfigModel):
    id: NonEmptyStr
    grib_match: NonEmptyStringMap


class ArtifactDerivationInput(ConfigModel):
    type: NonEmptyStr
    first_hour_previous: Literal["zero"] | None = None
    inputs: tuple[ArtifactDerivationSourceInput, ...] = ()

    @model_validator(mode="after")
    def _validate_type(self) -> "ArtifactDerivationInput":
        if self.type not in DERIVATION_TYPES:
            raise ValueError(f"type must be one of {sorted(DERIVATION_TYPES)!r}")
        return self


class CatalogArtifactInput(ArtifactBaseInput):
    """Raw catalog artifact with component identities only."""

    components: tuple[CatalogComponentInput, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def _validate_components(self) -> "CatalogArtifactInput":
        _validate_unique_component_ids(tuple(component.id for component in self.components))
        return self

    @property
    def component_ids(self) -> tuple[str, ...]:
        return tuple(component.id for component in self.components)


class ArtifactInput(ArtifactBaseInput):
    """Raw fully-resolved artifact used by artifact fixture helpers."""

    components: tuple[ArtifactComponentInput, ...] = Field(min_length=1)
    temporal: ArtifactTemporalInput | None = None
    derivation: ArtifactDerivationInput | None = None
    grid_transform: ArtifactGridTransformInput | None = None

    @model_validator(mode="after")
    def _validate_components(self) -> "ArtifactInput":
        _validate_unique_component_ids(tuple(component.id for component in self.components))
        return self


class ModelArtifactInput(ConfigModel):
    """Raw model artifact component-to-GRIB selector mapping."""

    components: tuple[ArtifactComponentInput, ...] = Field(min_length=1)
    temporal: ArtifactTemporalInput | None = None
    derivation: ArtifactDerivationInput | None = None
    grid_transform: ArtifactGridTransformInput | None = None

    @model_validator(mode="after")
    def _validate_components(self) -> "ModelArtifactInput":
        _validate_unique_component_ids(tuple(component.id for component in self.components))
        return self

    @property
    def component_grib_matches(self) -> dict[str, dict[str, str] | None]:
        return {
            component.id: dict(component.grib_match) if component.grib_match is not None else None
            for component in self.components
        }


class FiniteValueRangeInput(ConfigModel):
    """Raw finite-value clamp range for transformed artifact values."""

    min: FiniteNumber
    max: FiniteNumber

    @model_validator(mode="after")
    def _validate_range(self) -> "FiniteValueRangeInput":
        if self.max < self.min:
            raise ValueError("finite_value_range.max must be greater than or equal to min")
        return self


class EncodingInput(ConfigModel):
    """Raw encoding object from artifact config."""

    id: NonEmptyStr
    format: NonEmptyStr
    dtype: NonEmptyStr
    byte_order: NonEmptyStr
    scale: FiniteNumber | None = None
    offset: FiniteNumber | None = None
    nodata: StrictInt | None = None
    finite_value_range: FiniteValueRangeInput | None = None


def _validate_unique_component_ids(component_ids: tuple[str, ...]) -> None:
    seen: set[str] = set()
    for component_id in component_ids:
        if component_id in seen:
            raise ValueError(f"duplicate component id: {component_id!r}")
        seen.add(component_id)
