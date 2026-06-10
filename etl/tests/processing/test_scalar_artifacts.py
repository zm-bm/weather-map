from __future__ import annotations

import hashlib
import struct

from tests.fixtures.artifact_configs import (
    cin_index_config,
    minimal_artifact_config,
    reflectivity_config,
)
from tests.fixtures.artifact_runs import artifact_run_fixture, grib_band
from tests.fixtures.grids import pack_f32
from tests.fixtures.proc import noop_run


def test_single_band_scalar_artifact_writes_scalar_payload() -> None:
    with artifact_run_fixture(prefix="weather-map-scalar-artifact-") as fx:
        source = pack_f32([0.0, 1.0, 2.0, float("nan")], byte_order="little")

        with fx.patch_grib_processing(band=grib_band(metadata={"GRIB_ELEMENT": "TMP"}), source=source):
            result = fx.run_artifact(
                artifact_id="tmp_surface",
                artifact_config=minimal_artifact_config(),
                source=fx.single_grib_source(),
                run=noop_run,
            )

        payload_uri = fx.payload_uri(artifact_id="tmp_surface", dtype="int16")
        payload_path = fx.payload_path(artifact_id="tmp_surface", dtype="int16")
        assert result["payload_uri"] == payload_uri
        assert payload_path.exists()

        payload_bytes = fx.payload_bytes(artifact_id="tmp_surface", dtype="int16")
        assert payload_bytes == struct.pack("<hhhh", 0, 100, 200, -32768)
        assert result["byte_length"] == len(payload_bytes)
        assert result["sha256"] == hashlib.sha256(payload_bytes).hexdigest()
        assert result["grid"]["lon0"] == -180.0
        assert result["grid"]["lat0"] == 90.0


def test_reflectivity_artifact_writes_dbz_payload() -> None:
    with artifact_run_fixture(prefix="weather-map-reflectivity-artifact-") as fx:
        source_grib = fx.single_grib_source()
        source = pack_f32([-5.0, 31.5, 80.0, float("nan")], byte_order="little")

        with fx.patch_grib_processing(
            band=grib_band(metadata={"GRIB_ELEMENT": "REFC", "GRIB_SHORT_NAME": "0-EATM"}),
            source=source,
        ) as grib:
            result = fx.run_artifact(
                artifact_id="refc_entire_atmosphere",
                artifact_config=reflectivity_config(),
                source=source_grib,
                run=noop_run,
            )

        grib.find_band.assert_called_once_with(
            source_grib.reference_grib_path(),
            {"GRIB_ELEMENT": "REFC", "GRIB_SHORT_NAME": "0-EATM"},
            run=noop_run,
        )
        payload_bytes = fx.payload_bytes(artifact_id="refc_entire_atmosphere", dtype="int8")
        assert payload_bytes == struct.pack("bbbb", -63, 0, 87, -128)
        assert result["encoding_id"] == "refc_entire_atmosphere_i8_0p5dbz_v1"
        assert result["units"] == "dBZ"
        assert result["parameter"] == "refc"


def test_cin_artifact_writes_positive_magnitude_payload() -> None:
    with artifact_run_fixture(prefix="weather-map-cin-artifact-") as fx:
        source_grib = fx.single_grib_source()
        source = pack_f32([-50.0, 100.0, 500.0, float("nan")], byte_order="little")

        with fx.patch_grib_processing(
            band=grib_band(metadata={"GRIB_ELEMENT": "CIN", "GRIB_SHORT_NAME": "18000-0-SPDL"}),
            source=source,
        ) as grib:
            result = fx.run_artifact(
                artifact_id="cin_index",
                artifact_config=cin_index_config(),
                source=source_grib,
                run=noop_run,
            )

        grib.find_band.assert_called_once_with(
            source_grib.reference_grib_path(),
            {"GRIB_ELEMENT": "CIN", "GRIB_SHORT_NAME": "18000-0-SPDL"},
            run=noop_run,
        )
        payload_bytes = fx.payload_bytes(artifact_id="cin_index", dtype="int8")
        assert payload_bytes == struct.pack("bbbb", -102, -77, 123, -128)
        assert result["encoding_id"] == "cin_index_i8_2jkg_v1"
        assert result["units"] == "J/kg"
        assert result["parameter"] == "cin"


def test_total_cloud_cover_uses_4pct_encoding_and_clamps_finite_values() -> None:
    with artifact_run_fixture(prefix="weather-map-tcdc-artifact-") as fx:
        source_grib = fx.single_grib_source()
        source = pack_f32([-10.0, 2.0, 120.0, float("nan")], byte_order="little")
        artifact_config = {
            "kind": "scalar",
            "parameter": "tcdc",
            "level": "entire atmosphere",
            "units": "%",
            "source_transform": "identity",
            "encoding": {
                "id": "tcdc_i8_4pct_v1",
                "format": "linear-i8-v1",
                "dtype": "int8",
                "byte_order": "none",
                "scale": 4,
                "offset": 0,
                "nodata": -128,
                "finite_value_range": {"min": 0, "max": 100},
            },
            "components": [
                {"id": "value", "grib_match": {"GRIB_ELEMENT": "TCDC"}},
            ],
        }

        with fx.patch_grib_processing(band=grib_band(metadata={"GRIB_ELEMENT": "TCDC"}), source=source):
            result = fx.run_artifact(
                artifact_id="tcdc",
                artifact_config=artifact_config,
                source=source_grib,
                run=noop_run,
            )

        payload_bytes = fx.payload_bytes(artifact_id="tcdc", dtype="int8")
        assert payload_bytes == struct.pack("bbbb", 0, 0, 25, -128)
        assert result["encoding_id"] == "tcdc_i8_4pct_v1"


