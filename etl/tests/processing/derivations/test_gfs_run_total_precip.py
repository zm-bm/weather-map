from __future__ import annotations

import struct

import pytest
from tests.fixtures.artifact_configs import (
    gfs_precip_total_config,
)
from tests.fixtures.artifact_runs import artifact_run_fixture, grib_band
from tests.fixtures.grids import pack_f32
from tests.fixtures.proc import noop_run


def test_gfs_precip_total_uses_zero_run_total_for_analysis_hour() -> None:
    with artifact_run_fixture(
        prefix="weather-map-gfs-precip-total-zero-",
        frame_id="000",
    ) as fx:
        with fx.patch_grib_processing() as grib:
            result = fx.run_artifact(
                artifact_id="precip_total_surface",
                artifact_config=gfs_precip_total_config(),
                source=fx.single_grib_source(),
                run=noop_run,
            )

        grib.find_band.assert_not_called()
        grib.extract_band.assert_not_called()
        payload_bytes = fx.payload_bytes(artifact_id="precip_total_surface", dtype="int8")
        assert payload_bytes == struct.pack("bbbb", -127, -127, -127, -127)
        assert result["encoding_id"] == "precip_total_surface_i8_1mm_v1"
        assert result["units"] == "mm"


def test_gfs_precip_total_selects_run_total_apcp_band() -> None:
    with artifact_run_fixture(
        prefix="weather-map-gfs-precip-total-run-",
        frame_id="009",
    ) as fx:
        source_grib = fx.single_grib_source()
        source = pack_f32([0.0, 9.0, 254.0, float("nan")], byte_order="little")

        with fx.patch_grib_processing(
            band=grib_band(index=2, metadata={"GRIB_ELEMENT": "APCP09"}),
            source=source,
        ) as grib:
            result = fx.run_artifact(
                artifact_id="precip_total_surface",
                artifact_config=gfs_precip_total_config(),
                source=source_grib,
                run=noop_run,
            )

        grib.find_band.assert_called_once_with(
            source_grib.reference_grib_path(),
            {
                "GRIB_ELEMENT__prefix": "APCP",
                "GRIB_SHORT_NAME": "0-SFC",
                "GRIB_FORECAST_SECONDS": "0",
                "GRIB_PDS_PDTN": "8",
            },
            run=noop_run,
        )
        assert grib.extract_band.call_args.kwargs["band_idx"] == 2
        payload_bytes = fx.payload_bytes(artifact_id="precip_total_surface", dtype="int8")
        assert payload_bytes == struct.pack("bbbb", -127, -118, 127, -128)
        assert result["encoding_id"] == "precip_total_surface_i8_1mm_v1"


def test_gfs_precip_total_requires_derivation_inputs() -> None:
    artifact_config = gfs_precip_total_config()
    artifact_config["derivation"]["inputs"] = []

    with artifact_run_fixture(prefix="weather-map-gfs-precip-total-missing-inputs-") as fx:
        with fx.patch_grib_processing(), pytest.raises(SystemExit, match="requires derivation.inputs"):
            fx.run_artifact(
                artifact_id="precip_total_surface",
                artifact_config=artifact_config,
                source=fx.single_grib_source(),
                run=noop_run,
            )


def test_gfs_precip_total_requires_accumulation_temporal_metadata() -> None:
    artifact_config = gfs_precip_total_config()
    artifact_config["temporal"]["kind"] = "average_rate"

    with artifact_run_fixture(prefix="weather-map-gfs-precip-total-temporal-") as fx:
        with fx.patch_grib_processing(), pytest.raises(SystemExit, match="requires temporal.kind='accumulation'"):
            fx.run_artifact(
                artifact_id="precip_total_surface",
                artifact_config=artifact_config,
                source=fx.single_grib_source(),
                run=noop_run,
            )
