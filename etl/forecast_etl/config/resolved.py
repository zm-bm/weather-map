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
ProductKind: TypeAlias = Literal["scalar", "vector"]


class WorkloadConfig(ConfigModel):
    """Resolved product and forecast-hour selection for one model."""

    forecast_hours: UniqueNonEmptyStringTuple
    products: UniqueNonEmptyStringTuple


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
    """Resolved product component and its GRIB metadata selector."""

    id: NonEmptyStr
    grib_match: NonEmptyStringMap | None = None


class EncodingSpec(ConfigModel):
    """Resolved binary payload encoding contract for one product."""

    id: NonEmptyStr
    format: NonEmptyStr
    dtype: NonEmptyStr
    byte_order: NonEmptyStr
    scale: FiniteNumber | None = None
    offset: FiniteNumber | None = None
    nodata: int | None = None


class ProductCatalogSpec(ConfigModel):
    """Reusable product definition before model-specific GRIB selectors."""

    id: NonEmptyStr
    kind: ProductKind
    parameter: NonEmptyStr
    level: NonEmptyStr
    units: NonEmptyStr
    source_transform: NonEmptyStr
    encoding: EncodingSpec
    component_ids: UniqueNonEmptyStringTuple


class ProductTemporalSpec(ConfigModel):
    """Temporal semantics for a resolved model product."""

    kind: NonEmptyStr
    source_interval_hours: FiniteNumber | None = None


class DerivationInputSpec(ConfigModel):
    """Resolved source input for a product derivation."""

    id: NonEmptyStr
    grib_match: NonEmptyStringMap


class ProductDerivationSpec(ConfigModel):
    """Source derivation contract for a resolved model product."""

    type: NonEmptyStr
    phase: NonEmptyStr | None = None
    first_hour_previous: NonEmptyStr | None = None
    inputs: tuple[DerivationInputSpec, ...] = ()


class ModelProductSpec(ConfigModel):
    """Model-specific GRIB selectors for a catalog product."""

    product_id: NonEmptyStr
    component_grib_matches: dict[NonEmptyStr, NonEmptyStringMap | None]
    temporal: ProductTemporalSpec | None = None
    derivation: ProductDerivationSpec | None = None


class ProductSpec(ConfigModel):
    """Fully resolved product ready for extraction, encoding, and publishing."""

    id: NonEmptyStr
    kind: ProductKind
    parameter: NonEmptyStr
    level: NonEmptyStr
    units: NonEmptyStr
    source_transform: NonEmptyStr
    encoding: EncodingSpec
    components: tuple[ComponentSpec, ...]
    temporal: ProductTemporalSpec | None = None
    derivation: ProductDerivationSpec | None = None

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
    model_products: dict[str, ModelProductSpec]
    products: dict[str, ProductSpec]


class PipelineConfig(ConfigModel):
    """Resolved ETL config containing the catalog and all configured models."""

    product_catalog: dict[str, ProductCatalogSpec]
    models: dict[str, ModelConfig]

    def model(self, model_id: str) -> ModelConfig:
        """Return a configured model or fail with the available model ids."""

        model = self.models.get(model_id)
        if model is None:
            raise SystemExit(f"Unknown model {model_id!r}; configured models: {sorted(self.models)!r}")
        return model
