"""Config assembly and cross-object validation helpers."""

from __future__ import annotations

from typing import Any, Mapping

from ._input import (
    CatalogProductInput,
    ModelProductInput,
    ModelSourceInput,
    ProductComponentInput,
    ProductInput,
    WorkloadInput,
)
from ._types import parse_config_model
from .encoding import parse_encoding
from .schema import (
    SOURCE_TYPE_GFS_NOMADS,
    SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL,
    ComponentSpec,
    IconDwdConfig,
    ModelProductSpec,
    ModelSourceConfig,
    NomadsConfig,
    ProductCatalogSpec,
    ProductSpec,
    ProductStyleSpec,
    WorkloadConfig,
)


def parse_workload_config(raw: Any) -> WorkloadConfig:
    """Normalize raw workload ranges into explicit forecast-hour ids."""

    parsed = parse_config_model(WorkloadInput, raw)
    return WorkloadConfig(forecast_hours=parsed.forecast_hours, products=parsed.products)


def parse_model_source_config(raw: Any) -> ModelSourceConfig:
    """Parse source config and attach the active source-specific settings."""

    parsed = parse_config_model(ModelSourceInput, raw)
    if parsed.type == SOURCE_TYPE_GFS_NOMADS:
        return ModelSourceConfig(
            type=parsed.type,
            grid_id=parsed.grid_id,
            nomads=NomadsConfig(
                base_url=parsed.base_url,
                vars_levels=dict(parsed.vars_levels or {}),
                rate_limit_seconds=parsed.rate_limit_seconds,
            ),
        )

    regrid_image = parsed.regrid_image
    if regrid_image is None:
        raise AssertionError("icon_dwd_icosahedral source was validated without regrid_image")

    return ModelSourceConfig(
        type=parsed.type,
        grid_id=parsed.grid_id,
        icon_dwd=IconDwdConfig(
            base_url=parsed.base_url.rstrip("/"),
            regrid_image=regrid_image,
            rate_limit_seconds=parsed.rate_limit_seconds,
        ),
    )


def validate_model_products_for_source(
    *,
    model_id: str,
    source: ModelSourceConfig,
    model_products: Mapping[str, ModelProductSpec],
) -> None:
    """Validate model-product selectors that depend on the source adapter."""

    if source.type != SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL:
        return

    for product_id, model_product in model_products.items():
        for component_id, grib_match in model_product.component_grib_matches.items():
            icon_param = grib_match.get("ICON_PARAM")
            if not isinstance(icon_param, str) or not icon_param.strip():
                raise SystemExit(
                    f"models.{model_id}.products.{product_id}.{component_id} "
                    "requires grib_match.ICON_PARAM for icon_dwd_icosahedral sources"
                )


def parse_product_catalog_spec(*, product_id: str, raw: Any) -> ProductCatalogSpec:
    """Parse one catalog product definition."""

    parsed = parse_config_model(CatalogProductInput, raw)
    style = ProductStyleSpec(
        layer_id=parsed.style.layer_id,
        palette_id=parsed.style.palette_id,
    )
    encoding = parse_encoding(
        product_id=product_id,
        layer_id=style.layer_id,
        raw_encoding=parsed.encoding,
        component_ids=parsed.component_ids,
    )
    return ProductCatalogSpec(
        id=product_id,
        parameter=parsed.parameter,
        level=parsed.level,
        units=parsed.units,
        valid_min=parsed.valid_min,
        valid_max=parsed.valid_max,
        source_transform=parsed.source_transform,
        encoding=encoding,
        component_ids=parsed.component_ids,
        style=style,
        label=parsed.label,
    )


def parse_product_spec(*, product_id: str, raw: Any) -> ProductSpec:
    """Parse a fully resolved product spec from test or fixture input."""

    parsed = parse_config_model(ProductInput, raw)
    components = _component_specs(parsed.components)
    style = ProductStyleSpec(
        layer_id=parsed.style.layer_id,
        palette_id=parsed.style.palette_id,
    )
    encoding = parse_encoding(
        product_id=product_id,
        layer_id=style.layer_id,
        raw_encoding=parsed.encoding,
        component_ids=tuple(component.id for component in components),
    )
    return ProductSpec(
        id=product_id,
        parameter=parsed.parameter,
        level=parsed.level,
        units=parsed.units,
        valid_min=parsed.valid_min,
        valid_max=parsed.valid_max,
        source_transform=parsed.source_transform,
        encoding=encoding,
        components=components,
        style=style,
        label=parsed.label,
    )


def parse_model_product_spec(
    *,
    product_id: str,
    raw: Any,
    catalog_product: ProductCatalogSpec,
) -> ModelProductSpec:
    """Parse one model product and verify catalog component order."""

    parsed = parse_config_model(ModelProductInput, raw)
    matches = parsed.component_grib_matches

    expected = catalog_product.component_ids
    actual = tuple(matches)
    if actual != expected:
        raise SystemExit(
            f"products.{product_id}.components must match product_catalog order "
            f"{list(expected)!r}, got {list(actual)!r}"
        )

    return ModelProductSpec(
        product_id=product_id,
        component_grib_matches=matches,
    )


def resolve_product_spec(
    *,
    catalog_product: ProductCatalogSpec,
    model_product: ModelProductSpec,
) -> ProductSpec:
    """Merge catalog product metadata with model-specific component selectors."""

    components = tuple(
        ComponentSpec(
            id=component_id,
            grib_match=model_product.component_grib_matches[component_id],
        )
        for component_id in catalog_product.component_ids
    )
    return ProductSpec(
        id=catalog_product.id,
        parameter=catalog_product.parameter,
        level=catalog_product.level,
        units=catalog_product.units,
        valid_min=catalog_product.valid_min,
        valid_max=catalog_product.valid_max,
        source_transform=catalog_product.source_transform,
        encoding=catalog_product.encoding,
        components=components,
        style=catalog_product.style,
        label=catalog_product.label,
    )


def validate_workload_products(
    *,
    product_ids: tuple[str, ...],
    products: Mapping[str, object],
) -> None:
    """Ensure every workload product exists in the product catalog."""

    for product_id in product_ids:
        if product_id not in products:
            raise SystemExit(f"workload.products references unknown product: {product_id!r}")


def _component_specs(raw_components: tuple[ProductComponentInput, ...]) -> tuple[ComponentSpec, ...]:
    return tuple(
        ComponentSpec(id=component.id, grib_match=dict(component.grib_match))
        for component in raw_components
    )
