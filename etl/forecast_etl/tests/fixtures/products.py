from __future__ import annotations

from forecast_etl.config.resolved import ProductGroup, ProductSpec
from forecast_etl.config.validate import parse_product_spec


def product_spec(product_id: str, raw: dict) -> ProductSpec:
    return parse_product_spec(product_id=product_id, raw=raw)


def product_specs(raw_products: dict[str, dict]) -> dict[str, ProductSpec]:
    return {
        product_id: product_spec(product_id, product_config)
        for product_id, product_config in raw_products.items()
    }


def product_group(
    *,
    group_id: str,
    label: str,
    default_product: str,
    products: list[str],
) -> ProductGroup:
    return ProductGroup(
        id=group_id,
        label=label,
        layer_id="scalar",
        default_product=default_product,
        products=tuple(products),
    )


def minimal_product_config() -> dict:
    return {
        "parameter": "tmp",
        "level": "surface",
        "units": "C",
        "valid_min": -45,
        "valid_max": 50,
        "style": {
            "layer_id": "scalar",
            "palette_id": "temperature.air.c.v1",
        },
        "source_transform": "identity",
        "encoding": {
            "id": "tmp_surface_i16_v1",
            "format": "linear-i16-v1",
            "dtype": "int16",
            "byte_order": "little",
            "scale": 0.01,
            "offset": 0.0,
            "nodata": -32768,
        },
        "components": [
            {
                "id": "value",
                "grib_match": {
                    "GRIB_ELEMENT": "TMP",
                    "GRIB_SHORT_NAME": "2-HTGL",
                },
            }
        ],
    }


def cloud_layers_config() -> dict:
    return {
        "parameter": "cloud_layers",
        "level": "low/medium/high cloud layers",
        "units": "%",
        "valid_min": 0,
        "valid_max": 100,
        "style": {
            "layer_id": "scalar",
            "palette_id": "cloud.layers.percent.v1",
        },
        "source_transform": "identity",
        "encoding": {
            "id": "cloud_layers_i8_5pct_components_v1",
            "format": "linear-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "scale": 5,
            "offset": 0,
            "nodata": -128,
        },
        "components": [
            {"id": "low", "grib_match": {"GRIB_ELEMENT": "LCDC"}},
            {"id": "medium", "grib_match": {"GRIB_ELEMENT": "MCDC"}},
            {"id": "high", "grib_match": {"GRIB_ELEMENT": "HCDC"}},
        ],
    }


def wind_product_config() -> dict:
    return {
        "parameter": "wind_uv",
        "level": "10m_above_ground",
        "units": "m/s",
        "valid_min": -64.0,
        "valid_max": 63.5,
        "style": {
            "layer_id": "vector",
            "palette_id": "wind.vector.mps.v1",
        },
        "encoding": {
            "id": "wind10m_uv_vector_i8_v1",
            "format": "linear-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "scale": 0.5,
            "offset": 0.0,
        },
        "components": [
            {"id": "u", "grib_match": {"GRIB_ELEMENT": "UGRD"}},
            {"id": "v", "grib_match": {"GRIB_ELEMENT": "VGRD"}},
        ],
    }


def precip_total_config() -> dict:
    return {
        "parameter": "precip_total",
        "level": "surface",
        "units": "mm",
        "valid_min": 0,
        "valid_max": 254,
        "style": {
            "layer_id": "scalar",
            "palette_id": "precip.total.mm.v1",
        },
        "source_transform": "identity",
        "encoding": {
            "id": "precip_total_surface_i8_1mm_v1",
            "format": "linear-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "scale": 1,
            "offset": 127,
            "nodata": -128,
        },
        "components": [
            {"id": "value", "grib_match": {"ICON_PARAM": "tot_prec"}},
        ],
    }
