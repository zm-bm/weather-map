from __future__ import annotations

import json
import math
import struct
import tempfile
import unittest
from pathlib import Path

from forecast_etl.extract.grib import extract_float32_band_bytes, find_grib_band_by_metadata
from forecast_etl.proc import RunResult


def _gdalinfo_run(info: dict):
    def run(argv: object) -> RunResult:
        return RunResult(argv=tuple(str(item) for item in argv), returncode=0, stdout=json.dumps(info))

    return run


class GribMetadataMatchTest(unittest.TestCase):
    def test_find_grib_band_by_metadata_keeps_exact_match_behavior(self) -> None:
        info = {
            "bands": [
                {"metadata": {"": {"GRIB_ELEMENT": "TMP", "GRIB_SHORT_NAME": "2-HTGL"}}},
                {"metadata": {"": {"GRIB_ELEMENT": "RH", "GRIB_SHORT_NAME": "2-HTGL"}}},
            ],
        }

        band_idx, metadata = find_grib_band_by_metadata(
            Path("input.grib2"),
            {"GRIB_ELEMENT": "RH", "GRIB_SHORT_NAME": "2-HTGL"},
            run=_gdalinfo_run(info),
        )

        self.assertEqual(band_idx, 2)
        self.assertEqual(metadata["GRIB_ELEMENT"], "RH")

    def test_find_grib_band_by_metadata_supports_prefix_match(self) -> None:
        info = {
            "bands": [
                {
                    "metadata": {
                        "": {
                            "GRIB_ELEMENT": "APCP03",
                            "GRIB_SHORT_NAME": "0-SFC",
                            "GRIB_FORECAST_SECONDS": "21600",
                            "GRIB_PDS_PDTN": "8",
                        },
                    },
                },
                {
                    "metadata": {
                        "": {
                            "GRIB_ELEMENT": "APCP09",
                            "GRIB_SHORT_NAME": "0-SFC",
                            "GRIB_FORECAST_SECONDS": "0",
                            "GRIB_PDS_PDTN": "8",
                        },
                    },
                },
            ],
        }

        band_idx, metadata = find_grib_band_by_metadata(
            Path("input.grib2"),
            {
                "GRIB_ELEMENT__prefix": "APCP",
                "GRIB_SHORT_NAME": "0-SFC",
                "GRIB_FORECAST_SECONDS": "0",
                "GRIB_PDS_PDTN": "8",
            },
            run=_gdalinfo_run(info),
        )

        self.assertEqual(band_idx, 2)
        self.assertEqual(metadata["GRIB_ELEMENT"], "APCP09")


class GribBandExtractionTest(unittest.TestCase):
    def test_extract_float32_band_bytes_maps_gdal_nodata_to_nan(self) -> None:
        info = {"bands": [{}, {"noDataValue": 9999.0}]}
        source_values = struct.pack("<ffff", 0.0, 9999.0, 1.5, 9998.0)

        def run(argv: object) -> RunResult:
            args = tuple(str(item) for item in argv)
            if args[0] == "gdal_translate":
                dst = Path(args[-1])
                dst.write_bytes(source_values)
                dst.with_suffix(".hdr").write_text("byte order = 0\n", encoding="utf-8")
                return RunResult(argv=args, returncode=0, stdout="")
            if args[:2] == ("gdalinfo", "-json"):
                return RunResult(argv=args, returncode=0, stdout=json.dumps(info))
            raise AssertionError(f"unexpected command: {args!r}")

        with tempfile.TemporaryDirectory() as tmpdir:
            payload, byte_order = extract_float32_band_bytes(
                grib_path=Path("input.grib2"),
                band_idx=2,
                workdir_path=Path(tmpdir) / "band.bin",
                run=run,
            )

        values = struct.unpack("<ffff", payload)
        self.assertEqual(byte_order, "little")
        self.assertEqual(values[0], 0.0)
        self.assertTrue(math.isnan(values[1]))
        self.assertEqual(values[2], 1.5)
        self.assertEqual(values[3], 9998.0)


if __name__ == "__main__":
    unittest.main()
