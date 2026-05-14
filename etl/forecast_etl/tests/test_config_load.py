from __future__ import annotations

import json
import unittest
from pathlib import Path

from forecast_etl.config.load import parse_pipeline_config
from forecast_etl.config.resolved import IconDwdSourceConfig
from forecast_etl.tests.fixtures.pipeline import (
    add_model_product,
    catalog_product,
    minimal_pipeline_config,
    model_product,
)
from forecast_etl.tests.fixtures.products import (
    cloud_cover_config,
    phase_rate_config,
    precip_rate_config,
    precip_total_config,
    precip_type_config,
    thunderstorm_mask_config,
    wind_product_config,
)


def _gfs(cfg: dict) -> dict:
    return cfg["models"]["gfs"]


class ConfigValidationTest(unittest.TestCase):
    def test_default_config_parses_icon_dwd_v1_products(self) -> None:
        cfg_path = Path(__file__).resolve().parents[2] / "forecast.etl_config.json"
        parsed = parse_pipeline_config(json.loads(cfg_path.read_text(encoding="utf-8")))
        icon = parsed.model("icon")

        expected_icon_products = (
            "tmp_surface",
            "gust_surface",
            "dewpoint_surface",
            "rh_surface",
            "prmsl_surface",
            "tcdc",
            "low_clouds",
            "medium_clouds",
            "high_clouds",
            "prate_surface",
            "rain_rate_surface",
            "snow_rate_surface",
            "wintry_mix_rate_surface",
            "precip_total_surface",
            "precip_type_surface",
            "thunderstorm_mask",
            "snow_depth_surface",
            "freezing_level",
            "precipitable_water",
            "cape_index",
            "wind10m_uv",
        )
        expected_gfs_products = (
            "tmp_surface",
            "aptmp_surface",
            "gust_surface",
            "dewpoint_surface",
            "rh_surface",
            "prmsl_surface",
            "tcdc",
            "low_clouds",
            "medium_clouds",
            "high_clouds",
            "prate_surface",
            "rain_rate_surface",
            "snow_rate_surface",
            "wintry_mix_rate_surface",
            "precip_type_surface",
            "snow_depth_surface",
            "visibility_surface",
            "freezing_level",
            "precipitable_water",
            "cape_index",
            "wind10m_uv",
        )
        gfs = parsed.model("gfs")
        self.assertEqual(icon.source.type, "icon_dwd_icosahedral")
        self.assertEqual(icon.workload.forecast_hours, tuple(f"{hour:03d}" for hour in range(1, 25)))
        self.assertEqual(icon.workload.products, expected_icon_products)
        self.assertEqual(gfs.workload.products, expected_gfs_products)
        self.assertNotIn("aptmp_surface", icon.workload.products)
        self.assertNotIn("visibility_surface", icon.workload.products)
        self.assertNotIn("visibility_surface", icon.products)
        self.assertNotIn("thunderstorm_mask", gfs.workload.products)
        self.assertNotIn("thunderstorm_mask", gfs.products)
        self.assertEqual(icon.products["tmp_surface"].kind, "scalar")
        self.assertEqual(icon.products["gust_surface"].kind, "scalar")
        self.assertEqual(icon.products["wind10m_uv"].kind, "vector")
        icon_prate_temporal = icon.products["prate_surface"].temporal
        icon_prate_derivation = icon.products["prate_surface"].derivation
        gfs_prate_temporal = gfs.products["prate_surface"].temporal
        assert icon_prate_temporal is not None
        assert icon_prate_derivation is not None
        assert gfs_prate_temporal is not None
        self.assertEqual(icon_prate_temporal.kind, "average_rate")
        self.assertEqual(icon_prate_temporal.source_interval_hours, 1)
        self.assertEqual(icon_prate_derivation.type, "icon_tot_prec_delta_rate")
        self.assertIsNone(icon.products["prate_surface"].components[0].grib_match)
        self.assertEqual(icon_prate_derivation.inputs[0].id, "total")
        self.assertEqual(icon_prate_derivation.inputs[0].grib_match["ICON_PARAM"], "tot_prec")
        self.assertEqual(
            gfs.products["prate_surface"].components[0].grib_match["GRIB_PDS_PDTN"],
            "0",
        )
        self.assertEqual(gfs_prate_temporal.kind, "instantaneous_rate")
        self.assertEqual(gfs.products["rain_rate_surface"].derivation.type, "phase_rate_from_gfs_prate_categories")
        self.assertEqual(gfs.products["snow_rate_surface"].derivation.phase, "snow")
        self.assertEqual(gfs.products["wintry_mix_rate_surface"].derivation.phase, "wintry_mix")
        self.assertEqual(icon.products["rain_rate_surface"].derivation.type, "phase_rate_from_icon_tot_prec_ww")
        self.assertEqual(icon.products["rain_rate_surface"].derivation.inputs[0].id, "total")
        self.assertEqual(icon.products["rain_rate_surface"].derivation.inputs[1].id, "ww")
        self.assertEqual(icon.products["wintry_mix_rate_surface"].temporal.kind, "average_rate")
        self.assertEqual(gfs.products["snow_depth_surface"].components[0].grib_match["GRIB_ELEMENT"], "SNOD")
        self.assertEqual(gfs.products["visibility_surface"].components[0].grib_match["GRIB_ELEMENT"], "VIS")
        self.assertEqual(gfs.products["freezing_level"].components[0].grib_match["GRIB_SHORT_NAME"], "0-0DEG")
        self.assertEqual(gfs.products["precipitable_water"].components[0].grib_match["GRIB_SHORT_NAME"], "0-EATM")
        self.assertEqual(gfs.products["cape_index"].components[0].grib_match["GRIB_SHORT_NAME"], "18000-0-SPDL")
        gfs_precip_type = gfs.products["precip_type_surface"]
        assert gfs_precip_type.derivation is not None
        self.assertEqual(gfs_precip_type.derivation.type, "precip_type_from_gfs_categories")
        self.assertEqual(gfs_precip_type.component_ids, ("value",))
        self.assertIsNone(gfs_precip_type.components[0].grib_match)
        self.assertEqual(
            [input_item.id for input_item in gfs_precip_type.derivation.inputs],
            ["rain", "freezing_rain", "ice_pellets", "snow"],
        )
        self.assertEqual(gfs.products["low_clouds"].components[0].grib_match["GRIB_ELEMENT"], "LCDC")
        self.assertEqual(gfs.products["medium_clouds"].components[0].grib_match["GRIB_ELEMENT"], "MCDC")
        self.assertEqual(gfs.products["high_clouds"].components[0].grib_match["GRIB_ELEMENT"], "HCDC")
        self.assertEqual(icon.products["low_clouds"].components[0].grib_match["ICON_PARAM"], "clcl")
        self.assertEqual(icon.products["medium_clouds"].components[0].grib_match["ICON_PARAM"], "clcm")
        self.assertEqual(icon.products["high_clouds"].components[0].grib_match["ICON_PARAM"], "clch")
        self.assertEqual(icon.products["snow_depth_surface"].components[0].grib_match["ICON_PARAM"], "h_snow")
        self.assertEqual(icon.products["freezing_level"].components[0].grib_match["ICON_PARAM"], "hzerocl")
        self.assertEqual(icon.products["precipitable_water"].components[0].grib_match["ICON_PARAM"], "tqv")
        self.assertEqual(icon.products["cape_index"].components[0].grib_match["ICON_PARAM"], "cape_ml")
        icon_precip_type = icon.products["precip_type_surface"]
        icon_thunderstorm = icon.products["thunderstorm_mask"]
        assert icon_precip_type.derivation is not None
        assert icon_thunderstorm.derivation is not None
        self.assertEqual(icon_precip_type.derivation.type, "precip_type_from_icon_ww")
        self.assertEqual(icon_thunderstorm.derivation.type, "thunderstorm_mask_from_icon_ww")
        self.assertEqual(icon_precip_type.component_ids, ("value",))
        self.assertIsNone(icon_precip_type.components[0].grib_match)
        self.assertEqual(icon_precip_type.derivation.inputs[0].grib_match["ICON_PARAM"], "ww")
        self.assertEqual(icon_thunderstorm.derivation.inputs[0].grib_match["ICON_PARAM"], "ww")
        self.assertEqual(gfs.source.nomads.vars_levels["lev_0C_isotherm"], "on")
        self.assertEqual(gfs.source.nomads.vars_levels["lev_180-0_mb_above_ground"], "on")
        self.assertEqual(gfs.source.nomads.vars_levels["lev_entire_atmosphere_(considered_as_a_single_layer)"], "on")

    def test_infra_config_matches_local_config_except_forecast_horizon(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        local_path = repo_root / "etl" / "forecast.etl_config.json"
        infra_path = repo_root / "infra" / "config" / "forecast.etl_config.json"
        local_config = json.loads(local_path.read_text(encoding="utf-8"))
        infra_config = json.loads(infra_path.read_text(encoding="utf-8"))

        self.assertEqual(infra_config["models"]["gfs"]["workload"]["forecast_hour_end"], 72)
        self.assertEqual(infra_config["models"]["icon"]["workload"]["forecast_hour_end"], 72)

        for model_id in ("gfs", "icon"):
            infra_config["models"][model_id]["workload"]["forecast_hour_end"] = (
                local_config["models"][model_id]["workload"]["forecast_hour_end"]
            )
        self.assertEqual(infra_config, local_config)

    def test_pipeline_config_parses_forecast_hour_range(self) -> None:
        parsed = parse_pipeline_config(minimal_pipeline_config())
        model = parsed.model("gfs")
        self.assertEqual(model.workload.forecast_hours, ("000",))
        self.assertEqual(model.workload.products, ("tmp_surface",))
        self.assertIn("tmp_surface", model.products)
        self.assertEqual(model.products["tmp_surface"].component_ids, ("value",))
        self.assertEqual(model.products["tmp_surface"].kind, "scalar")

    def test_pipeline_config_parses_icon_dwd_icosahedral_model(self) -> None:
        cfg = minimal_pipeline_config()
        precip_config = precip_total_config()
        prate_config = precip_rate_config()
        wind_config = wind_product_config()
        cfg["product_catalog"]["prate_surface"] = catalog_product(prate_config)
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
                "products": ["prate_surface", "precip_total_surface", "wind10m_uv"],
            },
            "products": {
                "prate_surface": model_product(prate_config),
                "precip_total_surface": model_product(precip_config),
                "wind10m_uv": {
                    "components": [
                        {"id": "u", "grib_match": {"ICON_PARAM": "u_10m"}},
                        {"id": "v", "grib_match": {"ICON_PARAM": "v_10m"}},
                    ],
                },
            },
        }

        parsed = parse_pipeline_config(cfg)
        icon = parsed.model("icon")

        self.assertEqual(icon.source.type, "icon_dwd_icosahedral")
        self.assertIsInstance(icon.source, IconDwdSourceConfig)
        self.assertEqual(icon.workload.products, ("prate_surface", "precip_total_surface", "wind10m_uv"))
        self.assertEqual(icon.products["wind10m_uv"].components[1].grib_match["ICON_PARAM"], "v_10m")
        icon_prate_temporal = icon.products["prate_surface"].temporal
        assert icon_prate_temporal is not None
        self.assertEqual(icon_prate_temporal.kind, "average_rate")

    def test_pipeline_config_rejects_icon_derived_rate_with_non_hourly_interval(self) -> None:
        cfg = minimal_pipeline_config()
        prate_config = precip_rate_config()
        cfg["product_catalog"]["prate_surface"] = catalog_product(prate_config)
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
                "products": ["prate_surface"],
            },
            "products": {
                "prate_surface": model_product(prate_config),
            },
        }
        cfg["models"]["icon"]["products"]["prate_surface"]["temporal"]["source_interval_hours"] = 3

        with self.assertRaises(SystemExit) as raised:
            parse_pipeline_config(cfg)

        self.assertIn("source_interval_hours=1", str(raised.exception))

    def test_pipeline_config_parses_derivation_inputs_separately_from_output_components(self) -> None:
        cfg = minimal_pipeline_config()
        product_config = precip_type_config(derivation_type="precip_type_from_gfs_categories")
        cfg["product_catalog"]["precip_type_surface"] = catalog_product(product_config)
        cfg["models"]["gfs"]["workload"]["products"] = ["precip_type_surface"]
        cfg["models"]["gfs"]["products"] = {
            "precip_type_surface": model_product(product_config),
        }

        parsed = parse_pipeline_config(cfg)
        product = parsed.model("gfs").products["precip_type_surface"]

        self.assertEqual(product.component_ids, ("value",))
        self.assertIsNone(product.components[0].grib_match)
        assert product.derivation is not None
        self.assertEqual(
            [input_item.id for input_item in product.derivation.inputs],
            ["rain", "freezing_rain", "ice_pellets", "snow"],
        )

    def test_pipeline_config_rejects_gfs_precip_type_without_derivation_inputs(self) -> None:
        cfg = minimal_pipeline_config()
        product_config = precip_type_config(derivation_type="precip_type_from_gfs_categories")
        product_config["derivation"]["inputs"] = []
        cfg["product_catalog"]["precip_type_surface"] = catalog_product(product_config)
        cfg["models"]["gfs"]["workload"]["products"] = ["precip_type_surface"]
        cfg["models"]["gfs"]["products"] = {
            "precip_type_surface": model_product(product_config),
        }

        with self.assertRaises(SystemExit) as raised:
            parse_pipeline_config(cfg)

        self.assertIn("requires derivation.inputs", str(raised.exception))

    def test_pipeline_config_rejects_derived_output_component_source_selector(self) -> None:
        cfg = minimal_pipeline_config()
        product_config = precip_type_config(derivation_type="precip_type_from_gfs_categories")
        product_config["components"][0]["grib_match"] = {"GRIB_ELEMENT": "CRAIN"}
        cfg["product_catalog"]["precip_type_surface"] = catalog_product(product_config)
        cfg["models"]["gfs"]["workload"]["products"] = ["precip_type_surface"]
        cfg["models"]["gfs"]["products"] = {
            "precip_type_surface": model_product(product_config),
        }

        with self.assertRaises(SystemExit) as raised:
            parse_pipeline_config(cfg)

        self.assertIn("put source selectors in derivation.inputs", str(raised.exception))

    def test_pipeline_config_parses_icon_weather_code_overlay_products(self) -> None:
        cfg = minimal_pipeline_config()
        precip_type = precip_type_config(derivation_type="precip_type_from_icon_ww")
        thunderstorm = thunderstorm_mask_config()
        cfg["product_catalog"]["precip_type_surface"] = catalog_product(precip_type)
        cfg["product_catalog"]["thunderstorm_mask"] = catalog_product(thunderstorm)
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
                "products": ["precip_type_surface", "thunderstorm_mask"],
            },
            "products": {
                "precip_type_surface": model_product(precip_type),
                "thunderstorm_mask": model_product(thunderstorm),
            },
        }

        parsed = parse_pipeline_config(cfg)
        icon = parsed.model("icon")

        self.assertEqual(icon.products["precip_type_surface"].derivation.inputs[0].grib_match["ICON_PARAM"], "ww")
        self.assertEqual(icon.products["thunderstorm_mask"].derivation.inputs[0].grib_match["ICON_PARAM"], "ww")

    def test_pipeline_config_parses_phase_rate_products(self) -> None:
        cfg = minimal_pipeline_config()
        rain_rate = phase_rate_config(phase="rain")
        snow_rate = phase_rate_config(
            derivation_type="phase_rate_from_icon_tot_prec_ww",
            phase="snow",
        )
        cfg["product_catalog"]["rain_rate_surface"] = catalog_product(rain_rate)
        cfg["product_catalog"]["snow_rate_surface"] = catalog_product(snow_rate)
        cfg["models"]["gfs"]["workload"]["products"] = ["rain_rate_surface"]
        cfg["models"]["gfs"]["products"] = {
            "rain_rate_surface": model_product(rain_rate),
        }
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
                "products": ["snow_rate_surface"],
            },
            "products": {
                "snow_rate_surface": model_product(snow_rate),
            },
        }

        parsed = parse_pipeline_config(cfg)

        self.assertEqual(parsed.model("gfs").products["rain_rate_surface"].derivation.phase, "rain")
        self.assertEqual(parsed.model("icon").products["snow_rate_surface"].derivation.phase, "snow")

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

    def test_pipeline_config_rejects_model_product_missing_component_match(self) -> None:
        cfg = minimal_pipeline_config()
        add_model_product(
            cfg,
            model_id="gfs",
            product_id="low_clouds",
            product_config=cloud_cover_config(),
        )
        _gfs(cfg)["workload"]["products"] = ["low_clouds"]
        del _gfs(cfg)["products"]["low_clouds"]["components"][0]["grib_match"]

        with self.assertRaises(SystemExit):
            parse_pipeline_config(cfg)

    def test_pipeline_config_rejects_model_product_with_unknown_component(self) -> None:
        cfg = minimal_pipeline_config()
        add_model_product(
            cfg,
            model_id="gfs",
            product_id="low_clouds",
            product_config=cloud_cover_config(),
        )
        _gfs(cfg)["workload"]["products"] = ["low_clouds"]
        _gfs(cfg)["products"]["low_clouds"]["components"].append(
            {"id": "ceiling", "grib_match": {"GRIB_ELEMENT": "CEIL"}}
        )

        with self.assertRaises(SystemExit):
            parse_pipeline_config(cfg)
