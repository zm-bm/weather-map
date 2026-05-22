from __future__ import annotations

import hashlib
import struct
import unittest
from unittest.mock import patch

from forecast_etl.derivations import previous_icon_param_key
from forecast_etl.encoding.codecs import FORMAT_LINEAR_I8, encode_component_payload
from forecast_etl.proc import RunResult
from forecast_etl.tests.fixtures.artifact_configs import (
    artifact_spec,
    cin_index_config,
    cloud_layers_config,
    icon_precip_type_config,
    minimal_artifact_config,
    precip_rate_config,
    precip_total_config,
    precip_type_config,
    pressure_msl_config,
    reflectivity_config,
    thunderstorm_mask_config,
    wind_artifact_config,
)
from forecast_etl.tests.fixtures.execution import artifact_run_fixture
from forecast_etl.tests.fixtures.grids import grid_meta_fixture, pack_f32, small_grid_meta_fixture


def _unused_run(*_args: object, **_kwargs: object) -> RunResult:
    return RunResult(argv=(), returncode=0)


class ScalarArtifactContractTest(unittest.TestCase):
    def test_single_band_scalar_artifact_writes_scalar_payload(self) -> None:
        with artifact_run_fixture(prefix="weather-map-scalar-artifact-") as fx:
            source = pack_f32([0.0, 1.0, 2.0, float("nan")], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    return_value=(1, {"GRIB_ELEMENT": "TMP"}),
                ),
                patch(
                    "forecast_etl.extract.source_bands.extract_float32_band_bytes",
                    return_value=(source, "little"),
                ),
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=small_grid_meta_fixture(),
                ),
            ):
                result = fx.run_artifact(
                    artifact_id="tmp_surface",
                    artifact_config=minimal_artifact_config(),
                    source=fx.single_grib_source(),
                    run=_unused_run,
                )

            payload_uri = fx.payload_uri(artifact_id="tmp_surface", dtype="int16")
            payload_path = fx.payload_path(artifact_id="tmp_surface", dtype="int16")
            self.assertEqual(result["payload_uri"], payload_uri)
            self.assertTrue(payload_path.exists())

            payload_bytes = fx.payload_bytes(artifact_id="tmp_surface", dtype="int16")
            self.assertEqual(
                payload_bytes,
                struct.pack("<hhhh", 0, 100, 200, -32768),
            )
            self.assertEqual(result["byte_length"], len(payload_bytes))
            self.assertEqual(result["sha256"], hashlib.sha256(payload_bytes).hexdigest())
            self.assertEqual(result["grid"]["lon0"], -180.0)
            self.assertEqual(result["grid"]["lat0"], 90.0)

    def test_reflectivity_artifact_writes_dbz_payload(self) -> None:
        with artifact_run_fixture(prefix="weather-map-reflectivity-artifact-") as fx:
            source_grib = fx.single_grib_source()
            source = pack_f32([0.0, 31.5, 75.0, float("nan")], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    return_value=(1, {"GRIB_ELEMENT": "REFC", "GRIB_SHORT_NAME": "0-EATM"}),
                ) as find_band,
                patch(
                    "forecast_etl.extract.source_bands.extract_float32_band_bytes",
                    return_value=(source, "little"),
                ),
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=small_grid_meta_fixture(),
                ),
            ):
                result = fx.run_artifact(
                    artifact_id="refc_entire_atmosphere",
                    artifact_config=reflectivity_config(),
                    source=source_grib,
                    run=_unused_run,
                )

            find_band.assert_called_once_with(
                source_grib.reference_grib_path(),
                {"GRIB_ELEMENT": "REFC", "GRIB_SHORT_NAME": "0-EATM"},
                run=_unused_run,
            )
            payload_bytes = fx.payload_bytes(artifact_id="refc_entire_atmosphere", dtype="int8")
            self.assertEqual(payload_bytes, struct.pack("bbbb", -63, 0, 87, -128))
            self.assertEqual(result["encoding_id"], "refc_entire_atmosphere_i8_0p5dbz_v1")
            self.assertEqual(result["units"], "dBZ")
            self.assertEqual(result["parameter"], "refc")

    def test_cin_artifact_writes_positive_magnitude_payload(self) -> None:
        with artifact_run_fixture(prefix="weather-map-cin-artifact-") as fx:
            source_grib = fx.single_grib_source()
            source = pack_f32([-50.0, 100.0, 500.0, float("nan")], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    return_value=(1, {"GRIB_ELEMENT": "CIN", "GRIB_SHORT_NAME": "18000-0-SPDL"}),
                ) as find_band,
                patch(
                    "forecast_etl.extract.source_bands.extract_float32_band_bytes",
                    return_value=(source, "little"),
                ),
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=small_grid_meta_fixture(),
                ),
            ):
                result = fx.run_artifact(
                    artifact_id="cin_index",
                    artifact_config=cin_index_config(),
                    source=source_grib,
                    run=_unused_run,
                )

            find_band.assert_called_once_with(
                source_grib.reference_grib_path(),
                {"GRIB_ELEMENT": "CIN", "GRIB_SHORT_NAME": "18000-0-SPDL"},
                run=_unused_run,
            )
            payload_bytes = fx.payload_bytes(artifact_id="cin_index", dtype="int8")
            self.assertEqual(payload_bytes, struct.pack("bbbb", -102, -77, 123, -128))
            self.assertEqual(result["encoding_id"], "cin_index_i8_2jkg_v1")
            self.assertEqual(result["units"], "J/kg")
            self.assertEqual(result["parameter"], "cin")

    def test_cloud_layers_artifact_writes_three_component_vector_payload(self) -> None:
        with artifact_run_fixture(prefix="weather-map-cloud-artifact-") as fx:
            low_src = pack_f32([0.0, 5.0, 100.0, float("nan")], byte_order="little")
            middle_src = pack_f32([10.0, 20.0, float("nan"), 80.0], byte_order="little")
            high_src = pack_f32([100.0, 50.0, 0.0, 25.0], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    side_effect=[
                        (1, {"GRIB_ELEMENT": "LCDC"}),
                        (2, {"GRIB_ELEMENT": "MCDC"}),
                        (3, {"GRIB_ELEMENT": "HCDC"}),
                    ],
                ),
                patch(
                    "forecast_etl.extract.source_bands.extract_float32_band_bytes",
                    side_effect=[
                        (low_src, "little"),
                        (middle_src, "little"),
                        (high_src, "little"),
                    ],
                ),
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=small_grid_meta_fixture(),
                ),
            ):
                result = fx.run_artifact(
                    artifact_id="cloud_layers",
                    artifact_config=cloud_layers_config(),
                    source=fx.single_grib_source(),
                    run=_unused_run,
                )

            payload_uri = fx.payload_uri(artifact_id="cloud_layers", dtype="int8")
            payload_path = fx.payload_path(artifact_id="cloud_layers", dtype="int8")
            self.assertEqual(result["payload_uri"], payload_uri)
            self.assertTrue(payload_path.exists())

            payload_bytes = fx.payload_bytes(artifact_id="cloud_layers", dtype="int8")
            expected_payload = (
                struct.pack("bbbb", 0, 2, 50, -128)
                + struct.pack("bbbb", 5, 10, -128, 40)
                + struct.pack("bbbb", 50, 25, 0, 12)
            )
            self.assertEqual(payload_bytes, expected_payload)
            self.assertEqual(result["byte_length"], len(expected_payload))
            self.assertEqual(result["sha256"], hashlib.sha256(expected_payload).hexdigest())
            self.assertEqual(result["format"], "linear-i8-v1")
            self.assertEqual(result["components"], ["low", "middle", "high"])
            self.assertEqual(result["encoding_id"], "cloud_layers_vector_i8_2pct_v1")
            self.assertEqual(result["grid"]["lon0"], -180.0)
            self.assertEqual(result["grid"]["lat0"], 90.0)


