"""Validation and normalization helpers for ETL config parsing."""

from __future__ import annotations

import math
from typing import Any, Mapping

from ..encoding.scalar import (
    SCALAR_BYTE_ORDERS_BY_DTYPE,
    SCALAR_CLOUD_LAYER_COMPONENTS,
    SCALAR_COMPONENT_ORDER_LOW_MEDIUM_HIGH,
    SCALAR_FORMAT_I8_LINEAR_COMPONENTS,
    SCALAR_SOURCE_TRANSFORM_IDENTITY,
    SCALAR_SOURCE_TRANSFORMS,
    is_linear_scalar_format,
    scalar_format_for_encoding,
    scalar_required_nodata,
    scalar_storage_bounds,
)
from ..encoding.wind import (
    WIND_BYTE_ORDER,
    WIND_COMPONENT_ORDER,
    WIND_DTYPE,
    WIND_FORMAT,
    WIND_OFFSET,
    WIND_SCALE,
)
from .schema import (
    PRODUCT_KIND_SCALAR,
    PRODUCT_KIND_VECTOR,
    PRODUCT_KINDS,
    SOURCE_TYPE_GFS_NOMADS,
    SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL,
    SOURCE_TYPES,
    ComponentSpec,
    IconDwdConfig,
    LayerGroup,
    ModelProductSpec,
    ModelSourceConfig,
    NomadsConfig,
    ProductCatalogSpec,
    ProductSpec,
    ScalarEncodingSpec,
    VectorEncodingSpec,
    WorkloadConfig,
)

DEFAULT_LAYER_GROUP_ID = "layers"
DEFAULT_LAYER_GROUP_LABEL = "Layers"
REQUIRED_PRODUCT_FIELDS = {
    "kind",
    "parameter",
    "level",
    "units",
    "valid_min",
    "valid_max",
    "encoding",
    "components",
}


def parse_workload_config(raw: Any) -> WorkloadConfig:
    if not isinstance(raw, Mapping):
        raise SystemExit("pipeline_config missing valid 'workload' object")

    forecast_hours = _parse_workload_forecast_hours(raw)
    if "variables" in raw:
        raise SystemExit("workload.variables is no longer supported; use workload.products")
    products = _parse_unique_string_tuple(raw.get("products"), field_name="workload.products")
    return WorkloadConfig(forecast_hours=forecast_hours, products=products)


def parse_nomads_config(raw: Any) -> NomadsConfig:
    if not isinstance(raw, Mapping):
        raise SystemExit("pipeline_config missing valid 'nomads' object")

    base_url = _parse_non_empty_string(raw.get("base_url"), field_name="nomads.base_url")
    vars_levels_raw = raw.get("vars_levels")
    if not isinstance(vars_levels_raw, Mapping):
        raise SystemExit("nomads.vars_levels must be an object")
    vars_levels: dict[str, str] = {}
    for key, value in vars_levels_raw.items():
        if not isinstance(key, str) or not key.strip() or not isinstance(value, str) or not value.strip():
            raise SystemExit("nomads.vars_levels must map non-empty strings to non-empty strings")
        vars_levels[key.strip()] = value.strip()

    rate_limit = raw.get("rate_limit_seconds", 0.0)
    if not isinstance(rate_limit, (int, float)) or not math.isfinite(float(rate_limit)):
        raise SystemExit("nomads.rate_limit_seconds must be a finite number")

    return NomadsConfig(
        base_url=base_url,
        vars_levels=vars_levels,
        rate_limit_seconds=float(rate_limit),
    )


def parse_icon_dwd_config(raw: Any) -> IconDwdConfig:
    if not isinstance(raw, Mapping):
        raise SystemExit("model.source must be an object")

    base_url = _parse_non_empty_string(raw.get("base_url"), field_name="model.source.base_url")
    regrid_image = _parse_non_empty_string(raw.get("regrid_image"), field_name="model.source.regrid_image")
    rate_limit = raw.get("rate_limit_seconds", 0.0)
    if not isinstance(rate_limit, (int, float)) or not math.isfinite(float(rate_limit)):
        raise SystemExit("model.source.rate_limit_seconds must be a finite number")

    return IconDwdConfig(
        base_url=base_url.rstrip("/"),
        regrid_image=regrid_image,
        rate_limit_seconds=float(rate_limit),
    )


