from __future__ import annotations

import json
import unittest
from pathlib import Path

from forecast_etl.config.load import load_pipeline_config, merge_pipeline_config_overlay, parse_pipeline_config
from forecast_etl.config.resolved import IconDwdSourceConfig
from forecast_etl.tests.fixtures.artifact_configs import (
    cloud_cover_config,
    precip_rate_config,
    precip_total_config,
    precip_type_config,
    thunderstorm_mask_config,
    wind_artifact_config,
)
from forecast_etl.tests.fixtures.pipeline import (
    add_model_artifact,
    catalog_artifact,
    minimal_pipeline_config,
    model_artifact,
)


def _gfs(cfg: dict) -> dict:
    return cfg["models"]["gfs"]


class ConfigValidationTest(unittest.TestCase):
    def test_local_config_overlay_parses_icon_dwd_v1_artifacts(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        parsed = load_pipeline_config(
            (repo_root / "config" / "pipeline" / "base.json").as_uri(),
            overlay_uri=(repo_root / "config" / "pipeline" / "local.json").as_uri(),
        )
        icon = parsed.model("icon")

        expected_icon_artifacts = (
            "tmp_surface",
            "gust_surface",
            "dewpoint_surface",
            "rh_surface",
            "prmsl_msl",
            "tcdc",
            "low_clouds",
            "medium_clouds",
            "high_clouds",
            "prate_surface",
            "precip_total_surface",
            "precip_type_surface",
            "thunderstorm_mask",
            "snow_depth_surface",
            "freezing_level",
            "precipitable_water",
            "cape_index",
            "wind10m_uv",
        )
        expected_gfs_artifacts = (
            "tmp_surface",
            "aptmp_surface",
            "gust_surface",
            "dewpoint_surface",
            "rh_surface",
            "prmsl_msl",
            "tcdc",
            "low_clouds",
            "medium_clouds",
            "high_clouds",
            "prate_surface",
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
        self.assertEqual(icon.workload.artifacts, expected_icon_artifacts)
        self.assertEqual(gfs.workload.artifacts, expected_gfs_artifacts)
        self.assertNotIn("aptmp_surface", icon.workload.artifacts)
        self.assertNotIn("visibility_surface", icon.workload.artifacts)
        self.assertNotIn("visibility_surface", icon.artifacts)
        self.assertNotIn("thunderstorm_mask", gfs.workload.artifacts)
        self.assertNotIn("thunderstorm_mask", gfs.artifacts)
        self.assertEqual(icon.artifacts["tmp_surface"].kind, "scalar")
        self.assertEqual(icon.artifacts["gust_surface"].kind, "scalar")
        self.assertEqual(icon.artifacts["wind10m_uv"].kind, "vector")
        icon_prate_temporal = icon.artifacts["prate_surface"].temporal
        icon_prate_derivation = icon.artifacts["prate_surface"].derivation
        gfs_prate_temporal = gfs.artifacts["prate_surface"].temporal
        assert icon_prate_temporal is not None
        assert icon_prate_derivation is not None
        assert gfs_prate_temporal is not None
        self.assertEqual(icon_prate_temporal.kind, "average_rate")
        self.assertEqual(icon_prate_temporal.source_interval_hours, 1)
        self.assertEqual(icon_prate_derivation.type, "icon_tot_prec_delta_rate")
        self.assertIsNone(icon.artifacts["prate_surface"].components[0].grib_match)
        self.assertEqual(icon_prate_derivation.inputs[0].id, "total")
        self.assertEqual(icon_prate_derivation.inputs[0].grib_match["ICON_PARAM"], "tot_prec")
        self.assertEqual(
            gfs.artifacts["prate_surface"].components[0].grib_match["GRIB_PDS_PDTN"],
            "0",
        )
        self.assertEqual(gfs_prate_temporal.kind, "instantaneous_rate")
        self.assertEqual(gfs.artifacts["snow_depth_surface"].components[0].grib_match["GRIB_ELEMENT"], "SNOD")
        self.assertEqual(gfs.artifacts["visibility_surface"].components[0].grib_match["GRIB_ELEMENT"], "VIS")
        self.assertEqual(gfs.artifacts["prmsl_msl"].level, "mean sea level")
        self.assertEqual(gfs.artifacts["prmsl_msl"].components[0].grib_match["GRIB_SHORT_NAME"], "0-MSL")
        self.assertEqual(gfs.artifacts["freezing_level"].components[0].grib_match["GRIB_SHORT_NAME"], "0-0DEG")
        self.assertEqual(gfs.artifacts["precipitable_water"].components[0].grib_match["GRIB_SHORT_NAME"], "0-EATM")
        self.assertEqual(gfs.artifacts["cape_index"].components[0].grib_match["GRIB_SHORT_NAME"], "18000-0-SPDL")
        gfs_precip_type = gfs.artifacts["precip_type_surface"]
        assert gfs_precip_type.derivation is not None
        self.assertEqual(gfs_precip_type.derivation.type, "precip_type_from_gfs_categories")
        self.assertEqual(gfs_precip_type.component_ids, ("value",))
        self.assertIsNone(gfs_precip_type.components[0].grib_match)
        self.assertEqual(
            [input_item.id for input_item in gfs_precip_type.derivation.inputs],
            ["rain", "freezing_rain", "ice_pellets", "snow"],
        )
        self.assertEqual(gfs.artifacts["low_clouds"].components[0].grib_match["GRIB_ELEMENT"], "LCDC")
        self.assertEqual(gfs.artifacts["medium_clouds"].components[0].grib_match["GRIB_ELEMENT"], "MCDC")
        self.assertEqual(gfs.artifacts["high_clouds"].components[0].grib_match["GRIB_ELEMENT"], "HCDC")
        self.assertEqual(icon.artifacts["low_clouds"].components[0].grib_match["ICON_PARAM"], "clcl")
        self.assertEqual(icon.artifacts["medium_clouds"].components[0].grib_match["ICON_PARAM"], "clcm")
        self.assertEqual(icon.artifacts["high_clouds"].components[0].grib_match["ICON_PARAM"], "clch")
        self.assertEqual(icon.artifacts["snow_depth_surface"].components[0].grib_match["ICON_PARAM"], "h_snow")
        self.assertEqual(icon.artifacts["prmsl_msl"].level, "mean sea level")
        self.assertEqual(icon.artifacts["prmsl_msl"].components[0].grib_match["ICON_PARAM"], "pmsl")
        self.assertEqual(icon.artifacts["freezing_level"].components[0].grib_match["ICON_PARAM"], "hzerocl")
        self.assertEqual(icon.artifacts["precipitable_water"].components[0].grib_match["ICON_PARAM"], "tqv")
        self.assertEqual(icon.artifacts["cape_index"].components[0].grib_match["ICON_PARAM"], "cape_ml")
        icon_precip_type = icon.artifacts["precip_type_surface"]
        icon_thunderstorm = icon.artifacts["thunderstorm_mask"]
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

    def test_prod_base_config_matches_local_overlay_except_forecast_horizon(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        prod_path = repo_root / "config" / "pipeline" / "base.json"
        local_override_path = repo_root / "config" / "pipeline" / "local.json"
        prod_config = json.loads(prod_path.read_text(encoding="utf-8"))
        local_override = json.loads(local_override_path.read_text(encoding="utf-8"))
        local_config = merge_pipeline_config_overlay(prod_config, local_override)
        parse_pipeline_config(prod_config)
        parse_pipeline_config(local_config)

        self.assertEqual(prod_config["models"]["gfs"]["workload"]["forecast_hour_end"], 72)
        self.assertEqual(prod_config["models"]["icon"]["workload"]["forecast_hour_end"], 72)
        self.assertEqual(
            local_override,
            {
                "models": {
                    "gfs": {"workload": {"forecast_hour_end": 24}},
                    "icon": {"workload": {"forecast_hour_end": 24}},
                }
            },
        )

        for model_id in ("gfs", "icon"):
            prod_config["models"][model_id]["workload"]["forecast_hour_end"] = (
                local_config["models"][model_id]["workload"]["forecast_hour_end"]
            )
        self.assertEqual(prod_config, local_config)

    def test_pipeline_config_parses_forecast_hour_range(self) -> None:
        parsed = parse_pipeline_config(minimal_pipeline_config())
        model = parsed.model("gfs")
        self.assertEqual(model.workload.forecast_hours, ("000",))
        self.assertEqual(model.workload.artifacts, ("tmp_surface",))
        self.assertIn("tmp_surface", model.artifacts)
        self.assertEqual(model.artifacts["tmp_surface"].component_ids, ("value",))
        self.assertEqual(model.artifacts["tmp_surface"].kind, "scalar")

    def test_pipeline_config_parses_icon_dwd_icosahedral_model(self) -> None:
        cfg = minimal_pipeline_config()
        precip_config = precip_total_config()
        prate_config = precip_rate_config()
        wind_config = wind_artifact_config()
        cfg["artifact_catalog"]["prate_surface"] = catalog_artifact(prate_config)
        cfg["artifact_catalog"]["precip_total_surface"] = catalog_artifact(precip_config)
        cfg["artifact_catalog"]["wind10m_uv"] = catalog_artifact(wind_config)
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
                "artifacts": ["prate_surface", "precip_total_surface", "wind10m_uv"],
            },
            "artifacts": {
                "prate_surface": model_artifact(prate_config),
                "precip_total_surface": model_artifact(precip_config),
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
        self.assertEqual(icon.workload.artifacts, ("prate_surface", "precip_total_surface", "wind10m_uv"))
        self.assertEqual(icon.artifacts["wind10m_uv"].components[1].grib_match["ICON_PARAM"], "v_10m")
        icon_prate_temporal = icon.artifacts["prate_surface"].temporal
        assert icon_prate_temporal is not None
        self.assertEqual(icon_prate_temporal.kind, "average_rate")

    def test_pipeline_config_rejects_icon_derived_rate_with_non_hourly_interval(self) -> None:
        cfg = minimal_pipeline_config()
        prate_config = precip_rate_config()
        cfg["artifact_catalog"]["prate_surface"] = catalog_artifact(prate_config)
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
                "artifacts": ["prate_surface"],
            },
            "artifacts": {
                "prate_surface": model_artifact(prate_config),
            },
        }
        cfg["models"]["icon"]["artifacts"]["prate_surface"]["temporal"]["source_interval_hours"] = 3

        with self.assertRaises(SystemExit) as raised:
            parse_pipeline_config(cfg)

        self.assertIn("source_interval_hours=1", str(raised.exception))

    def test_pipeline_config_parses_derivation_inputs_separately_from_output_components(self) -> None:
        cfg = minimal_pipeline_config()
        artifact_config = precip_type_config(derivation_type="precip_type_from_gfs_categories")
        cfg["artifact_catalog"]["precip_type_surface"] = catalog_artifact(artifact_config)
        cfg["models"]["gfs"]["workload"]["artifacts"] = ["precip_type_surface"]
        cfg["models"]["gfs"]["artifacts"] = {
            "precip_type_surface": model_artifact(artifact_config),
        }

        parsed = parse_pipeline_config(cfg)
        artifact = parsed.model("gfs").artifacts["precip_type_surface"]

        self.assertEqual(artifact.component_ids, ("value",))
        self.assertIsNone(artifact.components[0].grib_match)
        assert artifact.derivation is not None
        self.assertEqual(
            [input_item.id for input_item in artifact.derivation.inputs],
            ["rain", "freezing_rain", "ice_pellets", "snow"],
        )

    def test_pipeline_config_rejects_gfs_precip_type_without_derivation_inputs(self) -> None:
        cfg = minimal_pipeline_config()
        artifact_config = precip_type_config(derivation_type="precip_type_from_gfs_categories")
        artifact_config["derivation"]["inputs"] = []
        cfg["artifact_catalog"]["precip_type_surface"] = catalog_artifact(artifact_config)
        cfg["models"]["gfs"]["workload"]["artifacts"] = ["precip_type_surface"]
        cfg["models"]["gfs"]["artifacts"] = {
            "precip_type_surface": model_artifact(artifact_config),
        }

        with self.assertRaises(SystemExit) as raised:
            parse_pipeline_config(cfg)

        self.assertIn("requires derivation.inputs", str(raised.exception))

    def test_pipeline_config_rejects_derived_output_component_source_selector(self) -> None:
        cfg = minimal_pipeline_config()
        artifact_config = precip_type_config(derivation_type="precip_type_from_gfs_categories")
        artifact_config["components"][0]["grib_match"] = {"GRIB_ELEMENT": "CRAIN"}
        cfg["artifact_catalog"]["precip_type_surface"] = catalog_artifact(artifact_config)
        cfg["models"]["gfs"]["workload"]["artifacts"] = ["precip_type_surface"]
        cfg["models"]["gfs"]["artifacts"] = {
            "precip_type_surface": model_artifact(artifact_config),
        }

        with self.assertRaises(SystemExit) as raised:
            parse_pipeline_config(cfg)

        self.assertIn("put source selectors in derivation.inputs", str(raised.exception))

    def test_pipeline_config_parses_icon_weather_code_overlay_artifacts(self) -> None:
        cfg = minimal_pipeline_config()
        precip_type = precip_type_config(derivation_type="precip_type_from_icon_ww")
        thunderstorm = thunderstorm_mask_config()
        cfg["artifact_catalog"]["precip_type_surface"] = catalog_artifact(precip_type)
        cfg["artifact_catalog"]["thunderstorm_mask"] = catalog_artifact(thunderstorm)
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
                "artifacts": ["precip_type_surface", "thunderstorm_mask"],
            },
            "artifacts": {
                "precip_type_surface": model_artifact(precip_type),
                "thunderstorm_mask": model_artifact(thunderstorm),
            },
        }

        parsed = parse_pipeline_config(cfg)
        icon = parsed.model("icon")

        self.assertEqual(icon.artifacts["precip_type_surface"].derivation.inputs[0].grib_match["ICON_PARAM"], "ww")
        self.assertEqual(icon.artifacts["thunderstorm_mask"].derivation.inputs[0].grib_match["ICON_PARAM"], "ww")

    def test_pipeline_config_rejects_icon_dwd_artifact_without_icon_param(self) -> None:
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
                "artifacts": ["tmp_surface"],
            },
            "artifacts": {
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

    def test_pipeline_config_rejects_duplicate_workload_artifact(self) -> None:
        bad_cfg = minimal_pipeline_config()
        _gfs(bad_cfg)["workload"]["artifacts"] = ["tmp_surface", "tmp_surface"]

        with self.assertRaises(SystemExit):
            parse_pipeline_config(bad_cfg)

    def test_pipeline_config_rejects_unknown_workload_artifact(self) -> None:
        bad_cfg = minimal_pipeline_config()
        _gfs(bad_cfg)["workload"]["artifacts"] = ["missing_surface"]

        with self.assertRaises(SystemExit):
            parse_pipeline_config(bad_cfg)

    def test_pipeline_config_rejects_invalid_source_transform(self) -> None:
        bad_cfg = minimal_pipeline_config()
        bad_cfg["artifact_catalog"]["tmp_surface"]["source_transform"] = "bogus_transform"

        with self.assertRaises(SystemExit):
            parse_pipeline_config(bad_cfg)

    def test_pipeline_config_accepts_precipitation_rate_source_transform(self) -> None:
        cfg = minimal_pipeline_config()
        cfg["artifact_catalog"]["tmp_surface"]["source_transform"] = "kg_m2_s_to_mm_hr"

        parsed = parse_pipeline_config(cfg)

        self.assertEqual(
            parsed.model("gfs").artifacts["tmp_surface"].source_transform,
            "kg_m2_s_to_mm_hr",
        )

    def test_pipeline_config_accepts_temperature_piecewise_encoding_without_scale_offset(self) -> None:
        cfg = minimal_pipeline_config()
        cfg["artifact_catalog"]["tmp_surface"]["encoding"] = {
            "id": "tmp_surface_i8_temp_c_piecewise_v1",
            "format": "temp-c-piecewise-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "nodata": -128,
        }

        parsed = parse_pipeline_config(cfg)

        self.assertEqual(
            parsed.model("gfs").artifacts["tmp_surface"].encoding.format,
            "temp-c-piecewise-i8-v1",
        )

    def test_pipeline_config_rejects_invalid_encoding_format_names(self) -> None:
        bad_cfg = minimal_pipeline_config()
        bad_cfg["artifact_catalog"]["tmp_surface"]["encoding"]["format"] = "scalar-i16-linear-v1"

        with self.assertRaises(SystemExit):
            parse_pipeline_config(bad_cfg)

    def test_pipeline_config_rejects_model_artifact_missing_component_match(self) -> None:
        cfg = minimal_pipeline_config()
        add_model_artifact(
            cfg,
            model_id="gfs",
            artifact_id="low_clouds",
            artifact_config=cloud_cover_config(),
        )
        _gfs(cfg)["workload"]["artifacts"] = ["low_clouds"]
        del _gfs(cfg)["artifacts"]["low_clouds"]["components"][0]["grib_match"]

        with self.assertRaises(SystemExit):
            parse_pipeline_config(cfg)

    def test_pipeline_config_rejects_model_artifact_with_unknown_component(self) -> None:
        cfg = minimal_pipeline_config()
        add_model_artifact(
            cfg,
            model_id="gfs",
            artifact_id="low_clouds",
            artifact_config=cloud_cover_config(),
        )
        _gfs(cfg)["workload"]["artifacts"] = ["low_clouds"]
        _gfs(cfg)["artifacts"]["low_clouds"]["components"].append(
            {"id": "ceiling", "grib_match": {"GRIB_ELEMENT": "CEIL"}}
        )

        with self.assertRaises(SystemExit):
            parse_pipeline_config(cfg)
