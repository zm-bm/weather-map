"""Typed ETL configuration schema."""

from __future__ import annotations

from dataclasses import dataclass

PRODUCT_KIND_SCALAR = "scalar"
PRODUCT_KIND_VECTOR = "vector"
PRODUCT_KINDS = {PRODUCT_KIND_SCALAR, PRODUCT_KIND_VECTOR}
SOURCE_TYPE_GFS_NOMADS = "gfs_nomads"
SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL = "icon_dwd_icosahedral"
SOURCE_TYPES = {SOURCE_TYPE_GFS_NOMADS, SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL}


@dataclass(frozen=True)
class ExecutionContext:
    model_id: str
    artifact_root_uri: str
    forecast_hours: tuple[str, ...]


@dataclass(frozen=True)
class WorkloadConfig:
    forecast_hours: tuple[str, ...]
    products: tuple[str, ...]


@dataclass(frozen=True)
class NomadsConfig:
    base_url: str
    vars_levels: dict[str, str]
    rate_limit_seconds: float


@dataclass(frozen=True)
class IconDwdConfig:
    base_url: str
    regrid_image: str
    rate_limit_seconds: float


@dataclass(frozen=True)
class ModelSourceConfig:
    type: str
    grid_id: str
    nomads: NomadsConfig | None = None
    icon_dwd: IconDwdConfig | None = None


@dataclass(frozen=True)
class ComponentSpec:
    id: str
    grib_match: dict[str, str]


@dataclass(frozen=True)
class ScalarEncodingSpec:
    id: str
    format: str
    dtype: str
    byte_order: str
    nodata: int
    scale: float | None = None
    offset: float | None = None
    component_order: str | None = None


@dataclass(frozen=True)
class VectorEncodingSpec:
    id: str
    format: str
    dtype: str
    byte_order: str
    scale: float
    offset: float
    component_order: str


ProductEncodingSpec = ScalarEncodingSpec | VectorEncodingSpec


@dataclass(frozen=True)
class ProductCatalogSpec:
    id: str
    kind: str
    parameter: str
    level: str
    units: str
    valid_min: float
    valid_max: float
    source_transform: str
    encoding: ProductEncodingSpec
    component_ids: tuple[str, ...]
    label: str | None = None

    @property
    def is_scalar(self) -> bool:
        return self.kind == PRODUCT_KIND_SCALAR

    @property
    def is_vector(self) -> bool:
        return self.kind == PRODUCT_KIND_VECTOR


@dataclass(frozen=True)
class ModelProductSpec:
    product_id: str
    component_grib_matches: dict[str, dict[str, str]]


@dataclass(frozen=True)
class ProductSpec:
    id: str
    kind: str
    parameter: str
    level: str
    units: str
    valid_min: float
    valid_max: float
    source_transform: str
    encoding: ProductEncodingSpec
    components: tuple[ComponentSpec, ...]
    label: str | None = None

    @property
    def component_ids(self) -> tuple[str, ...]:
        return tuple(component.id for component in self.components)

    @property
    def is_scalar(self) -> bool:
        return self.kind == PRODUCT_KIND_SCALAR

    @property
    def is_vector(self) -> bool:
        return self.kind == PRODUCT_KIND_VECTOR


@dataclass(frozen=True)
class LayerGroup:
    id: str
    label: str
    kind: str
    default_product: str
    products: tuple[str, ...]

    def to_manifest_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "label": self.label,
            "default_variable": self.default_product,
            "variables": list(self.products),
        }


@dataclass(frozen=True)
class ModelConfig:
    id: str
    label: str
    source: ModelSourceConfig
    workload: WorkloadConfig
    model_products: dict[str, ModelProductSpec]
    products: dict[str, ProductSpec]
    layer_groups: tuple[LayerGroup, ...]

    def to_execution_context(self, artifact_root_uri: str) -> ExecutionContext:
        return ExecutionContext(
            model_id=self.id,
            artifact_root_uri=artifact_root_uri,
            forecast_hours=self.workload.forecast_hours,
        )


@dataclass(frozen=True)
class PipelineConfig:
    product_catalog: dict[str, ProductCatalogSpec]
    models: dict[str, ModelConfig]

    def model(self, model_id: str) -> ModelConfig:
        model = self.models.get(model_id)
        if model is None:
            raise SystemExit(f"Unknown model {model_id!r}; configured models: {sorted(self.models)!r}")
        return model
