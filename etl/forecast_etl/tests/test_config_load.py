from __future__ import annotations

import json
import unittest
from pathlib import Path

from forecast_etl.config.load import load_pipeline_config, merge_pipeline_config_overlay, parse_pipeline_config
from forecast_etl.config.resolved import IconDwdSourceConfig
from forecast_etl.tests.fixtures.artifact_configs import (
    cloud_cover_config,
    icon_precip_type_config,
    precip_rate_config,
    precip_total_config,
    precip_type_config,
    pressure_msl_config,
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
    def test_local_pipeline_config_loads_current_models(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        parsed = load_pipeline_config(
            (repo_root / "config" / "pipeline" / "base.json").as_uri(),
            overlay_uri=(repo_root / "config" / "pipeline" / "local.json").as_uri(),
        )
        gfs = parsed.model("gfs")
        icon = parsed.model("icon")

        self.assertEqual(gfs.source.type, "gfs_nomads")
        self.assertEqual(icon.source.type, "icon_dwd_icosahedral")
        self.assertIsInstance(icon.source, IconDwdSourceConfig)

        for model in (gfs, icon):
            with self.subTest(model=model.id):
                self.assertGreater(len(model.workload.artifacts), 0)
                self.assertLessEqual(set(model.workload.artifacts), set(model.artifacts))
                for artifact_id in model.workload.artifacts:
                    self.assertEqual(model.artifacts[artifact_id].id, artifact_id)

    def test_local_config_overlay_only_changes_forecast_horizon(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        prod_path = repo_root / "config" / "pipeline" / "base.json"
        local_override_path = repo_root / "config" / "pipeline" / "local.json"
        prod_config = json.loads(prod_path.read_text(encoding="utf-8"))
        local_override = json.loads(local_override_path.read_text(encoding="utf-8"))
        local_config = merge_pipeline_config_overlay(prod_config, local_override)
        prod = parse_pipeline_config(prod_config)
        local = parse_pipeline_config(local_config)

        for model_id in ("gfs", "icon"):
            with self.subTest(model=model_id):
                prod_model = prod.model(model_id)
                local_model = local.model(model_id)
                self.assertEqual(prod_model.workload.forecast_hours[-1], "072")
                self.assertEqual(local_model.workload.forecast_hours[-1], "024")

                prod_model_data = prod_model.model_dump()
                local_model_data = local_model.model_dump()
                prod_model_data["workload"]["forecast_hours"] = local_model_data["workload"]["forecast_hours"]
                self.assertEqual(prod_model_data, local_model_data)

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

    def test_pipeline_config_parses_model_artifact_grid_transform(self) -> None:
        cfg = minimal_pipeline_config()
        pressure = pressure_msl_config(grib_match={"GRIB_ELEMENT": "PRMSL"}, grid_transform={
            "type": "regular_grid_downsample_2x",
            "grid_id": "icon_global_regridded_0p25",
        })
        cfg["artifact_catalog"]["prmsl_msl"] = catalog_artifact(pressure)
        cfg["models"]["gfs"]["workload"]["artifacts"] = ["prmsl_msl"]
        cfg["models"]["gfs"]["artifacts"] = {
            "prmsl_msl": model_artifact(pressure),
        }

        parsed = parse_pipeline_config(cfg)
        transform = parsed.model("gfs").artifacts["prmsl_msl"].grid_transform

        assert transform is not None
        self.assertEqual(transform.type, "regular_grid_downsample_2x")
        self.assertEqual(transform.grid_id, "icon_global_regridded_0p25")

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
        artifact_config = precip_type_config()
        cfg["artifact_catalog"]["precip_type_surface"] = catalog_artifact(artifact_config)
        cfg["models"]["gfs"]["workload"]["artifacts"] = ["precip_type_surface"]
        cfg["models"]["gfs"]["artifacts"] = {
            "precip_type_surface": model_artifact(artifact_config),
        }

        parsed = parse_pipeline_config(cfg)
        artifact = parsed.model("gfs").artifacts["precip_type_surface"]

        self.assertEqual(artifact.component_ids, ("snow_frac", "mix_frac"))
        self.assertTrue(all(component.grib_match is None for component in artifact.components))
        assert artifact.derivation is not None
        self.assertEqual(
            [input_item.id for input_item in artifact.derivation.inputs],
            ["precip_rate", "frozen_percent", "rain", "freezing_rain", "ice_pellets", "snow"],
        )

    def test_pipeline_config_rejects_gfs_precip_type_without_derivation_inputs(self) -> None:
        cfg = minimal_pipeline_config()
        artifact_config = precip_type_config()
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
        artifact_config = precip_type_config()
        artifact_config["components"][0]["grib_match"] = {"GRIB_ELEMENT": "CRAIN"}
        cfg["artifact_catalog"]["precip_type_surface"] = catalog_artifact(artifact_config)
        cfg["models"]["gfs"]["workload"]["artifacts"] = ["precip_type_surface"]
        cfg["models"]["gfs"]["artifacts"] = {
            "precip_type_surface": model_artifact(artifact_config),
        }

        with self.assertRaises(SystemExit) as raised:
            parse_pipeline_config(cfg)

        self.assertIn("put source selectors in derivation.inputs", str(raised.exception))

    def test_pipeline_config_parses_icon_weather_code_thunderstorm_artifact(self) -> None:
        cfg = minimal_pipeline_config()
        thunderstorm = thunderstorm_mask_config()
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
                "artifacts": ["thunderstorm_mask"],
            },
            "artifacts": {
                "thunderstorm_mask": model_artifact(thunderstorm),
            },
        }

        parsed = parse_pipeline_config(cfg)
        icon = parsed.model("icon")

        self.assertEqual(icon.artifacts["thunderstorm_mask"].derivation.inputs[0].grib_match["ICON_PARAM"], "ww")

    def test_pipeline_config_parses_icon_precip_type_component_overlay(self) -> None:
        cfg = minimal_pipeline_config()
        precip_type = icon_precip_type_config()
        cfg["artifact_catalog"]["precip_type_surface"] = catalog_artifact(precip_type)
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
                "artifacts": ["precip_type_surface"],
            },
            "artifacts": {
                "precip_type_surface": model_artifact(precip_type),
            },
        }

        parsed = parse_pipeline_config(cfg)
        artifact = parsed.model("icon").artifacts["precip_type_surface"]

        self.assertEqual(artifact.component_ids, ("snow_frac", "mix_frac"))
        assert artifact.temporal is not None
        self.assertEqual(artifact.temporal.kind, "average_rate")
        assert artifact.derivation is not None
        self.assertEqual(
            [input_item.grib_match["ICON_PARAM"] for input_item in artifact.derivation.inputs],
            ["rain_gsp", "rain_con", "snow_gsp", "snow_con"],
        )

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