def test_bounded_scalar_artifacts_clamp_finite_values_through_artifact_flow() -> None:
    cases = (
        {
            "artifact_id": "prate_surface",
            "parameter": "prate",
            "units": "mm/hr",
            "source_transform": "kg_m2_s_to_mm_hr",
            "encoding": {
                "id": "prate_surface_i8_0p15mmhr_v1",
                "scale": 0.15,
                "offset": 19.05,
                "finite_value_range": {"min": 0, "max": 38.1},
            },
            "values": [-0.001, 0.0, 0.02, float("nan")],
            "expected": [-127, -127, 127, -128],
        },
        {
            "artifact_id": "precip_total_surface",
            "parameter": "precip_total",
            "units": "mm",
            "source_transform": "identity",
            "encoding": {
                "id": "precip_total_surface_i8_1mm_v1",
                "scale": 1,
                "offset": 127,
                "finite_value_range": {"min": 0, "max": 254},
            },
            "values": [-1.0, 1.0, 300.0, float("nan")],
            "expected": [-127, -126, 127, -128],
        },
        {
            "artifact_id": "snow_depth_surface",
            "parameter": "snow_depth",
            "units": "m",
            "source_transform": "identity",
            "encoding": {
                "id": "snow_depth_surface_i8_0p012m_v1",
                "scale": 3 / 254,
                "offset": 1.5,
                "finite_value_range": {"min": 0, "max": 3},
            },
            "values": [-1.0, 0.02, 10.0, float("nan")],
            "expected": [-127, -125, 127, -128],
        },
        {
            "artifact_id": "visibility_surface",
            "parameter": "visibility",
            "units": "m",
            "source_transform": "identity",
            "encoding": {
                "id": "visibility_surface_i8_200m_v1",
                "scale": 200,
                "offset": 25400,
                "finite_value_range": {"min": 0, "max": 50800},
            },
            "values": [-1.0, 200.0, 99999.0, float("nan")],
            "expected": [-127, -126, 127, -128],
        },
        {
            "artifact_id": "freezing_level",
            "parameter": "freezing_level",
            "units": "m",
            "source_transform": "identity",
            "encoding": {
                "id": "freezing_level_i8_32m_v1",
                "scale": 32,
                "offset": 4064,
                "finite_value_range": {"min": 0, "max": 8128},
            },
            "values": [-1.0, 32.0, 99999.0, float("nan")],
            "expected": [-127, -126, 127, -128],
        },
        {
            "artifact_id": "precipitable_water",
            "parameter": "pwat",
            "units": "mm",
            "source_transform": "identity",
            "encoding": {
                "id": "precipitable_water_i8_0p32mm_v1",
                "scale": 0.32,
                "offset": 40.64,
                "finite_value_range": {"min": 0, "max": 81.28},
            },
            "values": [-1.0, 0.32, 999.0, float("nan")],
            "expected": [-127, -126, 127, -128],
        },
        {
            "artifact_id": "cape_index",
            "parameter": "cape",
            "units": "J/kg",
            "source_transform": "identity",
            "encoding": {
                "id": "cape_index_i8_20jkg_v1",
                "scale": 20,
                "offset": 2540,
                "finite_value_range": {"min": 0, "max": 5080},
            },
            "values": [-1.0, 20.0, 9999.0, float("nan")],
            "expected": [-127, -126, 127, -128],
        },
        {
            "artifact_id": "cin_index",
            "parameter": "cin",
            "units": "J/kg",
            "source_transform": "cin_magnitude",
            "encoding": {
                "id": "cin_index_i8_2jkg_v1",
                "scale": 2,
                "offset": 254,
                "finite_value_range": {"min": 0, "max": 508},
            },
            "values": [-999.0, 0.0, 999.0, float("nan")],
            "expected": [127, -127, 127, -128],
        },
    )

    for case in cases:
        with artifact_run_fixture(prefix=f"weather-map-{case['artifact_id']}-clamp-") as fx:
            source = pack_f32(case["values"], byte_order="little")
            artifact_config = {
                "kind": "scalar",
                "parameter": case["parameter"],
                "level": "surface",
                "units": case["units"],
                "source_transform": case["source_transform"],
                "encoding": {
                    "id": case["encoding"]["id"],
                    "format": "linear-i8-v1",
                    "dtype": "int8",
                    "byte_order": "none",
                    "scale": case["encoding"]["scale"],
                    "offset": case["encoding"]["offset"],
                    "nodata": -128,
                    "finite_value_range": case["encoding"]["finite_value_range"],
                },
                "components": [
                    {"id": "value", "grib_match": {"GRIB_ELEMENT": "TEST"}},
                ],
            }

            with fx.patch_grib_processing(band=grib_band(metadata={"GRIB_ELEMENT": "TEST"}), source=source):
                fx.run_artifact(
                    artifact_id=case["artifact_id"],
                    artifact_config=artifact_config,
                    source=fx.single_grib_source(),
                    run=noop_run,
                )

            payload_bytes = fx.payload_bytes(artifact_id=case["artifact_id"], dtype="int8")
            assert payload_bytes == struct.pack("bbbb", *case["expected"])
