"""Resolved ETL configuration models."""

from __future__ import annotations

from typing import Annotated, Literal, TypeAlias

from pydantic import Field

from ._types import (
    ConfigModel,
    FiniteNumber,
    NonEmptyStr,
    NonEmptyStringMap,
    UniqueNonEmptyStringTuple,
)

SOURCE_TYPE_GFS_NOMADS = "gfs_nomads"
SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL = "icon_dwd_icosahedral"
ArtifactKind: TypeAlias = Literal["scalar", "vector"]


class WorkloadConfig(ConfigModel):
    """Resolved artifact and forecast-hour selection for one model."""

    forecast_hours: UniqueNonEmptyStringTuple
    artifacts: UniqueNonEmptyStringTuple


class NomadsConfig(ConfigModel):
    """GFS NOMADS acquisition settings."""

    base_url: NonEmptyStr
    vars_levels: dict[NonEmptyStr, NonEmptyStr]
    rate_limit_seconds: FiniteNumber


class IconDwdConfig(ConfigModel):
    """ICON DWD acquisition and regridding settings."""

    base_url: NonEmptyStr
    rate_limit_seconds: FiniteNumber


class BaseSourceConfig(ConfigModel):
    """Common resolved source config fields."""

    type: NonEmptyStr
    grid_id: NonEmptyStr


class GfsNomadsSourceConfig(BaseSourceConfig):
    """Resolved GFS NOMADS source config."""

    type: Literal["gfs_nomads"] = SOURCE_TYPE_GFS_NOMADS
    nomads: NomadsConfig


class IconDwdSourceConfig(BaseSourceConfig):
    """Resolved ICON DWD source config."""

    type: Literal["icon_dwd_icosahedral"] = SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL
    icon_dwd: IconDwdConfig


ModelSourceConfig: TypeAlias = Annotated[
    GfsNomadsSourceConfig | IconDwdSourceConfig,
    Field(discriminator="type"),
]


class ComponentSpec(ConfigModel):
    """Resolved artifact component and its GRIB metadata selector."""

    id: NonEmptyStr
    grib_match: NonEmptyStringMap | None = None


class EncodingSpec(ConfigModel):
    """Resolved binary payload encoding contract for one artifact."""

    id: NonEmptyStr
    format: NonEmptyStr
    dtype: NonEmptyStr
    byte_order: NonEmptyStr
    scale: FiniteNumber | None = None
    offset: FiniteNumber | None = None
    nodata: int | None = None


class ArtifactCatalogSpec(ConfigModel):
    """Reusable artifact definition before model-specific GRIB selectors."""

    id: NonEmptyStr
    kind: ArtifactKind
    parameter: NonEmptyStr
    level: NonEmptyStr
    units: NonEmptyStr
    source_transform: NonEmptyStr
    encoding: EncodingSpec
    component_ids: UniqueNonEmptyStringTuple


class ArtifactTemporalSpec(ConfigModel):
    """Temporal semantics for a resolved model artifact."""

    kind: NonEmptyStr
    source_interval_hours: FiniteNumber | None = None


class DerivationInputSpec(ConfigModel):
    """Resolved source input for an artifact derivation."""

    id: NonEmptyStr
    grib_match: NonEmptyStringMap


class ArtifactDerivationSpec(ConfigModel):
    """Source derivation contract for a resolved model artifact."""

    type: NonEmptyStr
    first_hour_previous: NonEmptyStr | None = None
    inputs: tuple[DerivationInputSpec, ...] = ()


class ArtifactGridTransformSpec(ConfigModel):
    """Grid transform applied to extracted artifact bands before encoding."""

    type: NonEmptyStr
    grid_id: NonEmptyStr


class ModelArtifactSpec(ConfigModel):
    """Model-specific GRIB selectors for a catalog artifact."""

    artifact_id: NonEmptyStr
    component_grib_matches: dict[NonEmptyStr, NonEmptyStringMap | None]
    temporal: ArtifactTemporalSpec | None = None
    derivation: ArtifactDerivationSpec | None = None
    grid_transform: ArtifactGridTransformSpec | None = None


class ArtifactSpec(ConfigModel):
    """Fully resolved artifact ready for extraction, encoding, and publishing."""

    id: NonEmptyStr
    kind: ArtifactKind
    parameter: NonEmptyStr
    level: NonEmptyStr
    units: NonEmptyStr
    source_transform: NonEmptyStr
    encoding: EncodingSpec
    components: tuple[ComponentSpec, ...]
    temporal: ArtifactTemporalSpec | None = None
    derivation: ArtifactDerivationSpec | None = None
    grid_transform: ArtifactGridTransformSpec | None = None

    @property
    def component_ids(self) -> tuple[str, ...]:
        """Component identifiers in payload packing order."""

        return tuple(component.id for component in self.components)


class ModelConfig(ConfigModel):
    """Resolved config for one forecast model."""

    id: NonEmptyStr
    label: NonEmptyStr
    source: ModelSourceConfig
    workload: WorkloadConfig
    model_artifacts: dict[str, ModelArtifactSpec]
    artifacts: dict[str, ArtifactSpec]


class PipelineConfig(ConfigModel):
    """Resolved ETL config containing the catalog and all configured models."""

    artifact_catalog: dict[str, ArtifactCatalogSpec]
    models: dict[str, ModelConfig]

    def model(self, model_id: str) -> ModelConfig:
        """Return a configured model or fail with the available model ids."""

        model = self.models.get(model_id)
        if model is None:
            raise SystemExit(f"Unknown model {model_id!r}; configured models: {sorted(self.models)!r}")
        return model
