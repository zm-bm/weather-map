from __future__ import annotations

import hashlib
import struct
import unittest
from unittest.mock import patch

from forecast_etl.derivations import previous_icon_param_key
from forecast_etl.encoding.codecs import FORMAT_LINEAR_I8, encode_component_payload
from forecast_etl.proc import RunResult
from forecast_etl.tests.fixtures.execution import product_run_fixture
from forecast_etl.tests.fixtures.grids import grid_meta_fixture, pack_f32, small_grid_meta_fixture
from forecast_etl.tests.fixtures.products import (
    cloud_cover_config,
    minimal_product_config,
    precip_rate_config,
    precip_total_config,
    precip_type_config,
    product_spec,
    thunderstorm_mask_config,
    wind_product_config,
)


def _unused_run(*_args: object, **_kwargs: object) -> RunResult:
    return RunResult(argv=(), returncode=0)


class ScalarProductContractTest(unittest.TestCase):
    def test_single_band_scalar_product_writes_scalar_payload(self) -> None:
        with product_run_fixture(prefix="weather-map-scalar-product-") as fx:
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
                result = fx.run_product(
                    product_id="tmp_surface",
                    product_config=minimal_product_config(),
                    source=fx.single_grib_source(),
                    run=_unused_run,
                )

            payload_uri = fx.payload_uri(product_id="tmp_surface", dtype="int16")
            payload_path = fx.payload_path(product_id="tmp_surface", dtype="int16")
            self.assertEqual(result["payload_uri"], payload_uri)
            self.assertTrue(payload_path.exists())

            payload_bytes = fx.payload_bytes(product_id="tmp_surface", dtype="int16")
            self.assertEqual(
                payload_bytes,
                struct.pack("<hhhh", 0, 100, 200, -32768),
            )
            self.assertEqual(result["byte_length"], len(payload_bytes))
            self.assertEqual(result["sha256"], hashlib.sha256(payload_bytes).hexdigest())
            self.assertEqual(result["grid"]["lon0"], -180.0)
            self.assertEqual(result["grid"]["lat0"], 90.0)

    def test_cloud_cover_product_writes_single_component_scalar_payload(self) -> None:
        with product_run_fixture(prefix="weather-map-cloud-product-") as fx:
            source = pack_f32([0.0, 5.0, 100.0, float("nan")], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    return_value=(1, {"GRIB_ELEMENT": "LCDC"}),
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
                result = fx.run_product(
                    product_id="low_clouds",
                    product_config=cloud_cover_config(),
                    source=fx.single_grib_source(),
                    run=_unused_run,
                )

            payload_uri = fx.payload_uri(product_id="low_clouds", dtype="int8")
            payload_path = fx.payload_path(product_id="low_clouds", dtype="int8")
            self.assertEqual(result["payload_uri"], payload_uri)
            self.assertTrue(payload_path.exists())

            payload_bytes = fx.payload_bytes(product_id="low_clouds", dtype="int8")
            expected_payload = struct.pack("bbbb", -50, -45, 50, -128)
            self.assertEqual(payload_bytes, expected_payload)
            self.assertEqual(result["byte_length"], len(expected_payload))
            self.assertEqual(result["sha256"], hashlib.sha256(expected_payload).hexdigest())
            self.assertEqual(result["format"], "linear-i8-v1")
            self.assertEqual(result["components"], ["value"])
            self.assertEqual(result["grid"]["lon0"], -180.0)
            self.assertEqual(result["grid"]["lat0"], 90.0)


class WindProductContractTest(unittest.TestCase):
    def test_wind_product_writes_vector_payload_without_meta_sidecar(self) -> None:
        with product_run_fixture(prefix="weather-map-wind-product-") as fx:
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
                result = fx.run_product(
                    product_id="wind10m_uv",
                    product_config=wind_product_config(),
                    source=fx.single_grib_source(),
                    run=_unused_run,
                )

            payload_uri = fx.payload_uri(product_id="wind10m_uv", dtype="int8")
            payload_path = fx.payload_path(product_id="wind10m_uv", dtype="int8")
            self.assertEqual(result["payload_uri"], payload_uri)
            self.assertTrue(payload_path.exists())

            payload_bytes = fx.payload_bytes(product_id="wind10m_uv", dtype="int8")
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


class IconGribCollectionProductTest(unittest.TestCase):
    def test_precip_total_scalar_uses_icon_param_grib_path_and_encoding(self) -> None:
        with product_run_fixture(
            prefix="weather-map-icon-precip-product-",
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
                result = fx.run_product(
                    product_id="precip_total_surface",
                    product_config=precip_total_config(),
                    source=fx.grib_collection_source(
                        grib_paths={"tot_prec": grib_path},
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

            find_band.assert_called_once_with(grib_path, {}, run=_unused_run)
            self.assertEqual(extract_band.call_args.kwargs["grib_path"], grib_path)
            payload_bytes = fx.payload_bytes(product_id="precip_total_surface", dtype="int8")
            expected_payload = struct.pack("bbbb", -127, -126, 127, -128)
            self.assertEqual(payload_bytes, expected_payload)
            self.assertEqual(
                result["payload_uri"],
                f"{fx.artifact_root_uri}/fields/icon/2026041200/003/precip_total_surface.field.i8.bin",
            )
            self.assertEqual(result["encoding_id"], "precip_total_surface_i8_1mm_v1")
            self.assertEqual(result["units"], "mm")
            self.assertEqual(result["grid_id"], "icon_global_regridded_0p125")

    def test_precip_rate_derives_icon_rate_from_adjacent_tot_prec_accumulations(self) -> None:
        with product_run_fixture(
            prefix="weather-map-icon-prate-product-",
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
                result = fx.run_product(
                    product_id="prate_surface",
                    product_config=precip_rate_config(),
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
            payload_bytes = fx.payload_bytes(product_id="prate_surface", dtype="int8")
            self.assertEqual(payload_bytes, struct.pack("bbbb", -120, -114, -127, -128))
            self.assertEqual(result["encoding_id"], "prate_surface_i8_0p15mmhr_v1")
            self.assertEqual(result["units"], "mm/hr")

    def test_precip_rate_uses_zero_previous_for_first_icon_hour(self) -> None:
        with product_run_fixture(
            prefix="weather-map-icon-prate-first-product-",
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
                fx.run_product(
                    product_id="prate_surface",
                    product_config=precip_rate_config(),
                    source=fx.grib_collection_source(
                        grib_paths={"tot_prec": current_path},
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

            find_band.assert_called_once()
            payload_bytes = fx.payload_bytes(product_id="prate_surface", dtype="int8")
            self.assertEqual(payload_bytes, struct.pack("bbbb", -120, -114, -127, -128))

    def test_precip_rate_clamps_small_negative_icon_accumulation_delta(self) -> None:
        with product_run_fixture(
            prefix="weather-map-icon-prate-clamp-product-",
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
                fx.run_product(
                    product_id="prate_surface",
                    product_config=precip_rate_config(),
                    source=fx.grib_collection_source(
                        grib_paths={
                            "tot_prec": current_path,
                            previous_icon_param_key("tot_prec"): previous_path,
                        },
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

            payload_bytes = fx.payload_bytes(product_id="prate_surface", dtype="int8")
            self.assertEqual(payload_bytes, struct.pack("bbbb", -127, -127, -127, -127))

    def test_precip_rate_rejects_meaningful_negative_icon_accumulation_delta(self) -> None:
        with product_run_fixture(
            prefix="weather-map-icon-prate-negative-product-",
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
                    fx.run_product(
                        product_id="prate_surface",
                        product_config=precip_rate_config(),
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

    def test_icon_cloud_cover_uses_configured_grib_path(self) -> None:
        with product_run_fixture(
            prefix="weather-map-icon-cloud-product-",
            model_id="icon",
            source_uri="icon-dwd://icon/2026041200/003",
        ) as fx:
            path = fx.grib_path("clcl.regridded.grib2")
            product_config = cloud_cover_config(grib_match={"ICON_PARAM": "clcl"})
            component_source = pack_f32([0.0, 5.0, 10.0, 15.0], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    return_value=(1, {"id": "value"}),
                ) as find_band,
                patch(
                    "forecast_etl.extract.source_bands.extract_float32_band_bytes",
                    return_value=(component_source, "little"),
                ),
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=small_grid_meta_fixture(),
                ),
            ):
                fx.run_product(
                    product_id="low_clouds",
                    product_config=product_config,
                    source=fx.grib_collection_source(
                        grib_paths={"clcl": path},
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

        called_paths = [call.args[0] for call in find_band.call_args_list]
        self.assertEqual(called_paths, [path])

    def test_icon_wind_uses_u_and_v_grib_paths(self) -> None:
        with product_run_fixture(
            prefix="weather-map-icon-wind-product-",
            model_id="icon",
            source_uri="icon-dwd://icon/2026041200/003",
        ) as fx:
            paths = {
                "u_10m": fx.grib_path("u_10m.regridded.grib2"),
                "v_10m": fx.grib_path("v_10m.regridded.grib2"),
            }

            product_config = wind_product_config()
            product_config["components"][0]["grib_match"] = {"ICON_PARAM": "u_10m"}
            product_config["components"][1]["grib_match"] = {"ICON_PARAM": "v_10m"}
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
                fx.run_product(
                    product_id="wind10m_uv",
                    product_config=product_config,
                    source=fx.grib_collection_source(
                        grib_paths=paths,
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

        called_paths = [call.args[0] for call in find_band.call_args_list]
        self.assertEqual(called_paths, [paths["u_10m"], paths["v_10m"]])


class PrecipitationOverlayProductTest(unittest.TestCase):
    def test_gfs_precip_type_derives_category_codes(self) -> None:
        with product_run_fixture(prefix="weather-map-gfs-precip-type-product-") as fx:
            rain = pack_f32([0, 1, 0, 0, 0, 1, 0.49, float("nan"), 0, 0, 0, 0], byte_order="little")
            freezing_rain = pack_f32([0, 0, 1, 0, 0, 0, 0, float("nan"), 0, 0, 0, 0], byte_order="little")
            ice_pellets = pack_f32([0, 0, 0, 1, 0, 0, 0, float("nan"), 0, 0, 0, 0], byte_order="little")
            snow = pack_f32([0, 0, 0, 0, 1, 1, 0, float("nan"), 0, 0, 0, 0], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    side_effect=[
                        (1, {"GRIB_ELEMENT": "CRAIN"}),
                        (2, {"GRIB_ELEMENT": "CFRZR"}),
                        (3, {"GRIB_ELEMENT": "CICEP"}),
                        (4, {"GRIB_ELEMENT": "CSNOW"}),
                    ],
                ),
                patch(
                    "forecast_etl.extract.source_bands.extract_float32_band_bytes",
                    side_effect=[
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
                result = fx.run_product(
                    product_id="precip_type_surface",
                    product_config=precip_type_config(),
                    source=fx.single_grib_source(),
                    run=_unused_run,
                )

            payload_bytes = fx.payload_bytes(product_id="precip_type_surface", dtype="int8")
            self.assertEqual(payload_bytes, struct.pack("bbbbbbbbbbbb", 0, 1, 2, 3, 4, 5, 0, -128, 0, 0, 0, 0))
            self.assertEqual(result["encoding_id"], "precip_type_surface_i8_code_v1")
            self.assertEqual(result["components"], ["value"])
            self.assertEqual(result["units"], "code")

    def test_icon_weather_code_derives_precip_type_codes(self) -> None:
        with product_run_fixture(
            prefix="weather-map-icon-precip-type-product-",
            model_id="icon",
            source_uri="icon-dwd://icon/2026041200/003",
        ) as fx:
            weather_code_path = fx.grib_path("ww.regridded.grib2")
            weather_codes = pack_f32([0, 51, 56, 79, 71, 68, 95, 96, 97, 99, float("nan"), 999], byte_order="little")

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
                result = fx.run_product(
                    product_id="precip_type_surface",
                    product_config=precip_type_config(derivation_type="precip_type_from_icon_ww"),
                    source=fx.grib_collection_source(
                        grib_paths={"ww": weather_code_path},
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

            payload_bytes = fx.payload_bytes(product_id="precip_type_surface", dtype="int8")
            self.assertEqual(payload_bytes, struct.pack("bbbbbbbbbbbb", 0, 1, 2, 3, 4, 5, 1, 3, 1, 3, -128, 0))
            self.assertEqual(result["encoding_id"], "precip_type_surface_i8_code_v1")
            self.assertEqual(result["units"], "code")

    def test_icon_weather_code_derives_thunderstorm_mask(self) -> None:
        with product_run_fixture(
            prefix="weather-map-icon-thunderstorm-product-",
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
                result = fx.run_product(
                    product_id="thunderstorm_mask",
                    product_config=thunderstorm_mask_config(),
                    source=fx.grib_collection_source(
                        grib_paths={"ww": weather_code_path},
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

            payload_bytes = fx.payload_bytes(product_id="thunderstorm_mask", dtype="int8")
            self.assertEqual(payload_bytes, struct.pack("bbbbbbbbbbbb", 0, 1, 1, 1, 1, 1, 0, -128, 0, 0, 0, 0))
            self.assertEqual(result["encoding_id"], "thunderstorm_mask_i8_flag_v1")
            self.assertEqual(result["units"], "flag")

    def test_unsupported_derivation_type_fails_clearly(self) -> None:
        product_config = precip_type_config()
        product_config["derivation"]["type"] = "not_supported"

        with self.assertRaises(SystemExit) as raised:
            product_spec("precip_type_surface", product_config)

        self.assertIn("type must be one of", str(raised.exception))
