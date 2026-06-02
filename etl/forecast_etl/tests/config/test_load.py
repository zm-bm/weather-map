from __future__ import annotations

import json
import unittest

from forecast_etl.config.load import load_pipeline_config, merge_pipeline_config_overlay, parse_pipeline_config
from forecast_etl.config.resolved import IconDwdSourceConfig
from forecast_etl.tests.fixtures.artifact_configs import (
    cloud_layers_config,
    gfs_precip_total_config,
    icon_precip_type_config,
    precip_rate_config,
    precip_total_config,
    precip_type_config,
    pressure_msl_config,
    thunderstorm_mask_config,
    wind_artifact_config,
)
from forecast_etl.tests.fixtures.paths import repo_root_from
from forecast_etl.tests.fixtures.pipeline import (
    add_dataset_artifact,
    catalog_artifact,
    dataset_artifact,
    minimal_pipeline_config,
)


def _gfs(cfg: dict) -> dict:
    return cfg["datasets"]["gfs"]


class ConfigValidationTest(unittest.TestCase):
    def test_local_pipeline_config_loads_current_datasets(self) -> None:
        repo_root = repo_root_from(__file__)
        parsed = load_pipeline_config(
            (repo_root / "config" / "pipeline" / "base.json").as_uri(),
            overlay_uri=(repo_root / "config" / "pipeline" / "local.json").as_uri(),
        )
        gfs = parsed.dataset("gfs")
        icon = parsed.dataset("icon")

        self.assertEqual(gfs.source.type, "gfs_nomads")
        self.assertEqual(icon.source.type, "icon_dwd_icosahedral")
        self.assertIsInstance(icon.source, IconDwdSourceConfig)
        self.assertIn("precip_total_surface", gfs.workload.artifacts)
        gfs_precip_total = gfs.artifacts["precip_total_surface"]
        self.assertEqual(gfs_precip_total.temporal.kind, "accumulation")
        self.assertEqual(gfs_precip_total.derivation.type, "gfs_run_total_precip")
        self.assertIn("precip_total_surface", icon.workload.artifacts)
        self.assertEqual(icon.artifacts["precip_total_surface"].temporal.kind, "accumulation")

        for dataset in (gfs, icon):
            with self.subTest(dataset=dataset.id):
                self.assertGreater(len(dataset.workload.artifacts), 0)
                self.assertLessEqual(set(dataset.workload.artifacts), set(dataset.artifacts))
                self.assertIn("cloud_layers", dataset.workload.artifacts)
                self.assertEqual(dataset.artifacts["cloud_layers"].kind, "vector")
                self.assertEqual(dataset.artifacts["cloud_layers"].component_ids, ("low", "middle", "high"))
                for artifact_id in dataset.workload.artifacts:
                    self.assertEqual(dataset.artifacts[artifact_id].id, artifact_id)

    def test_local_config_overlay_only_changes_configured_frames(self) -> None:
        repo_root = repo_root_from(__file__)
        prod_path = repo_root / "config" / "pipeline" / "base.json"
        local_override_path = repo_root / "config" / "pipeline" / "local.json"
        prod_config = json.loads(prod_path.read_text(encoding="utf-8"))
        local_override = json.loads(local_override_path.read_text(encoding="utf-8"))
        local_config = merge_pipeline_config_overlay(prod_config, local_override)
        prod = parse_pipeline_config(prod_config)
        local = parse_pipeline_config(local_config)

        for dataset_id in ("gfs", "icon"):
            with self.subTest(dataset=dataset_id):
                prod_dataset = prod.dataset(dataset_id)
                local_dataset = local.dataset(dataset_id)
                self.assertEqual(prod_dataset.workload.frames[-1], "072")
                self.assertEqual(local_dataset.workload.frames[-1], "024")

                prod_dataset_data = prod_dataset.model_dump()
                local_dataset_data = local_dataset.model_dump()
                prod_dataset_data["workload"]["frames"] = local_dataset_data["workload"]["frames"]
                self.assertEqual(prod_dataset_data, local_dataset_data)

    def test_pipeline_config_parses_frame_range(self) -> None:
        parsed = parse_pipeline_config(minimal_pipeline_config())
        dataset = parsed.dataset("gfs")
        self.assertEqual(dataset.workload.frames, ("000",))
        self.assertEqual(dataset.workload.artifacts, ("tmp_surface",))
        self.assertIn("tmp_surface", dataset.artifacts)
        self.assertEqual(dataset.artifacts["tmp_surface"].component_ids, ("value",))
        self.assertEqual(dataset.artifacts["tmp_surface"].kind, "scalar")

    def test_pipeline_config_parses_icon_dwd_icosahedral_dataset(self) -> None:
        cfg = minimal_pipeline_config()
        precip_config = precip_total_config()
        prate_config = precip_rate_config()
        wind_config = wind_artifact_config()
        cfg["artifact_catalog"]["prate_surface"] = catalog_artifact(prate_config)
        cfg["artifact_catalog"]["precip_total_surface"] = catalog_artifact(precip_config)
        cfg["artifact_catalog"]["wind10m_uv"] = catalog_artifact(wind_config)
        cfg["datasets"]["icon"] = {
            "label": "ICON",
            "source": {
                "type": "icon_dwd_icosahedral",
                "grid_id": "icon_global_regridded_0p125",
                "base_url": "https://opendata.dwd.de/weather/nwp/icon/grib",
                "rate_limit_seconds": 0.0,
            },
            "workload": {
                "frame_start": 0,
                "frame_end": 0,
                "artifacts": ["prate_surface", "precip_total_surface", "wind10m_uv"],
            },
            "artifacts": {
                "prate_surface": dataset_artifact(prate_config),
                "precip_total_surface": dataset_artifact(precip_config),
                "wind10m_uv": {
                    "components": [
                        {"id": "u", "grib_match": {"ICON_PARAM": "u_10m"}},
                        {"id": "v", "grib_match": {"ICON_PARAM": "v_10m"}},
                    ],
                },
            },
        }

        parsed = parse_pipeline_config(cfg)
        icon = parsed.dataset("icon")

        self.assertEqual(icon.source.type, "icon_dwd_icosahedral")
        self.assertIsInstance(icon.source, IconDwdSourceConfig)
        self.assertEqual(icon.workload.artifacts, ("prate_surface", "precip_total_surface", "wind10m_uv"))
        self.assertEqual(icon.artifacts["wind10m_uv"].components[1].grib_match["ICON_PARAM"], "v_10m")
        icon_prate_temporal = icon.artifacts["prate_surface"].temporal
        assert icon_prate_temporal is not None
        self.assertEqual(icon_prate_temporal.kind, "average_rate")

    def test_pipeline_config_parses_dataset_artifact_grid_transform(self) -> None:
        cfg = minimal_pipeline_config()
        pressure = pressure_msl_config(grib_match={"GRIB_ELEMENT": "PRMSL"}, grid_transform={
            "type": "regular_grid_downsample_2x",
            "grid_id": "icon_global_regridded_0p25",
        })
        cfg["artifact_catalog"]["prmsl_msl"] = catalog_artifact(pressure)
        cfg["datasets"]["gfs"]["workload"]["artifacts"] = ["prmsl_msl"]
        cfg["datasets"]["gfs"]["artifacts"] = {
            "prmsl_msl": dataset_artifact(pressure),
        }

        parsed = parse_pipeline_config(cfg)
        transform = parsed.dataset("gfs").artifacts["prmsl_msl"].grid_transform

        assert transform is not None
        self.assertEqual(transform.type, "regular_grid_downsample_2x")
        self.assertEqual(transform.grid_id, "icon_global_regridded_0p25")

    def test_pipeline_config_rejects_icon_derived_rate_with_non_hourly_interval(self) -> None:
        cfg = minimal_pipeline_config()
        prate_config = precip_rate_config()
        cfg["artifact_catalog"]["prate_surface"] = catalog_artifact(prate_config)
        cfg["datasets"]["icon"] = {
            "label": "ICON",
            "source": {
                "type": "icon_dwd_icosahedral",
                "grid_id": "icon_global_regridded_0p125",
                "base_url": "https://opendata.dwd.de/weather/nwp/icon/grib",
                "rate_limit_seconds": 0.0,
            },
            "workload": {
                "frame_start": 0,
                "frame_end": 0,
                "artifacts": ["prate_surface"],
            },
            "artifacts": {
                "prate_surface": dataset_artifact(prate_config),
            },
        }
        cfg["datasets"]["icon"]["artifacts"]["prate_surface"]["temporal"]["source_interval_hours"] = 3

        with self.assertRaises(SystemExit) as raised:
            parse_pipeline_config(cfg)

        self.assertIn("source_interval_hours=1", str(raised.exception))

    def test_pipeline_config_parses_derivation_inputs_separately_from_output_components(self) -> None:
        cfg = minimal_pipeline_config()
        artifact_config = precip_type_config()
        cfg["artifact_catalog"]["precip_type_surface"] = catalog_artifact(artifact_config)
        cfg["datasets"]["gfs"]["workload"]["artifacts"] = ["precip_type_surface"]
        cfg["datasets"]["gfs"]["artifacts"] = {
            "precip_type_surface": dataset_artifact(artifact_config),
        }

        parsed = parse_pipeline_config(cfg)
        artifact = parsed.dataset("gfs").artifacts["precip_type_surface"]

        self.assertEqual(artifact.component_ids, ("snow_frac", "mix_frac"))
        self.assertTrue(all(component.grib_match is None for component in artifact.components))
        assert artifact.derivation is not None
        self.assertEqual(
            [input_item.id for input_item in artifact.derivation.inputs],
            ["precip_rate", "frozen_percent", "rain", "freezing_rain", "ice_pellets", "snow"],
        )

    def test_pipeline_config_parses_gfs_run_total_precip_derivation(self) -> None:
        cfg = minimal_pipeline_config()
        artifact_config = gfs_precip_total_config()
        cfg["artifact_catalog"]["precip_total_surface"] = catalog_artifact(artifact_config)
        cfg["datasets"]["gfs"]["workload"]["artifacts"] = ["precip_total_surface"]
        cfg["datasets"]["gfs"]["artifacts"] = {
            "precip_total_surface": dataset_artifact(artifact_config),
        }

        parsed = parse_pipeline_config(cfg)
        artifact = parsed.dataset("gfs").artifacts["precip_total_surface"]

        self.assertEqual(artifact.component_ids, ("value",))
        self.assertTrue(all(component.grib_match is None for component in artifact.components))
        assert artifact.temporal is not None
        self.assertEqual(artifact.temporal.kind, "accumulation")
        assert artifact.derivation is not None
        self.assertEqual(artifact.derivation.type, "gfs_run_total_precip")
        self.assertEqual(artifact.derivation.inputs[0].grib_match["GRIB_ELEMENT__prefix"], "APCP")

    def test_pipeline_config_rejects_gfs_precip_type_without_derivation_inputs(self) -> None:
        cfg = minimal_pipeline_config()
        artifact_config = precip_type_config()
        artifact_config["derivation"]["inputs"] = []
        cfg["artifact_catalog"]["precip_type_surface"] = catalog_artifact(artifact_config)
        cfg["datasets"]["gfs"]["workload"]["artifacts"] = ["precip_type_surface"]
        cfg["datasets"]["gfs"]["artifacts"] = {
            "precip_type_surface": dataset_artifact(artifact_config),
        }

        with self.assertRaises(SystemExit) as raised:
            parse_pipeline_config(cfg)

        self.assertIn("requires derivation.inputs", str(raised.exception))

    def test_pipeline_config_rejects_derived_output_component_source_selector(self) -> None:
        cfg = minimal_pipeline_config()
        artifact_config = precip_type_config()
        artifact_config["components"][0]["grib_match"] = {"GRIB_ELEMENT": "CRAIN"}
        cfg["artifact_catalog"]["precip_type_surface"] = catalog_artifact(artifact_config)
        cfg["datasets"]["gfs"]["workload"]["artifacts"] = ["precip_type_surface"]
        cfg["datasets"]["gfs"]["artifacts"] = {
            "precip_type_surface": dataset_artifact(artifact_config),
        }

        with self.assertRaises(SystemExit) as raised:
            parse_pipeline_config(cfg)

        self.assertIn("put source selectors in derivation.inputs", str(raised.exception))

    def test_pipeline_config_parses_icon_weather_code_thunderstorm_artifact(self) -> None:
        cfg = minimal_pipeline_config()
        thunderstorm = thunderstorm_mask_config()
        cfg["artifact_catalog"]["thunderstorm_mask"] = catalog_artifact(thunderstorm)
        cfg["datasets"]["icon"] = {
            "label": "ICON",
            "source": {
                "type": "icon_dwd_icosahedral",
                "grid_id": "icon_global_regridded_0p125",
                "base_url": "https://opendata.dwd.de/weather/nwp/icon/grib",
                "rate_limit_seconds": 0.0,
            },
            "workload": {
                "frame_start": 0,
                "frame_end": 0,
                "artifacts": ["thunderstorm_mask"],
            },
            "artifacts": {
                "thunderstorm_mask": dataset_artifact(thunderstorm),
            },
        }

        parsed = parse_pipeline_config(cfg)
        icon = parsed.dataset("icon")

        self.assertEqual(icon.artifacts["thunderstorm_mask"].derivation.inputs[0].grib_match["ICON_PARAM"], "ww")

    def test_pipeline_config_parses_icon_precip_type_component_overlay(self) -> None:
        cfg = minimal_pipeline_config()
        precip_type = icon_precip_type_config()
        cfg["artifact_catalog"]["precip_type_surface"] = catalog_artifact(precip_type)
        cfg["datasets"]["icon"] = {
            "label": "ICON",
            "source": {
                "type": "icon_dwd_icosahedral",
                "grid_id": "icon_global_regridded_0p125",
                "base_url": "https://opendata.dwd.de/weather/nwp/icon/grib",
                "rate_limit_seconds": 0.0,
            },
            "workload": {
                "frame_start": 0,
                "frame_end": 0,
                "artifacts": ["precip_type_surface"],
            },
            "artifacts": {
                "precip_type_surface": dataset_artifact(precip_type),
            },
        }

        parsed = parse_pipeline_config(cfg)
        artifact = parsed.dataset("icon").artifacts["precip_type_surface"]

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
        cfg["datasets"]["icon"] = {
            "label": "ICON",
            "source": {
                "type": "icon_dwd_icosahedral",
                "grid_id": "icon_global_regridded_0p125",
                "base_url": "https://opendata.dwd.de/weather/nwp/icon/grib",
                "rate_limit_seconds": 0.0,
            },
            "workload": {
                "frame_start": 0,
                "frame_end": 0,
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

    def test_pipeline_config_rejects_invalid_frame_range(self) -> None:
        bad_cfg = minimal_pipeline_config()
        _gfs(bad_cfg)["workload"]["frame_start"] = 12
        _gfs(bad_cfg)["workload"]["frame_end"] = 6

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
            parsed.dataset("gfs").artifacts["tmp_surface"].source_transform,
            "kg_m2_s_to_mm_hr",
        )

    def test_pipeline_config_accepts_linear_encoding_finite_value_range(self) -> None:
        cfg = minimal_pipeline_config()
        cfg["artifact_catalog"]["tmp_surface"]["encoding"]["finite_value_range"] = {
            "min": -50,
            "max": 50,
        }

        parsed = parse_pipeline_config(cfg)
        finite_value_range = parsed.dataset("gfs").artifacts["tmp_surface"].encoding.finite_value_range

        assert finite_value_range is not None
        self.assertEqual(finite_value_range.min, -50)
        self.assertEqual(finite_value_range.max, 50)

    def test_pipeline_config_rejects_invalid_finite_value_range(self) -> None:
        cases = (
            {"min": 10, "max": 0},
            {"min": 0},
            {"min": 0, "max": float("inf")},
        )

        for finite_value_range in cases:
            bad_cfg = minimal_pipeline_config()
            bad_cfg["artifact_catalog"]["tmp_surface"]["encoding"]["finite_value_range"] = finite_value_range

            with self.subTest(finite_value_range=finite_value_range), self.assertRaises(SystemExit):
                parse_pipeline_config(bad_cfg)

    def test_pipeline_config_rejects_finite_value_range_for_piecewise_encoding(self) -> None:
        bad_cfg = minimal_pipeline_config()
        bad_cfg["artifact_catalog"]["tmp_surface"]["encoding"] = {
            "id": "tmp_surface_i8_temp_c_piecewise_v1",
            "format": "temp-c-piecewise-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "nodata": -128,
            "finite_value_range": {"min": -35, "max": 50},
        }

        with self.assertRaises(SystemExit) as raised:
            parse_pipeline_config(bad_cfg)

        self.assertIn("finite_value_range is not supported", str(raised.exception))

    def test_pipeline_config_rejects_finite_value_range_endpoint_that_quantizes_to_nodata(self) -> None:
        bad_cfg = minimal_pipeline_config()
        bad_cfg["artifact_catalog"]["tmp_surface"]["encoding"] = {
            "id": "tmp_surface_i8_test_v1",
            "format": "linear-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "scale": 1,
            "offset": 128,
            "nodata": -128,
            "finite_value_range": {"min": 0, "max": 1},
        }

        with self.assertRaises(SystemExit) as raised:
            parse_pipeline_config(bad_cfg)

        self.assertIn("quantizes to the nodata sentinel", str(raised.exception))

    def test_pipeline_config_rejects_finite_value_range_endpoint_between_encoding_buckets(self) -> None:
        bad_cfg = minimal_pipeline_config()
        bad_cfg["artifact_catalog"]["tmp_surface"]["encoding"] = {
            "id": "tmp_surface_i8_test_v1",
            "format": "linear-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "scale": 2,
            "offset": 0,
            "nodata": -128,
            "finite_value_range": {"min": 0, "max": 99},
        }

        with self.assertRaises(SystemExit) as raised:
            parse_pipeline_config(bad_cfg)

        self.assertIn("must be exactly representable", str(raised.exception))

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
            parsed.dataset("gfs").artifacts["tmp_surface"].encoding.format,
            "temp-c-piecewise-i8-v1",
        )

    def test_pipeline_config_rejects_invalid_encoding_format_names(self) -> None:
        bad_cfg = minimal_pipeline_config()
        bad_cfg["artifact_catalog"]["tmp_surface"]["encoding"]["format"] = "scalar-i16-linear-v1"

        with self.assertRaises(SystemExit):
            parse_pipeline_config(bad_cfg)

    def test_pipeline_config_rejects_dataset_artifact_missing_component_match(self) -> None:
        cfg = minimal_pipeline_config()
        add_dataset_artifact(
            cfg,
            dataset_id="gfs",
            artifact_id="cloud_layers",
            artifact_config=cloud_layers_config(),
        )
        _gfs(cfg)["workload"]["artifacts"] = ["cloud_layers"]
        del _gfs(cfg)["artifacts"]["cloud_layers"]["components"][0]["grib_match"]

        with self.assertRaises(SystemExit):
            parse_pipeline_config(cfg)

    def test_pipeline_config_rejects_dataset_artifact_with_unknown_component(self) -> None:
        cfg = minimal_pipeline_config()
        add_dataset_artifact(
            cfg,
            dataset_id="gfs",
            artifact_id="cloud_layers",
            artifact_config=cloud_layers_config(),
        )
        _gfs(cfg)["workload"]["artifacts"] = ["cloud_layers"]
        _gfs(cfg)["artifacts"]["cloud_layers"]["components"].append(
            {"id": "ceiling", "grib_match": {"GRIB_ELEMENT": "CEIL"}}
        )

        with self.assertRaises(SystemExit):
            parse_pipeline_config(cfg)
