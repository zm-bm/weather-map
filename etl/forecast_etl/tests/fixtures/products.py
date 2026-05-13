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


def cloud_cover_config(
    *,
    parameter: str = "low_clouds",
    label: str = "Low Clouds",
    level: str = "low cloud layer",
    encoding_id: str = "low_clouds_i8_1pct_v1",
    grib_match: dict | None = None,
) -> dict:
    return {
        "label": label,
        "parameter": parameter,
        "level": level,
        "units": "%",
        "valid_min": 0,
        "valid_max": 100,
        "style": {
            "layer_id": "scalar",
            "palette_id": "cloud.cover.percent.v1",
        },
        "source_transform": "identity",
        "encoding": {
            "id": encoding_id,
            "format": "linear-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "scale": 1,
            "offset": 50,
            "nodata": -128,
        },
        "components": [
            {"id": "value", "grib_match": grib_match or {"GRIB_ELEMENT": "LCDC"}},
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


def precip_rate_config() -> dict:
    return {
        "parameter": "prate",
        "level": "surface",
        "units": "mm/hr",
        "valid_min": 0,
        "valid_max": 30,
        "style": {
            "layer_id": "scalar",
            "palette_id": "precip.rate.mm_hr.v1",
        },
        "source_transform": "kg_m2_s_to_mm_hr",
        "encoding": {
            "id": "prate_surface_i8_0p15mmhr_v1",
            "format": "linear-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "scale": 0.15,
            "offset": 19.05,
            "nodata": -128,
        },
        "components": [
            {"id": "value", "grib_match": {"ICON_PARAM": "tot_prec"}},
        ],
        "temporal": {
            "kind": "average_rate",
            "source_interval_hours": 1,
        },
        "derivation": {
            "type": "icon_tot_prec_delta_rate",
            "first_hour_previous": "zero",
        },
    }
