from __future__ import annotations

import hashlib
import struct
import unittest
from unittest.mock import patch

from forecast_etl.encoding.codecs import FORMAT_LINEAR_I8, encode_component_payload
from forecast_etl.proc import RunResult
from forecast_etl.tests.fixtures.artifact_configs import (
    cloud_layers_config,
    wind_artifact_config,
)
from forecast_etl.tests.fixtures.execution import artifact_run_fixture
from forecast_etl.tests.fixtures.grids import pack_f32, small_grid_meta_fixture


def _unused_run(*_args: object, **_kwargs: object) -> RunResult:
    return RunResult(argv=(), returncode=0)


class VectorArtifactContractTest(unittest.TestCase):
    def test_cloud_layers_artifact_writes_three_component_vector_payload(self) -> None:
        with artifact_run_fixture(prefix="weather-map-cloud-artifact-") as fx:
            low_src = pack_f32([0.0, 5.0, 120.0, float("nan")], byte_order="little")
            middle_src = pack_f32([10.0, 20.0, float("nan"), -10.0], byte_order="little")
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
                struct.pack("bbbb", 0, 1, 25, -128)
                + struct.pack("bbbb", 2, 5, -128, 0)
                + struct.pack("bbbb", 25, 12, 0, 6)
            )
            self.assertEqual(payload_bytes, expected_payload)
            self.assertEqual(result["byte_length"], len(expected_payload))
            self.assertEqual(result["sha256"], hashlib.sha256(expected_payload).hexdigest())
            self.assertEqual(result["format"], "linear-i8-v1")
            self.assertEqual(result["components"], ["low", "middle", "high"])
            self.assertEqual(result["encoding_id"], "cloud_layers_vector_i8_4pct_v1")
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
                scale=1,
                offset=0.0,
            )
            expected_v = encode_component_payload(
                source_f32_bytes=v_src,
                source_byte_order="little",
                target_dtype="int8",
                target_byte_order="none",
                target_format=FORMAT_LINEAR_I8,
                scale=1,
                offset=0.0,
            )
            expected_payload = expected_u + expected_v
            self.assertEqual(payload_bytes, expected_payload)
            self.assertEqual(result["byte_length"], len(expected_payload))
            self.assertEqual(result["sha256"], hashlib.sha256(expected_payload).hexdigest())
            self.assertEqual(result["format"], "linear-i8-v1")
            self.assertEqual(result["components"], ["u", "v"])
            self.assertEqual(result["encoding_id"], "wind10m_uv_vector_i8_1ms_v1")
            self.assertEqual(result["grid_id"], "gfs_0p25_global")
            self.assertEqual(result["grid"]["lon0"], -180.0)
            self.assertEqual(result["grid"]["lat0"], 90.0)

    def test_wind_artifact_encodes_invalid_vector_cells_as_zero_wind(self) -> None:
        with artifact_run_fixture(prefix="weather-map-wind-invalid-artifact-") as fx:
            u_src = pack_f32([1.0, float("nan"), 3.0, float("inf")], byte_order="little")
            v_src = pack_f32([2.0, 4.0, float("-inf"), 8.0], byte_order="little")

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
                fx.run_artifact(
                    artifact_id="wind10m_uv",
                    artifact_config=wind_artifact_config(),
                    source=fx.single_grib_source(),
                    run=_unused_run,
                )

            payload_bytes = fx.payload_bytes(artifact_id="wind10m_uv", dtype="int8")
            expected_payload = struct.pack("bbbb", 1, 0, 0, 0) + struct.pack("bbbb", 2, 0, 0, 0)
            self.assertEqual(payload_bytes, expected_payload)

if __name__ == "__main__":
    unittest.main()
