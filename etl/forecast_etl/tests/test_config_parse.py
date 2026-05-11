from __future__ import annotations

import json
import unittest
from pathlib import Path

from forecast_etl.config.parse import parse_pipeline_config
from forecast_etl.tests.fixtures.pipeline import catalog_product, minimal_pipeline_config, model_product
from forecast_etl.tests.fixtures.products import (
    cloud_layers_config,
    minimal_product_config,
    precip_total_config,
    wind_product_config,
)


def _gfs(cfg: dict) -> dict:
    return cfg["models"]["gfs"]


def _add_model_product(cfg: dict, product_id: str, product_config: dict) -> None:
    cfg["product_catalog"][product_id] = catalog_product(product_config)
    _gfs(cfg)["products"][product_id] = model_product(product_config)


class ConfigValidationTest(unittest.TestCase):
    def test_default_config_parses_icon_dwd_v1_products(self) -> None:
        cfg_path = Path(__file__).resolve().parents[2] / "forecast.etl_config.json"
        parsed = parse_pipeline_config(json.loads(cfg_path.read_text(encoding="utf-8")))
        icon = parsed.model("icon")

        expected_products = (
            "tmp_surface",
            "gust_surface",
            "dewpoint_surface",
            "rh_surface",
            "prmsl_surface",
            "tcdc",
            "cloud_layers",
            "precip_total_surface",
            "wind10m_uv",
        )
        self.assertEqual(icon.source.type, "icon_dwd_icosahedral")
        self.assertEqual(icon.workload.forecast_hours, tuple(f"{hour:03d}" for hour in range(1, 25)))
        self.assertEqual(icon.workload.products, expected_products)
        self.assertNotIn("aptmp_surface", icon.workload.products)
        self.assertEqual(icon.products["tmp_surface"].label, "Temperature")
        self.assertEqual(icon.products["gust_surface"].label, "Wind Gust")
        self.assertEqual(icon.products["dewpoint_surface"].label, "Dew Point")
        self.assertEqual(icon.products["rh_surface"].label, "Relative Humidity")
        self.assertEqual(icon.products["prmsl_surface"].label, "Pressure")
        self.assertEqual(icon.products["tcdc"].label, "Total Cloud Cover")
        self.assertEqual(icon.products["cloud_layers"].label, "Cloud Layers")
        self.assertEqual(icon.products["precip_total_surface"].label, "Accumulated Precipitation")

        groups = {group.id: group for group in icon.product_groups}
        self.assertEqual(groups["clouds"].default_product, "tcdc")
        self.assertEqual(groups["clouds"].products, ("tcdc", "cloud_layers"))
        self.assertEqual(groups["precipitation"].products, ("precip_total_surface",))

    def test_pipeline_config_parses_forecast_hour_range(self) -> None:
        parsed = parse_pipeline_config(minimal_pipeline_config())
        model = parsed.model("gfs")
        self.assertEqual(model.workload.forecast_hours, ("000",))
        self.assertEqual(model.workload.products, ("tmp_surface",))
        self.assertIn("tmp_surface", model.products)
        self.assertEqual(model.products["tmp_surface"].component_ids, ("value",))
        self.assertEqual(model.products["tmp_surface"].style.layer_id, "scalar")
        self.assertEqual(model.products["tmp_surface"].style.palette_id, "temperature.air.c.v1")
        self.assertEqual(model.product_groups[0].id, "temperature")
        self.assertEqual(model.product_groups[0].layer_id, "scalar")
        self.assertEqual(model.product_groups[0].default_product, "tmp_surface")

    def test_pipeline_config_parses_icon_dwd_icosahedral_model(self) -> None:
        cfg = minimal_pipeline_config()
        precip_config = precip_total_config()
        wind_config = wind_product_config()
        cfg["product_catalog"]["precip_total_surface"] = catalog_product(precip_config)
        cfg["product_catalog"]["wind10m_uv"] = catalog_product(wind_config)
        cfg["models"]["icon"] = {
            "label": "ICON",
            "source": {
                "type": "icon_dwd_icosahedral",
                "grid_id": "icon_global_regridded_0p125",
                "base_url": "https://opendata.dwd.de/weather/nwp/icon/grib",
                "rate_limit_seconds": 0.0,
            },
            "workload": {
                "forecast_hour_start": 0,
                "forecast_hour_end": 0,
                "products": ["precip_total_surface", "wind10m_uv"],
            },
            "products": {
                "precip_total_surface": model_product(precip_config),
                "wind10m_uv": {
                    "components": [
                        {"id": "u", "grib_match": {"ICON_PARAM": "u_10m"}},
                        {"id": "v", "grib_match": {"ICON_PARAM": "v_10m"}},
                    ],
                },
            },
            "product_groups": [
                {
                    "id": "precipitation",
                    "label": "Precipitation",
                    "layer_id": "scalar",
                    "default_product": "precip_total_surface",
                    "products": ["precip_total_surface"],
                },
            ],
        }

        parsed = parse_pipeline_config(cfg)
        icon = parsed.model("icon")

        self.assertEqual(icon.source.type, "icon_dwd_icosahedral")
        self.assertIsNotNone(icon.source.icon_dwd)
        self.assertEqual(icon.workload.products, ("precip_total_surface", "wind10m_uv"))
        self.assertEqual(icon.products["wind10m_uv"].components[1].grib_match["ICON_PARAM"], "v_10m")

    def test_pipeline_config_rejects_icon_dwd_product_without_icon_param(self) -> None:
        cfg = minimal_pipeline_config()
        cfg["models"]["icon"] = {
            "label": "ICON",
            "source": {
                "type": "icon_dwd_icosahedral",
                "grid_id": "icon_global_regridded_0p125",
                "base_url": "https://opendata.dwd.de/weather/nwp/icon/grib",
                "rate_limit_seconds": 0.0,
            },
            "workload": {
                "forecast_hour_start": 0,
                "forecast_hour_end": 0,
                "products": ["tmp_surface"],
            },
            "products": {
                "tmp_surface": {
                    "components": [
                        {"id": "value", "grib_match": {"GRIB_ELEMENT": "TMP"}},
                    ],
                },
            },
            "product_groups": [
                {
                    "id": "temperature",
                    "label": "Temperature",
                    "layer_id": "scalar",
                    "default_product": "tmp_surface",
                    "products": ["tmp_surface"],
                },
            ],
        }

        with self.assertRaises(SystemExit):
            parse_pipeline_config(cfg)

    def test_pipeline_config_rejects_invalid_forecast_hour_range(self) -> None:
        bad_cfg = minimal_pipeline_config()
        _gfs(bad_cfg)["workload"]["forecast_hour_start"] = 12
        _gfs(bad_cfg)["workload"]["forecast_hour_end"] = 6

        with self.assertRaises(SystemExit):
            parse_pipeline_config(bad_cfg)

    def test_pipeline_config_rejects_regrid_image_source_field(self) -> None:
        bad_cfg = minimal_pipeline_config()
        _gfs(bad_cfg)["source"]["regrid_image"] = "deutscherwetterdienst/regrid:icon"

        with self.assertRaises(SystemExit) as raised:
            parse_pipeline_config(bad_cfg)

        self.assertIn("regrid_image", str(raised.exception))

    def test_pipeline_config_rejects_duplicate_workload_product(self) -> None:
        bad_cfg = minimal_pipeline_config()
        _gfs(bad_cfg)["workload"]["products"] = ["tmp_surface", "tmp_surface"]

        with self.assertRaises(SystemExit):
            parse_pipeline_config(bad_cfg)

    def test_pipeline_config_rejects_unknown_workload_product(self) -> None:
        bad_cfg = minimal_pipeline_config()
        _gfs(bad_cfg)["workload"]["products"] = ["missing_surface"]

        with self.assertRaises(SystemExit):
            parse_pipeline_config(bad_cfg)

    def test_pipeline_config_rejects_invalid_source_transform(self) -> None:
        bad_cfg = minimal_pipeline_config()
        bad_cfg["product_catalog"]["tmp_surface"]["source_transform"] = "bogus_transform"

        with self.assertRaises(SystemExit):
            parse_pipeline_config(bad_cfg)

    def test_pipeline_config_accepts_precipitation_rate_source_transform(self) -> None:
        cfg = minimal_pipeline_config()
        cfg["product_catalog"]["tmp_surface"]["source_transform"] = "kg_m2_s_to_mm_hr"

        parsed = parse_pipeline_config(cfg)

        self.assertEqual(
            parsed.model("gfs").products["tmp_surface"].source_transform,
            "kg_m2_s_to_mm_hr",
        )

    def test_pipeline_config_accepts_temperature_piecewise_encoding_without_scale_offset(self) -> None:
        cfg = minimal_pipeline_config()
        cfg["product_catalog"]["tmp_surface"]["encoding"] = {
            "id": "tmp_surface_i8_temp_c_piecewise_v1",
            "format": "temp-c-piecewise-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "nodata": -128,
        }

        parsed = parse_pipeline_config(cfg)

        self.assertEqual(
            parsed.model("gfs").products["tmp_surface"].encoding.format,
            "temp-c-piecewise-i8-v1",
        )

    def test_pipeline_config_rejects_invalid_encoding_format_names(self) -> None:
        bad_cfg = minimal_pipeline_config()
        bad_cfg["product_catalog"]["tmp_surface"]["encoding"]["format"] = "scalar-i16-linear-v1"

        with self.assertRaises(SystemExit):
            parse_pipeline_config(bad_cfg)

    def test_pipeline_config_accepts_packed_cloud_component_scalar(self) -> None:
        cfg = minimal_pipeline_config()
        _add_model_product(cfg, "cloud_layers", cloud_layers_config())
        _gfs(cfg)["workload"]["products"] = ["tmp_surface", "cloud_layers"]
        _gfs(cfg)["product_groups"] = [
            {
                "id": "temperature",
                "label": "Temperature",
                "layer_id": "scalar",
                "default_product": "tmp_surface",
                "products": ["tmp_surface"],
            },
            {
                "id": "clouds",
                "label": "Clouds",
                "layer_id": "scalar",
                "default_product": "cloud_layers",
                "products": ["cloud_layers"],
            },
        ]

        parsed = parse_pipeline_config(cfg)

        self.assertEqual(
            parsed.model("gfs").products["cloud_layers"].encoding.format,
            "linear-i8-v1",
        )
        self.assertEqual(
            parsed.model("gfs").products["cloud_layers"].components[1].grib_match["GRIB_ELEMENT"],
            "MCDC",
        )

    def test_pipeline_config_rejects_model_product_missing_component_match(self) -> None:
        cfg = minimal_pipeline_config()
        _add_model_product(cfg, "cloud_layers", cloud_layers_config())
        _gfs(cfg)["workload"]["products"] = ["cloud_layers"]
        _gfs(cfg)["product_groups"] = [
            {
                "id": "clouds",
                "label": "Clouds",
                "layer_id": "scalar",
                "default_product": "cloud_layers",
                "products": ["cloud_layers"],
            },
        ]
        del _gfs(cfg)["products"]["cloud_layers"]["components"][1]["grib_match"]

        with self.assertRaises(SystemExit):
            parse_pipeline_config(cfg)

    def test_pipeline_config_rejects_model_product_with_unknown_component(self) -> None:
        cfg = minimal_pipeline_config()
        _add_model_product(cfg, "cloud_layers", cloud_layers_config())
        _gfs(cfg)["workload"]["products"] = ["cloud_layers"]
        _gfs(cfg)["product_groups"] = [
            {
                "id": "clouds",
                "label": "Clouds",
                "layer_id": "scalar",
                "default_product": "cloud_layers",
                "products": ["cloud_layers"],
            },
        ]
        _gfs(cfg)["products"]["cloud_layers"]["components"].append(
            {"id": "ceiling", "grib_match": {"GRIB_ELEMENT": "CEIL"}}
        )

        with self.assertRaises(SystemExit):
            parse_pipeline_config(cfg)

    def test_pipeline_config_rejects_product_group_missing_workload_product(self) -> None:
        cfg = minimal_pipeline_config()
        rh_config = {**minimal_product_config(), "parameter": "rh"}
        _add_model_product(cfg, "rh_surface", rh_config)
        _gfs(cfg)["workload"]["products"] = ["tmp_surface", "rh_surface"]

        with self.assertRaises(SystemExit):
            parse_pipeline_config(cfg)

    def test_pipeline_config_rejects_product_group_default_outside_group(self) -> None:
        cfg = minimal_pipeline_config()
        _gfs(cfg)["product_groups"][0]["default_product"] = "rh_surface"

        with self.assertRaises(SystemExit):
            parse_pipeline_config(cfg)

    def test_pipeline_config_rejects_product_group_unknown_product(self) -> None:
        cfg = minimal_pipeline_config()
        _gfs(cfg)["product_groups"][0]["products"] = ["missing_surface"]
        _gfs(cfg)["product_groups"][0]["default_product"] = "missing_surface"

        with self.assertRaises(SystemExit):
            parse_pipeline_config(cfg)

    def test_pipeline_config_rejects_product_group_invalid_or_mismatched_layer_id(self) -> None:
        empty_layer = minimal_pipeline_config()
        _gfs(empty_layer)["product_groups"][0]["layer_id"] = ""

        with self.assertRaises(SystemExit):
            parse_pipeline_config(empty_layer)

        mismatched_layer = minimal_pipeline_config()
        _gfs(mismatched_layer)["product_groups"][0]["layer_id"] = "vector"

        with self.assertRaises(SystemExit):
            parse_pipeline_config(mismatched_layer)

    def test_pipeline_config_rejects_product_group_duplicate_product(self) -> None:
        cfg = minimal_pipeline_config()
        _gfs(cfg)["product_groups"].append(
            {
                "id": "duplicate",
                "label": "Duplicate",
                "layer_id": "scalar",
                "default_product": "tmp_surface",
                "products": ["tmp_surface"],
            }
        )

        with self.assertRaises(SystemExit):
            parse_pipeline_config(cfg)
