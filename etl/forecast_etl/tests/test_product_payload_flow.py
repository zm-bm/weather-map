from __future__ import annotations

import hashlib
import struct
import unittest
from unittest.mock import patch

from forecast_etl.encoding.codecs import FORMAT_LINEAR_I8, encode_component_payload
from forecast_etl.proc import RunResult
from forecast_etl.tests.fixtures.execution import product_run_fixture
from forecast_etl.tests.fixtures.grids import pack_f32, small_grid_meta_fixture
from forecast_etl.tests.fixtures.products import (
    cloud_layers_config,
    minimal_product_config,
    precip_total_config,
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
                    "forecast_etl.extract.product_bands.find_grib_band_by_metadata",
                    return_value=(1, {"GRIB_ELEMENT": "TMP"}),
                ),
                patch(
                    "forecast_etl.extract.product_bands.extract_float32_band_bytes",
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

    def test_cloud_layers_product_writes_packed_low_medium_high_scalar_payload(self) -> None:
        with product_run_fixture(prefix="weather-map-cloud-product-") as fx:
            low_src = pack_f32([0.0, 5.0, 100.0, float("nan")], byte_order="little")
            medium_src = pack_f32([10.0, 55.0, 80.0, 25.0], byte_order="little")
            high_src = pack_f32([15.0, 45.0, 65.0, 95.0], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.product_bands.find_grib_band_by_metadata",
                    side_effect=[
                        (1, {"GRIB_ELEMENT": "LCDC"}),
                        (2, {"GRIB_ELEMENT": "MCDC"}),
                        (3, {"GRIB_ELEMENT": "HCDC"}),
                    ],
                ),
                patch(
                    "forecast_etl.extract.product_bands.extract_float32_band_bytes",
                    side_effect=[
                        (low_src, "little"),
                        (medium_src, "little"),
                        (high_src, "little"),
                    ],
                ),
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=small_grid_meta_fixture(),
                ),
            ):
                result = fx.run_product(
                    product_id="cloud_layers",
                    product_config=cloud_layers_config(),
                    source=fx.single_grib_source(),
                    run=_unused_run,
                )

            payload_uri = fx.payload_uri(product_id="cloud_layers", dtype="int8")
            payload_path = fx.payload_path(product_id="cloud_layers", dtype="int8")
            self.assertEqual(result["payload_uri"], payload_uri)
            self.assertTrue(payload_path.exists())

            payload_bytes = fx.payload_bytes(product_id="cloud_layers", dtype="int8")
            expected_payload = (
                struct.pack("bbbb", 0, 1, 20, -128)
                + struct.pack("bbbb", 2, 11, 16, 5)
                + struct.pack("bbbb", 3, 9, 13, 19)
            )
            self.assertEqual(payload_bytes, expected_payload)
            self.assertEqual(result["byte_length"], len(expected_payload))
            self.assertEqual(result["sha256"], hashlib.sha256(expected_payload).hexdigest())
            self.assertEqual(result["format"], "linear-i8-v1")
            self.assertEqual(result["components"], ["low", "medium", "high"])
            self.assertEqual(result["grid"]["lon0"], -180.0)
            self.assertEqual(result["grid"]["lat0"], 90.0)


class WindProductContractTest(unittest.TestCase):
    def test_wind_product_writes_vector_payload_without_meta_sidecar(self) -> None:
        with product_run_fixture(prefix="weather-map-wind-product-") as fx:
            u_src = pack_f32([0.0, 1.0, -1.0, 20.0], byte_order="little")
            v_src = pack_f32([2.0, -2.0, 0.5, -0.5], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.product_bands.find_grib_band_by_metadata",
                    side_effect=[(1, {"id": "u"}), (2, {"id": "v"})],
                ),
                patch(
                    "forecast_etl.extract.product_bands.extract_float32_band_bytes",
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
                    "forecast_etl.extract.product_bands.find_grib_band_by_metadata",
                    return_value=(1, {"GRIB_ELEMENT": "TOT_PREC"}),
                ) as find_band,
                patch(
                    "forecast_etl.extract.product_bands.extract_float32_band_bytes",
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

    def test_icon_cloud_layers_use_component_specific_grib_paths(self) -> None:
        with product_run_fixture(
            prefix="weather-map-icon-cloud-product-",
            model_id="icon",
            source_uri="icon-dwd://icon/2026041200/003",
        ) as fx:
            paths = {
                "clcl": fx.grib_path("clcl.regridded.grib2"),
                "clcm": fx.grib_path("clcm.regridded.grib2"),
                "clch": fx.grib_path("clch.regridded.grib2"),
            }

            product_config = cloud_layers_config()
            product_config["components"][0]["grib_match"] = {"ICON_PARAM": "clcl"}
            product_config["components"][1]["grib_match"] = {"ICON_PARAM": "clcm"}
            product_config["components"][2]["grib_match"] = {"ICON_PARAM": "clch"}
            component_source = pack_f32([0.0, 5.0, 10.0, 15.0], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.product_bands.find_grib_band_by_metadata",
                    side_effect=[(1, {"id": "low"}), (1, {"id": "medium"}), (1, {"id": "high"})],
                ) as find_band,
                patch(
                    "forecast_etl.extract.product_bands.extract_float32_band_bytes",
                    return_value=(component_source, "little"),
                ),
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=small_grid_meta_fixture(),
                ),
            ):
                fx.run_product(
                    product_id="cloud_layers",
                    product_config=product_config,
                    source=fx.grib_collection_source(
                        grib_paths=paths,
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

        called_paths = [call.args[0] for call in find_band.call_args_list]
        self.assertEqual(called_paths, [paths["clcl"], paths["clcm"], paths["clch"]])

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
                    "forecast_etl.extract.product_bands.find_grib_band_by_metadata",
                    side_effect=[(1, {"id": "u"}), (1, {"id": "v"})],
                ) as find_band,
                patch(
                    "forecast_etl.extract.product_bands.extract_float32_band_bytes",
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
