from __future__ import annotations

import hashlib
import struct

from tests.fixtures.artifact_configs import (
    cloud_layers_config,
    wind_artifact_config,
)
from tests.fixtures.artifact_runs import artifact_run_fixture, grib_bands
from tests.fixtures.grids import pack_f32
from tests.fixtures.proc import noop_run
from weather_etl.config.encoding import FORMAT_LINEAR_I8, EncodingSpec
from weather_etl.processing.encoding import encode_component_payload


def test_cloud_layers_artifact_writes_three_component_vector_payload() -> None:
    with artifact_run_fixture(prefix="weather-map-cloud-artifact-") as fx:
        low_src = pack_f32([0.0, 5.0, 120.0, float("nan")], byte_order="little")
        middle_src = pack_f32([10.0, 20.0, float("nan"), -10.0], byte_order="little")
        high_src = pack_f32([100.0, 50.0, 0.0, 25.0], byte_order="little")

        with fx.patch_grib_processing(
            bands=grib_bands(
                {"GRIB_ELEMENT": "LCDC"},
                {"GRIB_ELEMENT": "MCDC"},
                {"GRIB_ELEMENT": "HCDC"},
            ),
            sources=(low_src, middle_src, high_src),
        ):
            result = fx.run_artifact(
                artifact_id="cloud_layers",
                artifact_config=cloud_layers_config(),
                source=fx.single_grib_source(),
                run=noop_run,
            )

        payload_uri = fx.payload_uri(artifact_id="cloud_layers", dtype="int8")
        payload_path = fx.payload_path(artifact_id="cloud_layers", dtype="int8")
        assert result["payload_uri"] == payload_uri
        assert payload_path.exists()

        payload_bytes = fx.payload_bytes(artifact_id="cloud_layers", dtype="int8")
        expected_payload = (
            struct.pack("bbbb", 0, 1, 25, -128) + struct.pack("bbbb", 2, 5, -128, 0) + struct.pack("bbbb", 25, 12, 0, 6)
        )
        assert payload_bytes == expected_payload
        assert result["byte_length"] == len(expected_payload)
        assert result["sha256"] == hashlib.sha256(expected_payload).hexdigest()
        assert result["format"] == "linear-i8-v1"
        assert result["components"] == ["low", "middle", "high"]
        assert result["encoding_id"] == "cloud_layers_vector_i8_4pct_v1"
        assert result["grid"]["lon0"] == -180.0
        assert result["grid"]["lat0"] == 90.0


def test_wind_artifact_writes_vector_payload_without_meta_sidecar() -> None:
    with artifact_run_fixture(prefix="weather-map-wind-artifact-") as fx:
        u_src = pack_f32([0.0, 1.0, -1.0, 20.0], byte_order="little")
        v_src = pack_f32([2.0, -2.0, 0.5, -0.5], byte_order="little")

        with fx.patch_grib_processing(
            bands=grib_bands({"id": "u"}, {"id": "v"}),
            sources=(u_src, v_src),
        ):
            result = fx.run_artifact(
                artifact_id="wind10m_uv",
                artifact_config=wind_artifact_config(),
                source=fx.single_grib_source(),
                run=noop_run,
            )

        payload_uri = fx.payload_uri(artifact_id="wind10m_uv", dtype="int8")
        payload_path = fx.payload_path(artifact_id="wind10m_uv", dtype="int8")
        assert result["payload_uri"] == payload_uri
        assert payload_path.exists()

        payload_bytes = fx.payload_bytes(artifact_id="wind10m_uv", dtype="int8")
        expected_u = encode_component_payload(
            source_f32_bytes=u_src,
            source_byte_order="little",
            encoding=_linear_i8_encoding(),
        )
        expected_v = encode_component_payload(
            source_f32_bytes=v_src,
            source_byte_order="little",
            encoding=_linear_i8_encoding(),
        )
        expected_payload = expected_u + expected_v
        assert payload_bytes == expected_payload
        assert result["byte_length"] == len(expected_payload)
        assert result["sha256"] == hashlib.sha256(expected_payload).hexdigest()
        assert result["format"] == "linear-i8-v1"
        assert result["components"] == ["u", "v"]
        assert result["encoding_id"] == "wind10m_uv_vector_i8_1ms_v1"
        assert result["grid_id"] == "gfs_0p25_global"
        assert result["grid"]["lon0"] == -180.0
        assert result["grid"]["lat0"] == 90.0


def test_wind_artifact_encodes_invalid_components_as_zero() -> None:
    with artifact_run_fixture(prefix="weather-map-wind-invalid-artifact-") as fx:
        u_src = pack_f32([1.0, float("nan"), 3.0, float("inf")], byte_order="little")
        v_src = pack_f32([2.0, 4.0, float("-inf"), 8.0], byte_order="little")

        with fx.patch_grib_processing(
            bands=grib_bands({"id": "u"}, {"id": "v"}),
            sources=(u_src, v_src),
        ):
            fx.run_artifact(
                artifact_id="wind10m_uv",
                artifact_config=wind_artifact_config(),
                source=fx.single_grib_source(),
                run=noop_run,
            )

        payload_bytes = fx.payload_bytes(artifact_id="wind10m_uv", dtype="int8")
        expected_payload = struct.pack("bbbb", 1, 0, 3, 0) + struct.pack("bbbb", 2, 4, 0, 8)
        assert payload_bytes == expected_payload


def _linear_i8_encoding() -> EncodingSpec:
    return EncodingSpec(
        id="test_linear_i8",
        dtype="int8",
        byte_order="none",
        format=FORMAT_LINEAR_I8,
        scale=1,
        offset=0.0,
    )