def parse_model_source_config(raw: Any) -> ModelSourceConfig:
    if not isinstance(raw, Mapping):
        raise SystemExit("model.source must be an object")

    source_type = _parse_non_empty_string(raw.get("type"), field_name="model.source.type")
    if source_type not in SOURCE_TYPES:
        raise SystemExit(f"model.source.type must be one of {sorted(SOURCE_TYPES)!r}, got {source_type!r}")
    grid_id = _parse_non_empty_string(raw.get("grid_id"), field_name="model.source.grid_id")

    if source_type == SOURCE_TYPE_GFS_NOMADS:
        return ModelSourceConfig(type=source_type, grid_id=grid_id, nomads=parse_nomads_config(raw))

    if source_type == SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL:
        return ModelSourceConfig(type=source_type, grid_id=grid_id, icon_dwd=parse_icon_dwd_config(raw))

    raise SystemExit(f"Unsupported model.source.type: {source_type!r}")


def validate_model_products_for_source(
    *,
    model_id: str,
    source: ModelSourceConfig,
    model_products: Mapping[str, ModelProductSpec],
) -> None:
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
    if not isinstance(raw, Mapping):
        raise SystemExit(f"pipeline_config product_catalog entry {product_id!r} must be an object")

    component_ids = _parse_product_component_ids(product_id=product_id, raw_components=raw.get("components"))
    placeholder_components = [
        {"id": component_id, "grib_match": {"__component__": component_id}}
        for component_id in component_ids
    ]
    parsed = parse_product_spec(
        product_id=product_id,
        raw={**raw, "components": placeholder_components},
    )
    return ProductCatalogSpec(
        id=parsed.id,
        kind=parsed.kind,
        parameter=parsed.parameter,
        level=parsed.level,
        units=parsed.units,
        valid_min=parsed.valid_min,
        valid_max=parsed.valid_max,
        source_transform=parsed.source_transform,
        encoding=parsed.encoding,
        component_ids=component_ids,
        label=parsed.label,
    )


def parse_product_spec(*, product_id: str, raw: Any) -> ProductSpec:
    if not isinstance(raw, Mapping):
        raise SystemExit(f"pipeline_config product {product_id!r} must be an object")

    missing_fields = sorted(field for field in REQUIRED_PRODUCT_FIELDS if field not in raw)
    if missing_fields:
        raise SystemExit(f"Product {product_id!r} missing required fields: {missing_fields!r}")

    kind = raw.get("kind")
    if kind not in PRODUCT_KINDS:
        raise SystemExit(
            f"Product {product_id!r} field 'kind' must be one of {sorted(PRODUCT_KINDS)!r}, got: {kind!r}"
        )

    parameter = _parse_non_empty_string(raw.get("parameter"), field_name=f"{product_id}.parameter")
    level = _parse_non_empty_string(raw.get("level"), field_name=f"{product_id}.level")
    units = _parse_non_empty_string(raw.get("units"), field_name=f"{product_id}.units")
    valid_min = _parse_finite_float(raw.get("valid_min"), field_name=f"{product_id}.valid_min")
    valid_max = _parse_finite_float(raw.get("valid_max"), field_name=f"{product_id}.valid_max")
    if valid_min >= valid_max:
        raise SystemExit(
            f"Product {product_id!r} requires valid_min < valid_max, got {valid_min!r} >= {valid_max!r}"
        )

    components = _parse_product_components(product_id=product_id, raw_components=raw.get("components"))
    component_ids = tuple(component.id for component in components)
    source_transform = _parse_source_transform(product_id=product_id, product_kind=str(kind), raw=raw)
    encoding = (
        _parse_scalar_encoding(product_id=product_id, raw_encoding=raw.get("encoding"), component_ids=component_ids)
        if kind == PRODUCT_KIND_SCALAR
        else _parse_vector_encoding(product_id=product_id, raw_encoding=raw.get("encoding"), component_ids=component_ids)
    )

    label_raw = raw.get("label")
    label = label_raw.strip() if isinstance(label_raw, str) and label_raw.strip() else None

    return ProductSpec(
        id=product_id,
        kind=str(kind),
        parameter=parameter,
        level=level,
        units=units,
        valid_min=valid_min,
        valid_max=valid_max,
        source_transform=source_transform,
        encoding=encoding,
        components=components,
        label=label,
    )


