"""Config assembly and cross-object validation helpers."""

from __future__ import annotations

from typing import Any, Mapping

from ..derivations import DERIVATION_ICON_TOT_PREC_DELTA_RATE, ICON_PARAM_MATCH_KEY
from ._types import parse_config_model
from .encoding import parse_encoding
from .input import (
    CatalogProductInput,
    GfsNomadsSourceInput,
    IconDwdSourceInput,
    ModelProductInput,
    ModelSourceInputEnvelope,
    ProductComponentInput,
    ProductInput,
    WorkloadInput,
)
from .resolved import (
    ComponentSpec,
    GfsNomadsSourceConfig,
    IconDwdConfig,
    IconDwdSourceConfig,
    ModelProductSpec,
    ModelSourceConfig,
    NomadsConfig,
    ProductCatalogSpec,
    ProductDerivationSpec,
    ProductSpec,
    ProductStyleSpec,
    ProductTemporalSpec,
    WorkloadConfig,
)


def parse_workload_config(raw: Any) -> WorkloadConfig:
    """Normalize raw workload ranges into explicit forecast-hour ids."""

    parsed = parse_config_model(WorkloadInput, raw)
    return WorkloadConfig(forecast_hours=parsed.forecast_hours, products=parsed.products)


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


def validate_model_products_for_source(
    *,
    model_id: str,
    source: ModelSourceConfig,
    model_products: Mapping[str, ModelProductSpec],
) -> None:
    """Validate model-product selectors that depend on the source adapter."""

    for product_id, model_product in model_products.items():
        if model_product.derivation is not None and not isinstance(source, IconDwdSourceConfig):
            raise SystemExit(
                f"models.{model_id}.products.{product_id} uses derivation "
                f"{model_product.derivation.type!r}, which is only supported for icon_dwd_icosahedral sources"
            )

    if not isinstance(source, IconDwdSourceConfig):
        return

    for product_id, model_product in model_products.items():
        for component_id, grib_match in model_product.component_grib_matches.items():
            icon_param = grib_match.get(ICON_PARAM_MATCH_KEY)
            if not isinstance(icon_param, str) or not icon_param.strip():
                raise SystemExit(
                    f"models.{model_id}.products.{product_id}.{component_id} "
                    f"requires grib_match.{ICON_PARAM_MATCH_KEY} for icon_dwd_icosahedral sources"
                )

        derivation = model_product.derivation
        if derivation is None:
            continue
        if derivation.type != DERIVATION_ICON_TOT_PREC_DELTA_RATE:
            raise SystemExit(f"Unsupported ICON derivation for {product_id}: {derivation.type!r}")
        if len(model_product.component_grib_matches) != 1:
            raise SystemExit(f"ICON derivation {derivation.type!r} requires exactly one component for {product_id}")
        if model_product.temporal is None:
            raise SystemExit(f"ICON derivation {derivation.type!r} requires temporal metadata for {product_id}")
        if model_product.temporal.kind != "average_rate":
            raise SystemExit(
                f"ICON derivation {derivation.type!r} requires temporal.kind='average_rate' for {product_id}"
            )
        if model_product.temporal.source_interval_hours != 1:
            raise SystemExit(
                f"ICON derivation {derivation.type!r} requires source_interval_hours=1 for {product_id}"
            )
        if derivation.first_hour_previous != "zero":
            raise SystemExit(f"ICON derivation {derivation.type!r} requires first_hour_previous='zero' for {product_id}")


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
        temporal=_temporal_spec(parsed.temporal),
        derivation=_derivation_spec(parsed.derivation),
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
        temporal=_temporal_spec(parsed.temporal),
        derivation=_derivation_spec(parsed.derivation),
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
        temporal=model_product.temporal,
        derivation=model_product.derivation,
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


def _temporal_spec(raw: object | None) -> ProductTemporalSpec | None:
    if raw is None:
        return None
    return ProductTemporalSpec(
        kind=getattr(raw, "kind"),
        source_interval_hours=getattr(raw, "source_interval_hours"),
    )


def _derivation_spec(raw: object | None) -> ProductDerivationSpec | None:
    if raw is None:
        return None
    return ProductDerivationSpec(
        type=getattr(raw, "type"),
        first_hour_previous=getattr(raw, "first_hour_previous"),
    )
