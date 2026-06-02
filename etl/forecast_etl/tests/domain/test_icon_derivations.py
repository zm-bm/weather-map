from __future__ import annotations

import struct
import unittest
from unittest.mock import patch

from forecast_etl.derivations import previous_icon_param_key
from forecast_etl.proc import RunResult
from forecast_etl.tests.fixtures.artifact_configs import (
    cloud_layers_config,
    precip_rate_config,
    precip_total_config,
    pressure_msl_config,
    wind_artifact_config,
)
from forecast_etl.tests.fixtures.execution import artifact_run_fixture
from forecast_etl.tests.fixtures.grids import grid_meta_fixture, pack_f32, small_grid_meta_fixture


def _unused_run(*_args: object, **_kwargs: object) -> RunResult:
    return RunResult(argv=(), returncode=0)


class IconArtifactDerivationTest(unittest.TestCase):
    def test_precip_total_scalar_uses_icon_param_grib_path_and_encoding(self) -> None:
        with artifact_run_fixture(
            prefix="weather-map-icon-precip-artifact-",
            dataset_id="icon",
            source_uri="icon-dwd://icon/2026041200/003",
        ) as fx:
            grib_path = fx.grib_path("tot_prec.regridded.grib2")
            source = pack_f32([0.0, 1.0, 254.0, float("nan")], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    return_value=(1, {"GRIB_ELEMENT": "TOT_PREC"}),
                ) as find_band,
                patch(
                    "forecast_etl.extract.source_bands.extract_float32_band_bytes",
                    return_value=(source, "little"),
                ) as extract_band,
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=small_grid_meta_fixture(),
                ),
            ):
                result = fx.run_artifact(
                    artifact_id="precip_total_surface",
                    artifact_config=precip_total_config(),
                    source=fx.grib_collection_source(
                        grib_paths={"tot_prec": grib_path},
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

            find_band.assert_called_once_with(grib_path, {}, run=_unused_run)
            self.assertEqual(extract_band.call_args.kwargs["grib_path"], grib_path)
            payload_bytes = fx.payload_bytes(artifact_id="precip_total_surface", dtype="int8")
            expected_payload = struct.pack("bbbb", -127, -126, 127, -128)
            self.assertEqual(payload_bytes, expected_payload)
            self.assertEqual(
                result["payload_uri"],
                f"{fx.artifact_root_uri}/runs/icon/2026041200/{fx.run_id}/fields/003/"
                "precip_total_surface.field.i8.bin",
            )
            self.assertEqual(result["encoding_id"], "precip_total_surface_i8_1mm_v1")
            self.assertEqual(result["units"], "mm")
            self.assertEqual(result["grid_id"], "icon_global_regridded_0p125")

    def test_icon_pressure_can_publish_downsampled_grid(self) -> None:
        with artifact_run_fixture(
            prefix="weather-map-icon-pressure-downsample-",
            dataset_id="icon",
            source_uri="icon-dwd://icon/2026041200/003",
        ) as fx:
            grib_path = fx.grib_path("pmsl.regridded.grib2")
            source = pack_f32([100500.0] * 15, byte_order="little")
            source_grid = {
                **grid_meta_fixture(),
                "nx": 5,
                "ny": 3,
                "lon0": 180.0,
                "dx": 0.125,
                "dy": -0.125,
            }

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    return_value=(1, {"GRIB_ELEMENT": "PMSL"}),
                ),
                patch(
                    "forecast_etl.extract.source_bands.extract_float32_band_bytes",
                    return_value=(source, "little"),
                ),
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=source_grid,
                ),
            ):
                result = fx.run_artifact(
                    artifact_id="prmsl_msl",
                    artifact_config=pressure_msl_config(grid_transform={
                        "type": "regular_grid_downsample_2x",
                        "grid_id": "icon_global_regridded_0p25",
                    }),
                    source=fx.grib_collection_source(
                        grib_paths={"pmsl": grib_path},
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

            payload_bytes = fx.payload_bytes(artifact_id="prmsl_msl", dtype="int8")
            self.assertEqual(payload_bytes, b"\x00" * 6)
            self.assertEqual(result["byte_length"], 6)
            self.assertEqual(result["grid_id"], "icon_global_regridded_0p25")
            self.assertEqual(result["grid"]["nx"], 3)
            self.assertEqual(result["grid"]["ny"], 2)
            self.assertEqual(result["grid"]["dx"], 0.25)
            self.assertEqual(result["grid"]["dy"], -0.25)

    def test_precip_rate_derives_icon_rate_from_adjacent_tot_prec_accumulations(self) -> None:
        with artifact_run_fixture(
            prefix="weather-map-icon-prate-artifact-",
            dataset_id="icon",
            source_uri="icon-dwd://icon/2026041200/003",
        ) as fx:
            current_path = fx.grib_path("tot_prec.current.regridded.grib2")
            previous_path = fx.grib_path("tot_prec.previous.regridded.grib2")
            current = pack_f32([1.0, 2.08, 0.0, float("nan")], byte_order="little")
            previous = pack_f32([0.0, 0.08, 0.0, 0.0], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    side_effect=[
                        (1, {"GRIB_ELEMENT": "TOT_PREC"}),
                        (1, {"GRIB_ELEMENT": "TOT_PREC"}),
                    ],
                ) as find_band,
                patch(
                    "forecast_etl.extract.source_bands.extract_float32_band_bytes",
                    side_effect=[
                        (current, "little"),
                        (previous, "little"),
                    ],
                ),
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=small_grid_meta_fixture(),
                ),
            ):
                result = fx.run_artifact(
                    artifact_id="prate_surface",
                    artifact_config=precip_rate_config(),
                    source=fx.grib_collection_source(
                        grib_paths={
                            "tot_prec": current_path,
                            previous_icon_param_key("tot_prec"): previous_path,
                        },
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

            called_paths = [call.args[0] for call in find_band.call_args_list]
            self.assertEqual(called_paths, [current_path, previous_path])
            payload_bytes = fx.payload_bytes(artifact_id="prate_surface", dtype="int8")
            self.assertEqual(payload_bytes, struct.pack("bbbb", -120, -114, -127, -128))
            self.assertEqual(result["encoding_id"], "prate_surface_i8_0p15mmhr_v1")
            self.assertEqual(result["units"], "mm/hr")

    def test_precip_rate_uses_zero_previous_for_first_icon_hour(self) -> None:
        with artifact_run_fixture(
            prefix="weather-map-icon-prate-first-artifact-",
            dataset_id="icon",
            frame_id="001",
            source_uri="icon-dwd://icon/2026041200/001",
        ) as fx:
            current_path = fx.grib_path("tot_prec.current.regridded.grib2")
            current = pack_f32([1.0, 2.0, 0.0, float("nan")], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    return_value=(1, {"GRIB_ELEMENT": "TOT_PREC"}),
                ) as find_band,
                patch(
                    "forecast_etl.extract.source_bands.extract_float32_band_bytes",
                    return_value=(current, "little"),
                ),
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=small_grid_meta_fixture(),
                ),
            ):
                fx.run_artifact(
                    artifact_id="prate_surface",
                    artifact_config=precip_rate_config(),
                    source=fx.grib_collection_source(
                        grib_paths={"tot_prec": current_path},
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

            find_band.assert_called_once()
            payload_bytes = fx.payload_bytes(artifact_id="prate_surface", dtype="int8")
            self.assertEqual(payload_bytes, struct.pack("bbbb", -120, -114, -127, -128))

    def test_precip_rate_clamps_small_negative_icon_accumulation_delta(self) -> None:
        with artifact_run_fixture(
            prefix="weather-map-icon-prate-clamp-artifact-",
            dataset_id="icon",
            source_uri="icon-dwd://icon/2026041200/003",
        ) as fx:
            current_path = fx.grib_path("tot_prec.current.regridded.grib2")
            previous_path = fx.grib_path("tot_prec.previous.regridded.grib2")
            current = pack_f32([1.0, 1.0, 0.0, 0.0], byte_order="little")
            previous = pack_f32([1.002, 1.0, 0.0, 0.0], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    side_effect=[
                        (1, {"GRIB_ELEMENT": "TOT_PREC"}),
                        (1, {"GRIB_ELEMENT": "TOT_PREC"}),
                    ],
                ),
                patch(
                    "forecast_etl.extract.source_bands.extract_float32_band_bytes",
                    side_effect=[
                        (current, "little"),
                        (previous, "little"),
                    ],
                ),
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=small_grid_meta_fixture(),
                ),
            ):
                fx.run_artifact(
                    artifact_id="prate_surface",
                    artifact_config=precip_rate_config(),
                    source=fx.grib_collection_source(
                        grib_paths={
                            "tot_prec": current_path,
                            previous_icon_param_key("tot_prec"): previous_path,
                        },
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

            payload_bytes = fx.payload_bytes(artifact_id="prate_surface", dtype="int8")
            self.assertEqual(payload_bytes, struct.pack("bbbb", -127, -127, -127, -127))

    def test_precip_rate_rejects_meaningful_negative_icon_accumulation_delta(self) -> None:
        with artifact_run_fixture(
            prefix="weather-map-icon-prate-negative-artifact-",
            dataset_id="icon",
            source_uri="icon-dwd://icon/2026041200/003",
        ) as fx:
            current_path = fx.grib_path("tot_prec.current.regridded.grib2")
            previous_path = fx.grib_path("tot_prec.previous.regridded.grib2")
            current = pack_f32([1.0, 1.0, 0.0, 0.0], byte_order="little")
            previous = pack_f32([1.02, 1.0, 0.0, 0.0], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    side_effect=[
                        (1, {"GRIB_ELEMENT": "TOT_PREC"}),
                        (1, {"GRIB_ELEMENT": "TOT_PREC"}),
                    ],
                ),
                patch(
                    "forecast_etl.extract.source_bands.extract_float32_band_bytes",
                    side_effect=[
                        (current, "little"),
                        (previous, "little"),
                    ],
                ),
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=small_grid_meta_fixture(),
                ),
            ):
                with self.assertRaises(SystemExit) as raised:
                    fx.run_artifact(
                        artifact_id="prate_surface",
                        artifact_config=precip_rate_config(),
                        source=fx.grib_collection_source(
                            grib_paths={
                                "tot_prec": current_path,
                                previous_icon_param_key("tot_prec"): previous_path,
                            },
                            grid_id="icon_global_regridded_0p125",
                        ),
                        run=_unused_run,
                    )

        self.assertIn("Negative accumulation delta", str(raised.exception))

    def test_icon_cloud_layers_use_configured_component_grib_paths(self) -> None:
        with artifact_run_fixture(
            prefix="weather-map-icon-cloud-artifact-",
            dataset_id="icon",
            source_uri="icon-dwd://icon/2026041200/003",
        ) as fx:
            paths = {
                "clcl": fx.grib_path("clcl.regridded.grib2"),
                "clcm": fx.grib_path("clcm.regridded.grib2"),
                "clch": fx.grib_path("clch.regridded.grib2"),
            }
            artifact_config = cloud_layers_config(
                grib_matches={
                    "low": {"ICON_PARAM": "clcl"},
                    "middle": {"ICON_PARAM": "clcm"},
                    "high": {"ICON_PARAM": "clch"},
                }
            )
            component_source = pack_f32([0.0, 5.0, 10.0, 15.0], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    side_effect=[
                        (1, {"id": "low"}),
                        (1, {"id": "middle"}),
                        (1, {"id": "high"}),
                    ],
                ) as find_band,
                patch(
                    "forecast_etl.extract.source_bands.extract_float32_band_bytes",
                    side_effect=[
                        (component_source, "little"),
                        (component_source, "little"),
                        (component_source, "little"),
                    ],
                ),
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=small_grid_meta_fixture(),
                ),
            ):
                fx.run_artifact(
                    artifact_id="cloud_layers",
                    artifact_config=artifact_config,
                    source=fx.grib_collection_source(
                        grib_paths=paths,
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

        called_paths = [call.args[0] for call in find_band.call_args_list]
        self.assertEqual(called_paths, [paths["clcl"], paths["clcm"], paths["clch"]])

    def test_icon_wind_uses_u_and_v_grib_paths(self) -> None:
        with artifact_run_fixture(
            prefix="weather-map-icon-wind-artifact-",
            dataset_id="icon",
            source_uri="icon-dwd://icon/2026041200/003",
        ) as fx:
            paths = {
                "u_10m": fx.grib_path("u_10m.regridded.grib2"),
                "v_10m": fx.grib_path("v_10m.regridded.grib2"),
            }

            artifact_config = wind_artifact_config()
            artifact_config["components"][0]["grib_match"] = {"ICON_PARAM": "u_10m"}
            artifact_config["components"][1]["grib_match"] = {"ICON_PARAM": "v_10m"}
            u_src = pack_f32([1.0, 2.0, 3.0, 4.0], byte_order="little")
            v_src = pack_f32([-1.0, -2.0, -3.0, -4.0], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    side_effect=[(1, {"id": "u"}), (1, {"id": "v"})],
                ) as find_band,
                patch(
                    "forecast_etl.extract.source_bands.extract_float32_band_bytes",
                    side_effect=[(u_src, "little"), (v_src, "little")],
                ),
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=small_grid_meta_fixture(),
                ),
            ):
                fx.run_artifact(
                    artifact_id="wind10m_uv",
                    artifact_config=artifact_config,
                    source=fx.grib_collection_source(
                        grib_paths=paths,
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

        called_paths = [call.args[0] for call in find_band.call_args_list]
        self.assertEqual(called_paths, [paths["u_10m"], paths["v_10m"]])

if __name__ == "__main__":
    unittest.main()