def parse_model_product_spec(
    *,
    product_id: str,
    raw: Any,
    catalog_product: ProductCatalogSpec,
) -> ModelProductSpec:
    if not isinstance(raw, Mapping):
        raise SystemExit(f"model products entry {product_id!r} must be an object")

    raw_components = raw.get("components")
    if not isinstance(raw_components, list) or not raw_components:
        raise SystemExit(f"model products.{product_id}.components must be a non-empty array")

    matches: dict[str, dict[str, str]] = {}
    for index, raw_component in enumerate(raw_components):
        field_name = f"products.{product_id}.components[{index}]"
        if not isinstance(raw_component, Mapping):
            raise SystemExit(f"{field_name} must be an object")
        component_id = _parse_non_empty_string(raw_component.get("id"), field_name=f"{field_name}.id")
        if component_id in matches:
            raise SystemExit(f"products.{product_id} contains duplicate component id: {component_id!r}")
        matches[component_id] = _parse_grib_match(
            product_id=product_id,
            raw_match=raw_component.get("grib_match"),
            field_name=f"{field_name}.grib_match",
        )

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
        valid_min=catalog_product.valid_min,
        valid_max=catalog_product.valid_max,
        source_transform=catalog_product.source_transform,
        encoding=catalog_product.encoding,
        components=components,
        label=catalog_product.label,
    )


def validate_workload_products(
    *,
    product_ids: tuple[str, ...],
    products: Mapping[str, object],
) -> None:
    seen: set[str] = set()
    for product_id in product_ids:
        if product_id in seen:
            raise SystemExit(f"Duplicate workload product: {product_id!r}")
        seen.add(product_id)
        if product_id not in products:
            raise SystemExit(f"workload.products references unknown product: {product_id!r}")


def parse_layer_groups(
    raw_value: Any,
    *,
    products: Mapping[str, ProductSpec],
    scalar_product_ids: tuple[str, ...],
) -> tuple[LayerGroup, ...]:
    if raw_value is None:
        return _default_layer_groups(scalar_product_ids)
    if not scalar_product_ids:
        raise SystemExit("layer_groups cannot be provided without scalar products")
    if not isinstance(raw_value, list) or not raw_value:
        raise SystemExit("layer_groups must be a non-empty array when provided")

    scalar_product_set = set(scalar_product_ids)
    seen_group_ids: set[str] = set()
    seen_products: set[str] = set()
    groups: list[LayerGroup] = []

    for group_index, raw_group in enumerate(raw_value):
        field_name = f"layer_groups[{group_index}]"
        if not isinstance(raw_group, Mapping):
            raise SystemExit(f"{field_name} must be an object")

        group_id = _parse_non_empty_string(raw_group.get("id"), field_name=f"{field_name}.id")
        if group_id in seen_group_ids:
            raise SystemExit(f"Duplicate layer group id: {group_id!r}")
        seen_group_ids.add(group_id)

        label = _parse_non_empty_string(raw_group.get("label"), field_name=f"{field_name}.label")
        kind = _parse_non_empty_string(raw_group.get("kind"), field_name=f"{field_name}.kind")
        if kind != PRODUCT_KIND_SCALAR:
            raise SystemExit(f"{field_name}.kind must be {PRODUCT_KIND_SCALAR!r}; only scalar layer groups are supported")
        default_product = _parse_non_empty_string(
            raw_group.get("default_product"),
            field_name=f"{field_name}.default_product",
        )
        group_products = _parse_string_tuple(raw_group.get("products"), field_name=f"{field_name}.products")

        if default_product not in group_products:
            raise SystemExit(
                f"{field_name}.default_product {default_product!r} must be included in {field_name}.products"
            )

        for product_id in group_products:
            product = products.get(product_id)
            if product is None or product.kind != PRODUCT_KIND_SCALAR:
                raise SystemExit(f"{field_name}.products references unknown scalar product {product_id!r}")
            if product_id not in scalar_product_set:
                raise SystemExit(f"{field_name}.products references scalar product not in workload.products: {product_id!r}")
            if product_id in seen_products:
                raise SystemExit(f"Scalar product appears in multiple layer groups: {product_id!r}")
            seen_products.add(product_id)

        groups.append(
            LayerGroup(
                id=group_id,
                label=label,
                kind=kind,
                default_product=default_product,
                products=group_products,
            )
        )

    missing_products = sorted(scalar_product_set - seen_products)
    if missing_products:
        raise SystemExit(f"layer_groups missing scalar products: {missing_products!r}")

    return tuple(groups)


