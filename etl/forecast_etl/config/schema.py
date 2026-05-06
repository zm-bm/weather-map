"""Typed ETL configuration schema."""

from __future__ import annotations

from ._types import (
    ConfigModel,
    FiniteNumber,
    NonEmptyStr,
    NonEmptyStringMap,
    OptionalNonEmptyStr,
    UniqueNonEmptyStringTuple,
)

SOURCE_TYPE_GFS_NOMADS = "gfs_nomads"
SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL = "icon_dwd_icosahedral"


class ExecutionContext(ConfigModel):
    """Runtime identity passed from resolved config into ETL execution."""

    model_id: NonEmptyStr
    artifact_root_uri: NonEmptyStr
    forecast_hours: UniqueNonEmptyStringTuple


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
    regrid_image: NonEmptyStr
    rate_limit_seconds: FiniteNumber


class ModelSourceConfig(ConfigModel):
    """Resolved model source config with the active source-specific payload."""

    type: NonEmptyStr
    grid_id: NonEmptyStr
    nomads: NomadsConfig | None = None
    icon_dwd: IconDwdConfig | None = None


class ComponentSpec(ConfigModel):
    """Resolved product component and its GRIB metadata selector."""

    id: NonEmptyStr
    grib_match: NonEmptyStringMap


class EncodingSpec(ConfigModel):
    """Resolved binary payload encoding contract for one product."""

    id: NonEmptyStr
    format: NonEmptyStr
    dtype: NonEmptyStr
    byte_order: NonEmptyStr
    scale: FiniteNumber | None = None
    offset: FiniteNumber | None = None
    nodata: int | None = None


class ProductStyleSpec(ConfigModel):
    """Frontend layer and palette identifiers for one product."""

    layer_id: NonEmptyStr
    palette_id: NonEmptyStr


class ProductCatalogSpec(ConfigModel):
    """Reusable product definition before model-specific GRIB selectors."""

    id: NonEmptyStr
    parameter: NonEmptyStr
    level: NonEmptyStr
    units: NonEmptyStr
    valid_min: FiniteNumber
    valid_max: FiniteNumber
    source_transform: NonEmptyStr
    encoding: EncodingSpec
    component_ids: UniqueNonEmptyStringTuple
    style: ProductStyleSpec
    label: OptionalNonEmptyStr = None


class ModelProductSpec(ConfigModel):
    """Model-specific GRIB selectors for a catalog product."""

    product_id: NonEmptyStr
    component_grib_matches: dict[NonEmptyStr, NonEmptyStringMap]


class ProductSpec(ConfigModel):
    """Fully resolved product ready for extraction, encoding, and publishing."""

    id: NonEmptyStr
    parameter: NonEmptyStr
    level: NonEmptyStr
    units: NonEmptyStr
    valid_min: FiniteNumber
    valid_max: FiniteNumber
    source_transform: NonEmptyStr
    encoding: EncodingSpec
    components: tuple[ComponentSpec, ...]
    style: ProductStyleSpec
    label: OptionalNonEmptyStr = None

    @property
    def component_ids(self) -> tuple[str, ...]:
        """Component identifiers in payload packing order."""

        return tuple(component.id for component in self.components)


class ProductGroup(ConfigModel):
    """Frontend grouping for scalar product selection."""

    id: NonEmptyStr
    label: NonEmptyStr
    layer_id: NonEmptyStr
    default_product: NonEmptyStr
    products: UniqueNonEmptyStringTuple


class ModelConfig(ConfigModel):
    """Resolved config for one forecast model."""

    id: NonEmptyStr
    label: NonEmptyStr
    source: ModelSourceConfig
    workload: WorkloadConfig
    model_products: dict[str, ModelProductSpec]
    products: dict[str, ProductSpec]
    product_groups: tuple[ProductGroup, ...]

    def to_execution_context(self, artifact_root_uri: str) -> ExecutionContext:
        """Create the runtime context used by workers and publishers."""

        return ExecutionContext(
            model_id=self.id,
            artifact_root_uri=artifact_root_uri,
            forecast_hours=self.workload.forecast_hours,
        )


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
