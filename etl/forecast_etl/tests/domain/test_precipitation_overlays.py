from __future__ import annotations

import struct
import unittest
from unittest.mock import patch

from forecast_etl.derivations import previous_icon_param_key
from forecast_etl.proc import RunResult
from forecast_etl.tests.fixtures.artifact_configs import (
    artifact_spec,
    icon_precip_type_config,
    precip_type_config,
    thunderstorm_mask_config,
)
from forecast_etl.tests.fixtures.execution import artifact_run_fixture
from forecast_etl.tests.fixtures.grids import grid_meta_fixture, pack_f32


def _unused_run(*_args: object, **_kwargs: object) -> RunResult:
    return RunResult(argv=(), returncode=0)


class PrecipitationOverlayArtifactTest(unittest.TestCase):
    def test_gfs_precip_type_derives_soft_overlay_components(self) -> None:
        with artifact_run_fixture(prefix="weather-map-gfs-precip-type-artifact-") as fx:
            rate = pack_f32(
                [0, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.00001, 0.001, float("nan"), 0.001],
                byte_order="little",
            )
            frozen_percent = pack_f32([0, 0, 0, 0, 0, 0, 70, 100, 100, float("nan"), 100, 0], byte_order="little")
            rain = pack_f32([0, 1, 0, 0, 0, 1, 0, 0, 0, float("nan"), 0, 0], byte_order="little")
            freezing_rain = pack_f32([0, 0, 1, 0, 0, 0, 0, 0, 0, float("nan"), 0, 1], byte_order="little")
            ice_pellets = pack_f32([0, 0, 0, 1, 0, 0, 0, 0, 0, float("nan"), 0, 0], byte_order="little")
            snow = pack_f32([0, 0, 0, 0, 1, 1, 0, 0, 1, float("nan"), 0, 1], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    side_effect=[
                        (1, {"GRIB_ELEMENT": "PRATE", "GRIB_SHORT_NAME": "0-SFC", "GRIB_PDS_PDTN": "0"}),
                        (2, {"GRIB_ELEMENT": "CPOFP", "GRIB_SHORT_NAME": "0-SFC"}),
                        (3, {"GRIB_ELEMENT": "CRAIN", "GRIB_SHORT_NAME": "0-SFC"}),
                        (4, {"GRIB_ELEMENT": "CFRZR", "GRIB_SHORT_NAME": "0-SFC"}),
                        (5, {"GRIB_ELEMENT": "CICEP", "GRIB_SHORT_NAME": "0-SFC"}),
                        (6, {"GRIB_ELEMENT": "CSNOW", "GRIB_SHORT_NAME": "0-SFC"}),
                    ],
                ) as find_band,
                patch(
                    "forecast_etl.extract.source_bands.extract_float32_band_bytes",
                    side_effect=[
                        (rate, "little"),
                        (frozen_percent, "little"),
                        (rain, "little"),
                        (freezing_rain, "little"),
                        (ice_pellets, "little"),
                        (snow, "little"),
                    ],
                ),
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=grid_meta_fixture(),
                ),
            ):
                result = fx.run_artifact(
                    artifact_id="precip_type_surface",
                    artifact_config=precip_type_config(),
                    source=fx.single_grib_source(),
                    run=_unused_run,
                )

            payload_bytes = fx.payload_bytes(artifact_id="precip_type_surface", dtype="int8")
            self.assertEqual(
                payload_bytes,
                struct.pack(
                    "bbbbbbbbbbbbbbbbbbbbbbbb",
                    -127,
                    -127,
                    -127,
                    -127,
                    127,
                    -64,
                    0,
                    127,
                    -127,
                    -127,
                    -128,
                    -127,
                    -127,
                    -127,
                    127,
                    127,
                    -127,
                    64,
                    -101,
                    -127,
                    -127,
                    -127,
                    -128,
                    127,
                ),
            )
            self.assertEqual(
                [call.args[1]["GRIB_ELEMENT"] for call in find_band.call_args_list],
                ["PRATE", "CPOFP", "CRAIN", "CFRZR", "CICEP", "CSNOW"],
            )
            self.assertEqual(result["encoding_id"], "precip_type_surface_i8_frac_v1")
            self.assertEqual(result["components"], ["snow_frac", "mix_frac"])
            self.assertEqual(result["units"], "fraction")

    def test_icon_precip_type_derives_soft_overlay_components_from_accumulations(self) -> None:
        with artifact_run_fixture(
            prefix="weather-map-icon-precip-type-artifact-",
            dataset_id="icon",
            source_uri="icon-dwd://icon/2026041200/003",
        ) as fx:
            source_paths = {
                icon_param: fx.grib_path(f"{icon_param}.regridded.grib2")
                for icon_param in ("rain_gsp", "rain_con", "snow_gsp", "snow_con")
            }
            previous_source_paths = {
                previous_icon_param_key(icon_param): fx.grib_path(f"{icon_param}.previous.regridded.grib2")
                for icon_param in ("rain_gsp", "rain_con", "snow_gsp", "snow_con")
            }
            previous = [10.0] * 12

            def accumulation_values(deltas: list[float]) -> bytes:
                values = [
                    float("nan") if value != value else previous[index] + value
                    for index, value in enumerate(deltas)
                ]
                return pack_f32(values, byte_order="little")

            current_rain_gsp = accumulation_values([1, 0, 0.5, 0.04, float("nan"), 0.2, 0, 0, 0, 0, 0, 0])
            current_rain_con = accumulation_values([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
            current_snow_gsp = accumulation_values([0, 1, 0.5, 0, 0, 0.8, 0, 0, 0, 0, 0, 0])
            current_snow_con = accumulation_values([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
            previous_bytes = pack_f32(previous, byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    return_value=(1, {"ICON_PARAM": "precip_component"}),
                ),
                patch(
                    "forecast_etl.extract.source_bands.extract_float32_band_bytes",
                    side_effect=[
                        (current_rain_gsp, "little"),
                        (previous_bytes, "little"),
                        (current_rain_con, "little"),
                        (previous_bytes, "little"),
                        (current_snow_gsp, "little"),
                        (previous_bytes, "little"),
                        (current_snow_con, "little"),
                        (previous_bytes, "little"),
                    ],
                ),
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=grid_meta_fixture(),
                ),
            ):
                result = fx.run_artifact(
                    artifact_id="precip_type_surface",
                    artifact_config=icon_precip_type_config(),
                    source=fx.grib_collection_source(
                        grib_paths={
                            **source_paths,
                            **previous_source_paths,
                        },
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

            payload_bytes = fx.payload_bytes(artifact_id="precip_type_surface", dtype="int8")
            self.assertEqual(
                payload_bytes,
                struct.pack(
                    "bbbbbbbbbbbbbbbbbbbbbbbb",
                    -127,
                    127,
                    -127,
                    -127,
                    -128,
                    0,
                    -127,
                    -127,
                    -127,
                    -127,
                    -127,
                    -127,
                    -127,
                    -127,
                    127,
                    -127,
                    -128,
                    -127,
                    -127,
                    -127,
                    -127,
                    -127,
                    -127,
                    -127,
                ),
            )
            self.assertEqual(result["encoding_id"], "precip_type_surface_i8_frac_v1")
            self.assertEqual(result["components"], ["snow_frac", "mix_frac"])
            self.assertEqual(result["units"], "fraction")

    def test_icon_weather_code_derives_thunderstorm_mask(self) -> None:
        with artifact_run_fixture(
            prefix="weather-map-icon-thunderstorm-artifact-",
            dataset_id="icon",
            source_uri="icon-dwd://icon/2026041200/003",
        ) as fx:
            weather_code_path = fx.grib_path("ww.regridded.grib2")
            weather_codes = pack_f32([0, 95, 96, 97, 98, 99, 51, float("nan"), 0, 0, 0, 0], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    return_value=(1, {"ICON_PARAM": "ww"}),
                ),
                patch(
                    "forecast_etl.extract.source_bands.extract_float32_band_bytes",
                    return_value=(weather_codes, "little"),
                ),
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=grid_meta_fixture(),
                ),
            ):
                result = fx.run_artifact(
                    artifact_id="thunderstorm_mask",
                    artifact_config=thunderstorm_mask_config(),
                    source=fx.grib_collection_source(
                        grib_paths={"ww": weather_code_path},
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

            payload_bytes = fx.payload_bytes(artifact_id="thunderstorm_mask", dtype="int8")
            self.assertEqual(payload_bytes, struct.pack("bbbbbbbbbbbb", 0, 1, 1, 1, 1, 1, 0, -128, 0, 0, 0, 0))
            self.assertEqual(result["encoding_id"], "thunderstorm_mask_i8_flag_v1")
            self.assertEqual(result["units"], "flag")

    def test_unsupported_derivation_type_fails_clearly(self) -> None:
        artifact_config = precip_type_config()
        artifact_config["derivation"]["type"] = "not_supported"

        with self.assertRaises(SystemExit) as raised:
            artifact_spec("precip_type_surface", artifact_config)

        self.assertIn("type must be one of", str(raised.exception))



if __name__ == "__main__":
    unittest.main()