def _parse_product_components(*, product_id: str, raw_components: Any) -> tuple[ComponentSpec, ...]:
    if not isinstance(raw_components, list) or not raw_components:
        raise SystemExit(f"Product {product_id!r} field 'components' must be a non-empty array")

    components: list[ComponentSpec] = []
    seen_components: set[str] = set()
    for index, raw_component in enumerate(raw_components):
        field_name = f"Product {product_id!r} components[{index}]"
        if not isinstance(raw_component, Mapping):
            raise SystemExit(f"{field_name} must be an object")
        component_id = _parse_non_empty_string(raw_component.get("id"), field_name=f"{field_name}.id")
        if component_id in seen_components:
            raise SystemExit(f"Product {product_id!r} has duplicate component id: {component_id!r}")
        seen_components.add(component_id)
        grib_match = _parse_grib_match(
            product_id=product_id,
            raw_match=raw_component.get("grib_match"),
            field_name=f"components[{index}].grib_match",
        )
        components.append(ComponentSpec(id=component_id, grib_match=grib_match))

    return tuple(components)


def _parse_product_component_ids(*, product_id: str, raw_components: Any) -> tuple[str, ...]:
    if not isinstance(raw_components, list) or not raw_components:
        raise SystemExit(f"Product {product_id!r} field 'components' must be a non-empty array")

    component_ids: list[str] = []
    seen_components: set[str] = set()
    for index, raw_component in enumerate(raw_components):
        field_name = f"Product {product_id!r} components[{index}]"
        if not isinstance(raw_component, Mapping):
            raise SystemExit(f"{field_name} must be an object")
        component_id = _parse_non_empty_string(raw_component.get("id"), field_name=f"{field_name}.id")
        if component_id in seen_components:
            raise SystemExit(f"Product {product_id!r} has duplicate component id: {component_id!r}")
        if "grib_match" in raw_component:
            raise SystemExit(
                f"Product {product_id!r} component GRIB matches belong in model products, "
                f"not product_catalog"
            )
        seen_components.add(component_id)
        component_ids.append(component_id)

    return tuple(component_ids)


def _parse_grib_match(*, product_id: str, raw_match: Any, field_name: str) -> dict[str, str]:
    if not isinstance(raw_match, Mapping) or not raw_match:
        raise SystemExit(f"Product {product_id!r} field {field_name!r} must be a non-empty object")
    grib_match: dict[str, str] = {}
    for key, value in raw_match.items():
        if not isinstance(key, str) or not key.strip() or not isinstance(value, str) or not value.strip():
            raise SystemExit(
                f"Product {product_id!r} field {field_name!r} must map non-empty strings to non-empty strings"
            )
        grib_match[key.strip()] = value.strip()
    return grib_match


