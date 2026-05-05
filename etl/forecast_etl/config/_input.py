"""Pydantic models for raw etl_config.json objects."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field, StrictInt, model_validator

from ..products.transforms import SOURCE_TRANSFORM_IDENTITY, SOURCE_TRANSFORMS
from ._types import (
    ConfigModel,
    FiniteNumber,
    ForecastHourInt,
    NonEmptyStr,
    NonEmptyStringMap,
    OptionalNonEmptyStr,
    UniqueNonEmptyStringTuple,
)
from .schema import SOURCE_TYPE_GFS_NOMADS, SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL


class PipelineConfigInput(ConfigModel):
    version: Literal[2]
    product_catalog: dict[NonEmptyStr, Any] = Field(min_length=1)
    models: dict[NonEmptyStr, "ModelConfigInput"] = Field(min_length=1)


class ModelConfigInput(ConfigModel):
    label: NonEmptyStr
    source: dict[str, Any]
    workload: dict[str, Any]
    products: dict[NonEmptyStr, Any] = Field(min_length=1)
    product_groups: list[Any] = Field(min_length=1)


class WorkloadInput(ConfigModel):
    forecast_hour_start: ForecastHourInt
    forecast_hour_end: ForecastHourInt
    products: UniqueNonEmptyStringTuple

    @model_validator(mode="after")
    def _validate_range(self) -> "WorkloadInput":
        if self.forecast_hour_end < self.forecast_hour_start:
            raise ValueError("forecast_hour_end must be greater than or equal to forecast_hour_start")
        return self

    @property
    def forecast_hours(self) -> tuple[str, ...]:
        return tuple(f"{hour:03d}" for hour in range(self.forecast_hour_start, self.forecast_hour_end + 1))


class ModelSourceInput(ConfigModel):
    type: Literal["gfs_nomads", "icon_dwd_icosahedral"]
    grid_id: NonEmptyStr
    base_url: NonEmptyStr
    vars_levels: dict[NonEmptyStr, NonEmptyStr] | None = None
    regrid_image: NonEmptyStr | None = None
    rate_limit_seconds: FiniteNumber

    @model_validator(mode="after")
    def _validate_source_fields(self) -> "ModelSourceInput":
        if self.type == SOURCE_TYPE_GFS_NOMADS:
            if self.vars_levels is None:
                raise ValueError("gfs_nomads sources require vars_levels")
            if self.regrid_image is not None:
                raise ValueError("gfs_nomads sources do not accept regrid_image")
        elif self.type == SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL:
            if self.regrid_image is None:
                raise ValueError("icon_dwd_icosahedral sources require regrid_image")
            if self.vars_levels is not None:
                raise ValueError("icon_dwd_icosahedral sources do not accept vars_levels")
        return self


class ProductStyleInput(ConfigModel):
    layer_id: NonEmptyStr
    palette_id: NonEmptyStr


class ProductBaseInput(ConfigModel):
    parameter: NonEmptyStr
    level: NonEmptyStr
    units: NonEmptyStr
    valid_min: FiniteNumber
    valid_max: FiniteNumber
    style: ProductStyleInput
    encoding: dict[str, Any]
    source_transform: NonEmptyStr = SOURCE_TRANSFORM_IDENTITY
    label: OptionalNonEmptyStr = None

    @model_validator(mode="after")
    def _validate_product_fields(self) -> "ProductBaseInput":
        if self.valid_min >= self.valid_max:
            raise ValueError("valid_min must be less than valid_max")
        if self.source_transform not in SOURCE_TRANSFORMS:
            raise ValueError(f"source_transform must be one of {sorted(SOURCE_TRANSFORMS)!r}")
        return self


class CatalogComponentInput(ConfigModel):
    id: NonEmptyStr


class ProductComponentInput(ConfigModel):
    id: NonEmptyStr
    grib_match: NonEmptyStringMap


class CatalogProductInput(ProductBaseInput):
    components: tuple[CatalogComponentInput, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def _validate_components(self) -> "CatalogProductInput":
        _validate_unique_component_ids(tuple(component.id for component in self.components))
        return self

    @property
    def component_ids(self) -> tuple[str, ...]:
        return tuple(component.id for component in self.components)


class ProductInput(ProductBaseInput):
    components: tuple[ProductComponentInput, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def _validate_components(self) -> "ProductInput":
        _validate_unique_component_ids(tuple(component.id for component in self.components))
        return self


class ModelProductInput(ConfigModel):
    components: tuple[ProductComponentInput, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def _validate_components(self) -> "ModelProductInput":
        _validate_unique_component_ids(tuple(component.id for component in self.components))
        return self

    @property
    def component_grib_matches(self) -> dict[str, dict[str, str]]:
        return {component.id: dict(component.grib_match) for component in self.components}


class EncodingInput(ConfigModel):
    id: NonEmptyStr
    format: NonEmptyStr
    dtype: NonEmptyStr
    byte_order: NonEmptyStr
    scale: FiniteNumber | None = None
    offset: FiniteNumber | None = None
    nodata: StrictInt | None = None


class ProductGroupInput(ConfigModel):
    id: NonEmptyStr
    label: NonEmptyStr
    layer_id: NonEmptyStr
    default_product: NonEmptyStr
    products: UniqueNonEmptyStringTuple

    @model_validator(mode="after")
    def _validate_default_product(self) -> "ProductGroupInput":
        if self.default_product not in self.products:
            raise ValueError("default_product must be included in products")
        return self


class ProductGroupsInput(ConfigModel):
    groups: tuple[ProductGroupInput, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def _validate_group_ids(self) -> "ProductGroupsInput":
        seen: set[str] = set()
        for group in self.groups:
            if group.id in seen:
                raise ValueError(f"duplicate product group id: {group.id!r}")
            seen.add(group.id)
        return self


def _validate_unique_component_ids(component_ids: tuple[str, ...]) -> None:
    seen: set[str] = set()
    for component_id in component_ids:
        if component_id in seen:
            raise ValueError(f"duplicate component id: {component_id!r}")
        seen.add(component_id)
