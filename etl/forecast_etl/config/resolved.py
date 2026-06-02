"""Resolved ETL configuration datasets."""

from __future__ import annotations

from typing import Annotated, Literal, TypeAlias

from pydantic import Field, model_validator

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
    """Resolved artifact and forecast-hour selection for one dataset."""

    frames: UniqueNonEmptyStringTuple
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


DatasetSourceConfig: TypeAlias = Annotated[
    GfsNomadsSourceConfig | IconDwdSourceConfig,
    Field(discriminator="type"),
]


class ComponentSpec(ConfigModel):
    """Resolved artifact component and its GRIB metadata selector."""

    id: NonEmptyStr
    grib_match: NonEmptyStringMap | None = None


class FiniteValueRangeSpec(ConfigModel):
    """Finite transformed-value clamp range applied before quantization."""

    min: FiniteNumber
    max: FiniteNumber

    @model_validator(mode="after")
    def _validate_range(self) -> "FiniteValueRangeSpec":
        if self.max < self.min:
            raise ValueError("finite_value_range.max must be greater than or equal to min")
        return self


class EncodingSpec(ConfigModel):
    """Resolved binary payload encoding contract for one artifact."""

    id: NonEmptyStr
    format: NonEmptyStr
    dtype: NonEmptyStr
    byte_order: NonEmptyStr
    scale: FiniteNumber | None = None
    offset: FiniteNumber | None = None
    nodata: int | None = None
    finite_value_range: FiniteValueRangeSpec | None = None


class ArtifactCatalogSpec(ConfigModel):
    """Reusable artifact definition before dataset-specific GRIB selectors."""

    id: NonEmptyStr
    kind: ArtifactKind
    parameter: NonEmptyStr
    level: NonEmptyStr
    units: NonEmptyStr
    source_transform: NonEmptyStr
    encoding: EncodingSpec
    component_ids: UniqueNonEmptyStringTuple


class ArtifactTemporalSpec(ConfigModel):
    """Temporal semantics for a resolved dataset artifact."""

    kind: NonEmptyStr
    source_interval_hours: FiniteNumber | None = None


class DerivationInputSpec(ConfigModel):
    """Resolved source input for an artifact derivation."""

    id: NonEmptyStr
    grib_match: NonEmptyStringMap


class ArtifactDerivationSpec(ConfigModel):
    """Source derivation contract for a resolved dataset artifact."""

    type: NonEmptyStr
    first_hour_previous: NonEmptyStr | None = None
    inputs: tuple[DerivationInputSpec, ...] = ()


class ArtifactGridTransformSpec(ConfigModel):
    """Grid transform applied to extracted artifact bands before encoding."""

    type: NonEmptyStr
    grid_id: NonEmptyStr


class DatasetArtifactSpec(ConfigModel):
    """Dataset-specific GRIB selectors for a catalog artifact."""

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


class DatasetConfig(ConfigModel):
    """Resolved config for one dataset."""

    id: NonEmptyStr
    label: NonEmptyStr
    source: DatasetSourceConfig
    workload: WorkloadConfig
    dataset_artifacts: dict[str, DatasetArtifactSpec]
    artifacts: dict[str, ArtifactSpec]


class PipelineConfig(ConfigModel):
    """Resolved ETL config containing the catalog and all configured datasets."""

    artifact_catalog: dict[str, ArtifactCatalogSpec]
    datasets: dict[str, DatasetConfig]

    def dataset(self, dataset_id: str) -> DatasetConfig:
        """Return a configured dataset or fail with the available dataset ids."""

        dataset = self.datasets.get(dataset_id)
        if dataset is None:
            raise SystemExit(f"Unknown dataset {dataset_id!r}; configured datasets: {sorted(self.datasets)!r}")
        return dataset
