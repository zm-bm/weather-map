from __future__ import annotations

import unittest

from forecast_etl.config.parse import parse_pipeline_config
from forecast_etl.tests.product_test_helpers import (
    _catalog_product,
    _cloud_layers_config,
    _minimal_layer_config,
    _minimal_pipeline_config,
    _product_binding,
    _small_grid_meta_fixture,
)


def _gfs(cfg: dict) -> dict:
    return cfg["models"]["gfs"]


def _add_model_product(cfg: dict, product_id: str, product_config: dict) -> None:
    cfg["product_catalog"][product_id] = _catalog_product(product_config)
    _gfs(cfg)["product_bindings"][product_id] = _product_binding(product_config)


class ConfigValidationTest(unittest.TestCase):
    def test_pipeline_config_parses_forecast_hour_range(self) -> None:
        parsed = parse_pipeline_config(_minimal_pipeline_config())
        model = parsed.model("gfs")
        self.assertEqual(model.workload.forecast_hours, ("000",))
        self.assertEqual(model.workload.products, ("tmp_surface",))
        self.assertIn("tmp_surface", model.products)
        self.assertEqual(model.scalar_variable_groups[0].id, "temperature")
        self.assertEqual(model.scalar_variable_groups[0].default_variable, "tmp_surface")

    def test_pipeline_config_parses_icon_zero_placeholder_model(self) -> None:
        cfg = _minimal_pipeline_config()
        product_config = _cloud_layers_config()
        cfg["product_catalog"]["cloud_layers"] = _catalog_product(product_config)
        cfg["models"]["icon"] = {
            "label": "ICON",
            "source": {
                "type": "zero_placeholder",
                "grid_id": "icon_zero_placeholder",
                "grid": _small_grid_meta_fixture(),
            },
            "workload": {
                "forecast_hours": ["000"],
                "products": ["cloud_layers"],
            },
            "product_bindings": {
                "cloud_layers": {
                    "components": [
                        {"id": "low", "grib_match": {"ZERO_COMPONENT": "cloud_layers.low"}},
                        {"id": "medium", "grib_match": {"ZERO_COMPONENT": "cloud_layers.medium"}},
                        {"id": "high", "grib_match": {"ZERO_COMPONENT": "cloud_layers.high"}},
                    ],
                },
            },
            "scalar_variable_groups": [
                {
                    "id": "clouds",
                    "label": "Clouds",
                    "default_variable": "cloud_layers",
                    "variables": ["cloud_layers"],
                },
            ],
        }

        parsed = parse_pipeline_config(cfg)
        icon = parsed.model("icon")
        self.assertEqual(icon.label, "ICON")
        self.assertEqual(icon.source.type, "zero_placeholder")
        self.assertEqual(icon.source.grid_id, "icon_zero_placeholder")
        self.assertEqual(icon.workload.products, ("cloud_layers",))
        self.assertEqual(icon.products["cloud_layers"].components[1].grib_match["ZERO_COMPONENT"], "cloud_layers.medium")

    def test_pipeline_config_accepts_explicit_forecast_hours(self) -> None:
        cfg = _minimal_pipeline_config()
        _gfs(cfg)["workload"] = {
            "forecast_hours": ["000", "003", "006"],
            "products": ["tmp_surface"],
        }

        parsed = parse_pipeline_config(cfg)

        self.assertEqual(parsed.model("gfs").workload.forecast_hours, ("000", "003", "006"))

    def test_pipeline_config_rejects_old_single_model_schema(self) -> None:
        bad_cfg = {
            "workload": {"forecast_hour_start": 0, "forecast_hour_end": 0, "products": ["tmp_surface"]},
            "products": {"tmp_surface": _minimal_layer_config()},
        }

        with self.assertRaises(SystemExit):
            parse_pipeline_config(bad_cfg)

    def test_pipeline_config_rejects_invalid_forecast_hour_range(self) -> None:
        bad_cfg = _minimal_pipeline_config()
        _gfs(bad_cfg)["workload"]["forecast_hour_start"] = 12
        _gfs(bad_cfg)["workload"]["forecast_hour_end"] = 6

        with self.assertRaises(SystemExit):
            parse_pipeline_config(bad_cfg)

    def test_pipeline_config_rejects_duplicate_workload_product(self) -> None:
        bad_cfg = _minimal_pipeline_config()
        _gfs(bad_cfg)["workload"]["products"] = ["tmp_surface", "tmp_surface"]

        with self.assertRaises(SystemExit):
            parse_pipeline_config(bad_cfg)

    def test_pipeline_config_rejects_unknown_workload_product(self) -> None:
        bad_cfg = _minimal_pipeline_config()
        _gfs(bad_cfg)["workload"]["products"] = ["missing_surface"]

        with self.assertRaises(SystemExit):
            parse_pipeline_config(bad_cfg)

    def test_pipeline_config_requires_model_source_grid_id(self) -> None:
        bad_cfg = _minimal_pipeline_config()
        del _gfs(bad_cfg)["source"]["grid_id"]

        with self.assertRaises(SystemExit):
            parse_pipeline_config(bad_cfg)

    def test_pipeline_config_requires_product_encoding(self) -> None:
        bad_cfg = _minimal_pipeline_config()
        del bad_cfg["product_catalog"]["tmp_surface"]["encoding"]

        with self.assertRaises(SystemExit):
            parse_pipeline_config(bad_cfg)

    def test_pipeline_config_rejects_grib_match_in_product_catalog(self) -> None:
        bad_cfg = _minimal_pipeline_config()
        bad_cfg["product_catalog"]["tmp_surface"]["components"][0]["grib_match"] = {"GRIB_ELEMENT": "TMP"}

        with self.assertRaises(SystemExit):
            parse_pipeline_config(bad_cfg)

    def test_pipeline_config_rejects_invalid_source_transform(self) -> None:
        bad_cfg = _minimal_pipeline_config()
        bad_cfg["product_catalog"]["tmp_surface"]["source_transform"] = "bogus_transform"

        with self.assertRaises(SystemExit):
            parse_pipeline_config(bad_cfg)

    def test_pipeline_config_accepts_precipitation_rate_source_transform(self) -> None:
        cfg = _minimal_pipeline_config()
        cfg["product_catalog"]["tmp_surface"]["source_transform"] = "kg_m2_s_to_mm_hr"

        parsed = parse_pipeline_config(cfg)

        self.assertEqual(
            parsed.model("gfs").products["tmp_surface"].source_transform,
            "kg_m2_s_to_mm_hr",
        )

    def test_pipeline_config_accepts_temperature_piecewise_encoding_without_scale_offset(self) -> None:
        cfg = _minimal_pipeline_config()
        cfg["product_catalog"]["tmp_surface"]["encoding"] = {
            "id": "tmp_surface_i8_temp_c_piecewise_v1",
            "format": "scalar-i8-temp-c-piecewise-v1",
            "dtype": "int8",
            "byte_order": "none",
            "nodata": -128,
        }

        parsed = parse_pipeline_config(cfg)

        self.assertEqual(
            parsed.model("gfs").products["tmp_surface"].encoding.format,
            "scalar-i8-temp-c-piecewise-v1",
        )

    def test_pipeline_config_accepts_packed_cloud_component_scalar(self) -> None:
        cfg = _minimal_pipeline_config()
        _add_model_product(cfg, "cloud_layers", _cloud_layers_config())
        _gfs(cfg)["workload"]["products"] = ["tmp_surface", "cloud_layers"]
        _gfs(cfg)["scalar_variable_groups"] = [
            {
                "id": "temperature",
                "label": "Temperature",
                "default_variable": "tmp_surface",
                "variables": ["tmp_surface"],
            },
            {
                "id": "clouds",
                "label": "Clouds",
                "default_variable": "cloud_layers",
                "variables": ["cloud_layers"],
            },
        ]

        parsed = parse_pipeline_config(cfg)

        self.assertEqual(
            parsed.model("gfs").products["cloud_layers"].encoding.format,
            "scalar-i8-linear-components-v1",
        )
        self.assertEqual(
            parsed.model("gfs").products["cloud_layers"].components[1].grib_match["GRIB_ELEMENT"],
            "MCDC",
        )

    def test_pipeline_config_rejects_binding_missing_component_match(self) -> None:
        cfg = _minimal_pipeline_config()
        _add_model_product(cfg, "cloud_layers", _cloud_layers_config())
        _gfs(cfg)["workload"]["products"] = ["cloud_layers"]
        _gfs(cfg)["scalar_variable_groups"] = [
            {
                "id": "clouds",
                "label": "Clouds",
                "default_variable": "cloud_layers",
                "variables": ["cloud_layers"],
            },
        ]
        del _gfs(cfg)["product_bindings"]["cloud_layers"]["components"][1]["grib_match"]

        with self.assertRaises(SystemExit):
            parse_pipeline_config(cfg)

    def test_pipeline_config_rejects_binding_with_unknown_component(self) -> None:
        cfg = _minimal_pipeline_config()
        _add_model_product(cfg, "cloud_layers", _cloud_layers_config())
        _gfs(cfg)["workload"]["products"] = ["cloud_layers"]
        _gfs(cfg)["scalar_variable_groups"] = [
            {
                "id": "clouds",
                "label": "Clouds",
                "default_variable": "cloud_layers",
                "variables": ["cloud_layers"],
            },
        ]
        _gfs(cfg)["product_bindings"]["cloud_layers"]["components"].append(
            {"id": "ceiling", "grib_match": {"GRIB_ELEMENT": "CEIL"}}
        )

        with self.assertRaises(SystemExit):
            parse_pipeline_config(cfg)

    def test_pipeline_config_rejects_scalar_group_missing_workload_variable(self) -> None:
        cfg = _minimal_pipeline_config()
        rh_config = {**_minimal_layer_config(), "parameter": "rh"}
        _add_model_product(cfg, "rh_surface", rh_config)
        _gfs(cfg)["workload"]["products"] = ["tmp_surface", "rh_surface"]

        with self.assertRaises(SystemExit):
            parse_pipeline_config(cfg)

    def test_pipeline_config_rejects_scalar_group_default_outside_group(self) -> None:
        cfg = _minimal_pipeline_config()
        _gfs(cfg)["scalar_variable_groups"][0]["default_variable"] = "rh_surface"

        with self.assertRaises(SystemExit):
            parse_pipeline_config(cfg)

    def test_pipeline_config_rejects_scalar_group_unknown_variable(self) -> None:
        cfg = _minimal_pipeline_config()
        _gfs(cfg)["scalar_variable_groups"][0]["variables"] = ["missing_surface"]
        _gfs(cfg)["scalar_variable_groups"][0]["default_variable"] = "missing_surface"

        with self.assertRaises(SystemExit):
            parse_pipeline_config(cfg)

    def test_pipeline_config_rejects_scalar_group_duplicate_variable(self) -> None:
        cfg = _minimal_pipeline_config()
        _gfs(cfg)["scalar_variable_groups"].append(
            {
                "id": "duplicate",
                "label": "Duplicate",
                "default_variable": "tmp_surface",
                "variables": ["tmp_surface"],
            }
        )

        with self.assertRaises(SystemExit):
            parse_pipeline_config(cfg)