def _parse_scalar_encoding(
    *,
    product_id: str,
    raw_encoding: Any,
    component_ids: tuple[str, ...],
) -> ScalarEncodingSpec:
    if not isinstance(raw_encoding, Mapping):
        raise SystemExit(f"Product {product_id!r} missing required object field 'encoding'")

    for field in ("id", "nodata", "byte_order", "dtype"):
        if field not in raw_encoding:
            raise SystemExit(f"Product {product_id!r} encoding missing required field {field!r}")

    encoding_id = _encoding_id(raw_encoding, product_id=product_id)
    dtype = raw_encoding.get("dtype")
    if dtype not in SCALAR_BYTE_ORDERS_BY_DTYPE:
        raise SystemExit(
            f"Product {product_id!r} encoding.dtype must be one of "
            f"{sorted(SCALAR_BYTE_ORDERS_BY_DTYPE)!r}, got: {dtype!r}"
        )

    format_raw = raw_encoding.get("format")
    if format_raw is not None and not isinstance(format_raw, str):
        raise SystemExit(f"Product {product_id!r} encoding.format must be a string")
    try:
        scalar_format = scalar_format_for_encoding(dtype=str(dtype), explicit_format=format_raw)
    except ValueError as exc:
        raise SystemExit(f"Product {product_id!r} has invalid encoding.format: {exc}") from exc

    byte_order = raw_encoding.get("byte_order")
    allowed_byte_orders = SCALAR_BYTE_ORDERS_BY_DTYPE[str(dtype)]
    if byte_order not in allowed_byte_orders:
        raise SystemExit(
            f"Product {product_id!r} encoding.byte_order must be one of "
            f"{sorted(allowed_byte_orders)!r}, got: {byte_order!r}"
        )

    scale: float | None = None
    offset: float | None = None
    if is_linear_scalar_format(scalar_format):
        if "scale" not in raw_encoding:
            raise SystemExit(f"Product {product_id!r} encoding missing required field 'scale'")
        if "offset" not in raw_encoding:
            raise SystemExit(f"Product {product_id!r} encoding missing required field 'offset'")
        scale = _parse_finite_float(raw_encoding.get("scale"), field_name=f"{product_id}.encoding.scale")
        if scale == 0:
            raise SystemExit(f"Product {product_id!r} encoding.scale must be a finite non-zero number")
        offset = _parse_finite_float(raw_encoding.get("offset"), field_name=f"{product_id}.encoding.offset")

    nodata = raw_encoding.get("nodata")
    min_stored, max_stored = scalar_storage_bounds(str(dtype))
    if not isinstance(nodata, int) or nodata < min_stored or nodata > max_stored:
        raise SystemExit(
            f"Product {product_id!r} encoding.nodata must be a {dtype} integer "
            f"({min_stored}..{max_stored})"
        )
    required_nodata = scalar_required_nodata(scalar_format)
    if required_nodata is not None and nodata != required_nodata:
        raise SystemExit(
            f"Product {product_id!r} encoding.nodata must be {required_nodata} "
            f"for format {scalar_format!r}"
        )

    component_order: str | None = None
    if scalar_format == SCALAR_FORMAT_I8_LINEAR_COMPONENTS:
        if component_ids != SCALAR_CLOUD_LAYER_COMPONENTS:
            raise SystemExit(
                f"Product {product_id!r} components must be "
                f"{list(SCALAR_CLOUD_LAYER_COMPONENTS)!r} for format {SCALAR_FORMAT_I8_LINEAR_COMPONENTS!r}"
            )
        if scale != 5.0:
            raise SystemExit(
                f"Product {product_id!r} encoding.scale must be 5 "
                f"for format {SCALAR_FORMAT_I8_LINEAR_COMPONENTS!r}"
            )
        if offset != 0.0:
            raise SystemExit(
                f"Product {product_id!r} encoding.offset must be 0 "
                f"for format {SCALAR_FORMAT_I8_LINEAR_COMPONENTS!r}"
            )
        if raw_encoding.get("component_order") != SCALAR_COMPONENT_ORDER_LOW_MEDIUM_HIGH:
            raise SystemExit(
                f"Product {product_id!r} encoding.component_order must be "
                f"{SCALAR_COMPONENT_ORDER_LOW_MEDIUM_HIGH!r}"
            )
        component_order = SCALAR_COMPONENT_ORDER_LOW_MEDIUM_HIGH
    else:
        if len(component_ids) != 1:
            raise SystemExit(
                f"Product {product_id!r} scalar format {scalar_format!r} requires exactly one component"
            )
        unexpected_component_fields = sorted(
            field for field in ("components", "component_count", "component_order") if field in raw_encoding
        )
        if unexpected_component_fields:
            raise SystemExit(
                f"Product {product_id!r} encoding component fields are only supported for "
                f"format {SCALAR_FORMAT_I8_LINEAR_COMPONENTS!r}: {unexpected_component_fields!r}"
            )

    return ScalarEncodingSpec(
        id=encoding_id,
        format=scalar_format,
        dtype=str(dtype),
        byte_order=str(byte_order),
        nodata=int(nodata),
        scale=scale,
        offset=offset,
        component_order=component_order,
    )


