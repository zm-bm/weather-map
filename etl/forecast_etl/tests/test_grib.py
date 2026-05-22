from __future__ import annotations

import json
import unittest
from pathlib import Path

from forecast_etl.extract.grib import find_grib_band_by_metadata
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


if __name__ == "__main__":
    unittest.main()
