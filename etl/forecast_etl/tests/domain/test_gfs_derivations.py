from __future__ import annotations

import struct
import unittest
from unittest.mock import patch

from forecast_etl.proc import RunResult
from forecast_etl.tests.fixtures.artifact_configs import (
    gfs_precip_total_config,
)
from forecast_etl.tests.fixtures.execution import artifact_run_fixture
from forecast_etl.tests.fixtures.grids import pack_f32, small_grid_meta_fixture


def _unused_run(*_args: object, **_kwargs: object) -> RunResult:
    return RunResult(argv=(), returncode=0)


class GfsArtifactDerivationTest(unittest.TestCase):
    def test_gfs_precip_total_uses_zero_run_total_for_analysis_hour(self) -> None:
        with artifact_run_fixture(
            prefix="weather-map-gfs-precip-total-zero-",
            frame_id="000",
        ) as fx:
            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                ) as find_band,
                patch(
                    "forecast_etl.extract.source_bands.extract_float32_band_bytes",
                ) as extract_band,
                patch(
                    "forecast_etl.tests.fixtures.execution.grid_meta_from_grib",
                    return_value=small_grid_meta_fixture(),
                ),
            ):
                result = fx.run_artifact(
                    artifact_id="precip_total_surface",
                    artifact_config=gfs_precip_total_config(),
                    source=fx.single_grib_source(),
                    run=_unused_run,
                )

            find_band.assert_not_called()
            extract_band.assert_not_called()
            payload_bytes = fx.payload_bytes(artifact_id="precip_total_surface", dtype="int8")
            self.assertEqual(payload_bytes, struct.pack("bbbb", -127, -127, -127, -127))
            self.assertEqual(result["encoding_id"], "precip_total_surface_i8_1mm_v1")
            self.assertEqual(result["units"], "mm")

    def test_gfs_precip_total_selects_run_total_apcp_band(self) -> None:
        with artifact_run_fixture(
            prefix="weather-map-gfs-precip-total-run-",
            frame_id="009",
        ) as fx:
            source_grib = fx.single_grib_source()
            source = pack_f32([0.0, 9.0, 254.0, float("nan")], byte_order="little")

            with (
                patch(
                    "forecast_etl.extract.source_bands.find_grib_band_by_metadata",
                    return_value=(2, {"GRIB_ELEMENT": "APCP09"}),
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
                    artifact_config=gfs_precip_total_config(),
                    source=source_grib,
                    run=_unused_run,
                )

            find_band.assert_called_once_with(
                source_grib.reference_grib_path(),
                {
                    "GRIB_ELEMENT__prefix": "APCP",
                    "GRIB_SHORT_NAME": "0-SFC",
                    "GRIB_FORECAST_SECONDS": "0",
                    "GRIB_PDS_PDTN": "8",
                },
                run=_unused_run,
            )
            self.assertEqual(extract_band.call_args.kwargs["band_idx"], 2)
            payload_bytes = fx.payload_bytes(artifact_id="precip_total_surface", dtype="int8")
            self.assertEqual(payload_bytes, struct.pack("bbbb", -127, -118, 127, -128))
            self.assertEqual(result["encoding_id"], "precip_total_surface_i8_1mm_v1")



if __name__ == "__main__":
    unittest.main()
