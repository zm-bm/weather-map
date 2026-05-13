from __future__ import annotations

from .products import minimal_product_config


def minimal_pipeline_config() -> dict:
    product = minimal_product_config()
    return {
        "version": 2,
        "product_catalog": {
            "tmp_surface": catalog_product(product),
        },
        "models": {
            "gfs": {
                "label": "GFS",
                "source": {
                    "type": "gfs_nomads",
                    "grid_id": "gfs_0p25_global",
                    "base_url": "https://example.test",
                    "vars_levels": {},
                    "rate_limit_seconds": 0.0,
                },
                "workload": {
                    "forecast_hour_start": 0,
                    "forecast_hour_end": 0,
                    "products": ["tmp_surface"],
                },
                "products": {
                    "tmp_surface": model_product(product),
                },
            },
        },
    }


def add_model_product(
    cfg: dict,
    *,
    model_id: str,
    product_id: str,
    product_config: dict,
) -> None:
    cfg["product_catalog"][product_id] = catalog_product(product_config)
    cfg["models"][model_id]["products"][product_id] = model_product(product_config)


def catalog_product(product_config: dict) -> dict:
    return {
        **{
            key: value
            for key, value in product_config.items()
            if key not in {"components", "temporal", "derivation"}
        },
        "components": [{"id": component["id"]} for component in product_config["components"]],
    }


def model_product(product_config: dict) -> dict:
    model_cfg = {
        "components": [
            {
                "id": component["id"],
                "grib_match": component["grib_match"],
            }
            for component in product_config["components"]
        ],
    }
    if "temporal" in product_config:
        model_cfg["temporal"] = product_config["temporal"]
    if "derivation" in product_config:
        model_cfg["derivation"] = product_config["derivation"]
    return model_cfg
