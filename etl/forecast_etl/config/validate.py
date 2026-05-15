"""Config assembly and cross-object validation helpers."""

from __future__ import annotations

from typing import Any, Mapping

from ..derivations import (
    DERIVATION_ICON_TOT_PREC_DELTA_RATE,
    GFS_DERIVATION_TYPES,
    ICON_DERIVATION_TYPES,
    ICON_PARAM_MATCH_KEY,
)
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
    DerivationInputSpec,
    GfsNomadsSourceConfig,
    IconDwdConfig,
    IconDwdSourceConfig,
    ModelProductSpec,
    ModelSourceConfig,
    NomadsConfig,
    ProductCatalogSpec,
    ProductDerivationSpec,
    ProductSpec,
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
        derivation = model_product.derivation
        if derivation is None:
            for component_id, grib_match in model_product.component_grib_matches.items():
                if grib_match is None:
                    raise SystemExit(
                        f"models.{model_id}.products.{product_id}.{component_id} "
                        "requires grib_match for direct products"
                    )
            continue

        _validate_derived_output_components(
            model_id=model_id,
            product_id=product_id,
            component_grib_matches=model_product.component_grib_matches,
        )

        if derivation.type in GFS_DERIVATION_TYPES:
            if not isinstance(source, GfsNomadsSourceConfig):
                raise SystemExit(
                    f"models.{model_id}.products.{product_id} uses derivation "
                    f"{derivation.type!r}, which is only supported for gfs_nomads sources"
                )
            if not derivation.inputs:
                raise SystemExit(f"GFS derivation {derivation.type!r} requires derivation.inputs for {product_id}")
            continue

        if not isinstance(source, IconDwdSourceConfig):
            raise SystemExit(
                f"models.{model_id}.products.{product_id} uses derivation "
                f"{model_product.derivation.type!r}, which is only supported for icon_dwd_icosahedral sources"
            )
        if derivation.type not in ICON_DERIVATION_TYPES:
            raise SystemExit(f"Unsupported derivation for {product_id}: {derivation.type!r}")

    if not isinstance(source, IconDwdSourceConfig):
        return

    for product_id, model_product in model_products.items():
        derivation = model_product.derivation
        if derivation is None:
            _validate_icon_component_selectors(
                model_id=model_id,
                product_id=product_id,
                component_grib_matches=model_product.component_grib_matches,
            )
            continue
        if derivation.type not in ICON_DERIVATION_TYPES:
            raise SystemExit(f"Unsupported ICON derivation for {product_id}: {derivation.type!r}")

        _validate_icon_derivation_inputs(
            model_id=model_id,
            product_id=product_id,
            inputs=derivation.inputs,
        )
        if derivation.type == DERIVATION_ICON_TOT_PREC_DELTA_RATE and len(derivation.inputs) != 1:
            raise SystemExit(
                f"ICON derivation {derivation.type!r} requires exactly one derivation input for {product_id}"
            )
        if derivation.type == DERIVATION_ICON_TOT_PREC_DELTA_RATE:
            _validate_icon_average_rate_derivation(product_id=product_id, model_product=model_product)


def _validate_icon_average_rate_derivation(
    *,
    product_id: str,
    model_product: ModelProductSpec,
) -> None:
    derivation = model_product.derivation
    if derivation is None:
        raise SystemExit(f"Product {product_id} does not declare a derivation")
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
        raise SystemExit(
            f"ICON derivation {derivation.type!r} requires first_hour_previous='zero' for {product_id}"
        )


def parse_product_catalog_spec(*, product_id: str, raw: Any) -> ProductCatalogSpec:
    """Parse one catalog product definition."""

    parsed = parse_config_model(CatalogProductInput, raw)
    encoding = parse_encoding(
        product_id=product_id,
        raw_encoding=parsed.encoding,
    )
    return ProductCatalogSpec(
        id=product_id,
        kind=parsed.kind,
        parameter=parsed.parameter,
        level=parsed.level,
        units=parsed.units,
        source_transform=parsed.source_transform,
        encoding=encoding,
        component_ids=parsed.component_ids,
    )


def parse_product_spec(*, product_id: str, raw: Any) -> ProductSpec:
    """Parse a fully resolved product spec from test or fixture input."""

    parsed = parse_config_model(ProductInput, raw)
    components = _component_specs(parsed.components)
    encoding = parse_encoding(
        product_id=product_id,
        raw_encoding=parsed.encoding,
    )
    return ProductSpec(
        id=product_id,
        kind=parsed.kind,
        parameter=parsed.parameter,
        level=parsed.level,
        units=parsed.units,
        source_transform=parsed.source_transform,
        encoding=encoding,
        components=components,
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
        kind=catalog_product.kind,
        parameter=catalog_product.parameter,
        level=catalog_product.level,
        units=catalog_product.units,
        source_transform=catalog_product.source_transform,
        encoding=catalog_product.encoding,
        components=components,
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
        ComponentSpec(
            id=component.id,
            grib_match=dict(component.grib_match) if component.grib_match is not None else None,
        )
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
        inputs=tuple(
            DerivationInputSpec(id=input_item.id, grib_match=dict(input_item.grib_match))
            for input_item in getattr(raw, "inputs", ())
        ),
    )


def _validate_icon_component_selectors(
    *,
    model_id: str,
    product_id: str,
    component_grib_matches: Mapping[str, Mapping[str, str] | None],
) -> None:
    for component_id, grib_match in component_grib_matches.items():
        if grib_match is None:
            raise SystemExit(
                f"models.{model_id}.products.{product_id}.{component_id} "
                f"requires grib_match.{ICON_PARAM_MATCH_KEY} for icon_dwd_icosahedral sources"
            )
        _validate_icon_grib_match(
            model_id=model_id,
            product_id=product_id,
            selector_id=component_id,
            grib_match=grib_match,
        )


def _validate_derived_output_components(
    *,
    model_id: str,
    product_id: str,
    component_grib_matches: Mapping[str, Mapping[str, str] | None],
) -> None:
    for component_id, grib_match in component_grib_matches.items():
        if grib_match is not None:
            raise SystemExit(
                f"models.{model_id}.products.{product_id}.{component_id} is a derived output component; "
                "put source selectors in derivation.inputs instead of components"
            )


def _validate_icon_derivation_inputs(
    *,
    model_id: str,
    product_id: str,
    inputs: tuple[DerivationInputSpec, ...],
) -> None:
    if not inputs:
        raise SystemExit(f"ICON derivation for {product_id} requires derivation.inputs")
    for input_item in inputs:
        _validate_icon_grib_match(
            model_id=model_id,
            product_id=product_id,
            selector_id=f"derivation.inputs.{input_item.id}",
            grib_match=input_item.grib_match,
        )


def _validate_icon_grib_match(
    *,
    model_id: str,
    product_id: str,
    selector_id: str,
    grib_match: Mapping[str, str],
) -> None:
    icon_param = grib_match.get(ICON_PARAM_MATCH_KEY)
    if not isinstance(icon_param, str) or not icon_param.strip():
        raise SystemExit(
            f"models.{model_id}.products.{product_id}.{selector_id} "
            f"requires grib_match.{ICON_PARAM_MATCH_KEY} for icon_dwd_icosahedral sources"
        )