class WindArtifactContractTest(unittest.TestCase):
    def test_wind_artifact_writes_vector_payload_without_meta_sidecar(self) -> None:
        with artifact_run_fixture(prefix="weather-map-wind-artifact-") as fx:
            u_src = pack_f32([0.0, 1.0, -1.0, 20.0], byte_order="little")
            v_src = pack_f32([2.0, -2.0, 0.5, -0.5], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    side_effect=[(1, {"id": "u"}), (2, {"id": "v"})],
                ),
                patch(
                    "forecast_etl.extract.source_bands.extract_float32_band_bytes",
                    side_effect=[(u_src, "little"), (v_src, "little")],
                ),
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=small_grid_meta_fixture(),
                ),
            ):
                result = fx.run_artifact(
                    artifact_id="wind10m_uv",
                    artifact_config=wind_artifact_config(),
                    source=fx.single_grib_source(),
                    run=_unused_run,
                )

            payload_uri = fx.payload_uri(artifact_id="wind10m_uv", dtype="int8")
            payload_path = fx.payload_path(artifact_id="wind10m_uv", dtype="int8")
            self.assertEqual(result["payload_uri"], payload_uri)
            self.assertTrue(payload_path.exists())

            payload_bytes = fx.payload_bytes(artifact_id="wind10m_uv", dtype="int8")
            expected_u = encode_component_payload(
                source_f32_bytes=u_src,
                source_byte_order="little",
                target_dtype="int8",
                target_byte_order="none",
                target_format=FORMAT_LINEAR_I8,
                scale=0.5,
                offset=0.0,
            )
            expected_v = encode_component_payload(
                source_f32_bytes=v_src,
                source_byte_order="little",
                target_dtype="int8",
                target_byte_order="none",
                target_format=FORMAT_LINEAR_I8,
                scale=0.5,
                offset=0.0,
            )
            expected_payload = expected_u + expected_v
            self.assertEqual(payload_bytes, expected_payload)
            self.assertEqual(result["byte_length"], len(expected_payload))
            self.assertEqual(result["sha256"], hashlib.sha256(expected_payload).hexdigest())
            self.assertEqual(result["format"], "linear-i8-v1")
            self.assertEqual(result["components"], ["u", "v"])
            self.assertEqual(result["encoding_id"], "wind10m_uv_vector_i8_v1")
            self.assertEqual(result["grid_id"], "gfs_0p25_global")
            self.assertEqual(result["grid"]["lon0"], -180.0)
            self.assertEqual(result["grid"]["lat0"], 90.0)


class IconGribCollectionArtifactTest(unittest.TestCase):
    def test_precip_total_scalar_uses_icon_param_grib_path_and_encoding(self) -> None:
        with artifact_run_fixture(
            prefix="weather-map-icon-precip-artifact-",
            model_id="icon",
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
                f"{fx.artifact_root_uri}/fields/icon/2026041200/003/precip_total_surface.field.i8.bin",
            )
            self.assertEqual(result["encoding_id"], "precip_total_surface_i8_1mm_v1")
            self.assertEqual(result["units"], "mm")
            self.assertEqual(result["grid_id"], "icon_global_regridded_0p125")

    def test_icon_pressure_can_publish_downsampled_grid(self) -> None:
        with artifact_run_fixture(
            prefix="weather-map-icon-pressure-downsample-",
            model_id="icon",
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
            model_id="icon",
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
            model_id="icon",
            fhour="001",
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
            model_id="icon",
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
            model_id="icon",
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
            model_id="icon",
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
            model_id="icon",
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
            model_id="icon",
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
            model_id="icon",
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