def _parse_vector_encoding(
    *,
    product_id: str,
    raw_encoding: Any,
    component_ids: tuple[str, ...],
) -> VectorEncodingSpec:
    if not isinstance(raw_encoding, Mapping):
        raise SystemExit(f"Product {product_id!r} missing required object field 'encoding'")

    _encoding_id(raw_encoding, product_id=product_id)
    if component_ids != ("u", "v"):
        raise SystemExit(f"Product {product_id!r} vector components must be ['u', 'v']")

    expected = {
        "format": WIND_FORMAT,
        "dtype": WIND_DTYPE,
        "byte_order": WIND_BYTE_ORDER,
        "scale": WIND_SCALE,
        "offset": WIND_OFFSET,
        "component_order": WIND_COMPONENT_ORDER,
    }
    for field, expected_value in expected.items():
        if raw_encoding.get(field) != expected_value:
            raise SystemExit(
                f"Product {product_id!r} encoding.{field} must be {expected_value!r}, "
                f"got {raw_encoding.get(field)!r}"
            )

    return VectorEncodingSpec(
        id=_encoding_id(raw_encoding, product_id=product_id),
        format=WIND_FORMAT,
        dtype=WIND_DTYPE,
        byte_order=WIND_BYTE_ORDER,
        scale=WIND_SCALE,
        offset=WIND_OFFSET,
        component_order=WIND_COMPONENT_ORDER,
    )


def _parse_source_transform(*, product_id: str, product_kind: str, raw: Mapping[str, Any]) -> str:
    source_transform = raw.get("source_transform", SCALAR_SOURCE_TRANSFORM_IDENTITY)
    if product_kind == PRODUCT_KIND_VECTOR:
        if source_transform != SCALAR_SOURCE_TRANSFORM_IDENTITY:
            raise SystemExit(f"Product {product_id!r} vector source_transform must be 'identity'")
        return SCALAR_SOURCE_TRANSFORM_IDENTITY

    if not isinstance(source_transform, str) or source_transform not in SCALAR_SOURCE_TRANSFORMS:
        raise SystemExit(
            f"Product {product_id!r} source_transform must be one of "
            f"{sorted(SCALAR_SOURCE_TRANSFORMS)!r}"
        )
    return source_transform


def _encoding_id(raw_encoding: Mapping[str, Any], *, product_id: str) -> str:
    raw = raw_encoding.get("id")
    if raw is None:
        raw = raw_encoding.get("encoding_id")
    if not isinstance(raw, str) or not raw.strip():
        raise SystemExit(f"Product {product_id!r} encoding.id must be a non-empty string")
    return raw.strip()


def _default_layer_groups(scalar_product_ids: tuple[str, ...]) -> tuple[LayerGroup, ...]:
    if not scalar_product_ids:
        return ()
    return (
        LayerGroup(
            id=DEFAULT_LAYER_GROUP_ID,
            label=DEFAULT_LAYER_GROUP_LABEL,
            kind=PRODUCT_KIND_SCALAR,
            default_product=scalar_product_ids[0],
            products=scalar_product_ids,
        ),
    )


def _parse_workload_forecast_hours(obj: Mapping[str, Any]) -> tuple[str, ...]:
    raw_forecast_hours = obj.get("forecast_hours")
    raw_start = obj.get("forecast_hour_start")
    raw_end = obj.get("forecast_hour_end")

    has_explicit_hours = raw_forecast_hours is not None
    has_range = raw_start is not None or raw_end is not None

    if has_explicit_hours and has_range:
        raise SystemExit(
            "workload must specify either 'forecast_hours' or "
            "'forecast_hour_start'/'forecast_hour_end', not both"
        )

    if has_explicit_hours:
        return _parse_forecast_hour_list(raw_forecast_hours)

    if raw_start is None or raw_end is None:
        raise SystemExit(
            "workload must specify either 'forecast_hours' or both "
            "'forecast_hour_start' and 'forecast_hour_end'"
        )

    start_hour = _parse_forecast_hour_int(raw_start, field_name="workload.forecast_hour_start")
    end_hour = _parse_forecast_hour_int(raw_end, field_name="workload.forecast_hour_end")
    if end_hour < start_hour:
        raise SystemExit(
            "workload.forecast_hour_end must be greater than or equal to "
            "workload.forecast_hour_start"
        )

    return tuple(_format_forecast_hour(hour) for hour in range(start_hour, end_hour + 1))


def _parse_forecast_hour_list(raw_value: Any) -> tuple[str, ...]:
    if not isinstance(raw_value, list) or not raw_value:
        raise SystemExit("workload.forecast_hours must be a non-empty array")

    normalized: list[str] = []
    for index, raw_hour in enumerate(raw_value):
        normalized.append(
            _format_forecast_hour(
                _parse_forecast_hour_int(raw_hour, field_name=f"workload.forecast_hours[{index}]")
            )
        )

    return tuple(normalized)


def _parse_string_tuple(raw_value: Any, *, field_name: str) -> tuple[str, ...]:
    if not isinstance(raw_value, list) or not raw_value:
        raise SystemExit(f"{field_name} must be a non-empty array")

    values: list[str] = []
    for index, raw_item in enumerate(raw_value):
        if not isinstance(raw_item, str) or not raw_item.strip():
            raise SystemExit(f"{field_name}[{index}] must be a non-empty string")
        values.append(raw_item.strip())

    return tuple(values)


def _parse_unique_string_tuple(raw_value: Any, *, field_name: str) -> tuple[str, ...]:
    values = _parse_string_tuple(raw_value, field_name=field_name)
    seen: set[str] = set()
    for value in values:
        if value in seen:
            raise SystemExit(f"{field_name} contains duplicate value: {value!r}")
        seen.add(value)
    return values


def _parse_non_empty_string(raw_value: Any, *, field_name: str) -> str:
    if not isinstance(raw_value, str) or not raw_value.strip():
        raise SystemExit(f"{field_name} must be a non-empty string")
    return raw_value.strip()


def _parse_finite_float(raw_value: Any, *, field_name: str) -> float:
    if not isinstance(raw_value, (int, float)) or not math.isfinite(float(raw_value)):
        raise SystemExit(f"{field_name} must be a finite number")
    return float(raw_value)


def _parse_forecast_hour_int(raw_value: Any, *, field_name: str) -> int:
    if isinstance(raw_value, bool):
        raise SystemExit(f"{field_name} must be an integer forecast hour")

    if isinstance(raw_value, int):
        value = raw_value
    elif isinstance(raw_value, str) and raw_value.strip():
        try:
            value = int(raw_value.strip(), 10)
        except ValueError as exc:
            raise SystemExit(f"{field_name} must be an integer forecast hour") from exc
    else:
        raise SystemExit(f"{field_name} must be an integer forecast hour")

    if value < 0 or value > 999:
        raise SystemExit(f"{field_name} must be in the range 0..999")

    return value


def _format_forecast_hour(hour: int) -> str:
    return f"{hour:03d}"
