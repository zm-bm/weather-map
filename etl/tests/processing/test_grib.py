from __future__ import annotations

import json
import math
import struct
from pathlib import Path

import pytest
from weather_etl.processing.grib import extract_float32_band_bytes, find_grib_band, gdalinfo_json, grid_meta_from_grib
from weather_etl.processing.proc import RunResult


def _gdalinfo_run(info: dict):
    def run(argv: object) -> RunResult:
        return RunResult(argv=tuple(str(item) for item in argv), returncode=0, stdout=json.dumps(info))

    return run


def test_grid_meta_from_grib_marks_global_grid_as_wrapping_and_clamped() -> None:
    grid = grid_meta_from_grib(
        grib_path=Path("global.grib2"),
        run=_gdalinfo_run({
            "size": [1440, 720],
            "geoTransform": [0.0, 0.25, 0.0, 90.0, 0.0, -0.25],
        }),
    )

    assert grid["x_wrap"] == "repeat"
    assert grid["y_mode"] == "clamp"


def test_grid_meta_from_grib_marks_regional_grid_as_non_wrapping_and_unclamped() -> None:
    grid = grid_meta_from_grib(
        grib_path=Path("mrms.grib2"),
        run=_gdalinfo_run({
            "size": [7000, 3500],
            "geoTransform": [-130.0, 0.01, 0.0, 55.0, 0.0, -0.01],
        }),
    )

    assert grid["x_wrap"] == "none"
    assert grid["y_mode"] == "none"


def test_find_grib_band_keeps_exact_match_behavior() -> None:
    info = {
        "bands": [
            {"metadata": {"": {"GRIB_ELEMENT": "TMP", "GRIB_SHORT_NAME": "2-HTGL"}}},
            {"metadata": {"": {"GRIB_ELEMENT": "RH", "GRIB_SHORT_NAME": "2-HTGL"}}},
        ],
    }

    band = find_grib_band(
        Path("input.grib2"),
        {"GRIB_ELEMENT": "RH", "GRIB_SHORT_NAME": "2-HTGL"},
        run=_gdalinfo_run(info),
    )

    assert band.index == 2
    assert band.metadata["GRIB_ELEMENT"] == "RH"


def test_find_grib_band_supports_prefix_match() -> None:
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

    band = find_grib_band(
        Path("input.grib2"),
        {
            "GRIB_ELEMENT__prefix": "APCP",
            "GRIB_SHORT_NAME": "0-SFC",
            "GRIB_FORECAST_SECONDS": "0",
            "GRIB_PDS_PDTN": "8",
        },
        run=_gdalinfo_run(info),
    )

    assert band.index == 2
    assert band.metadata["GRIB_ELEMENT"] == "APCP09"


def test_extract_float32_band_bytes_maps_gdal_nodata_to_nan(tmp_path: Path) -> None:
    source_values = struct.pack("<ffff", 0.0, 9999.0, 1.5, 9998.0)

    def run(argv: object) -> RunResult:
        args = tuple(str(item) for item in argv)
        if args[0] == "gdal_translate":
            dst = Path(args[-1])
            dst.write_bytes(source_values)
            dst.with_suffix(".hdr").write_text("byte order = 0\n", encoding="utf-8")
            return RunResult(argv=args, returncode=0, stdout="")
        raise AssertionError(f"unexpected command: {args!r}")

    payload, byte_order = extract_float32_band_bytes(
        grib_path=Path("input.grib2"),
        band_idx=2,
        nodata_value=9999.0,
        workdir_path=tmp_path / "band.bin",
        run=run,
    )

    values = struct.unpack("<ffff", payload)
    assert byte_order == "little"
    assert values[0] == 0.0
    assert math.isnan(values[1])
    assert values[2] == 1.5
    assert values[3] == 9998.0


def test_extract_float32_band_bytes_uses_little_endian_when_optional_header_is_unreadable(
    tmp_path: Path,
) -> None:
    source_values = struct.pack("<ff", 1.0, 2.0)

    def run(argv: object) -> RunResult:
        args = tuple(str(item) for item in argv)
        if args[0] == "gdal_translate":
            dst = Path(args[-1])
            dst.write_bytes(source_values)
            dst.with_suffix(".hdr").mkdir()
            return RunResult(argv=args, returncode=0, stdout="")
        raise AssertionError(f"unexpected command: {args!r}")

    payload, byte_order = extract_float32_band_bytes(
        grib_path=Path("input.grib2"),
        band_idx=1,
        nodata_value=None,
        workdir_path=tmp_path / "band.bin",
        run=run,
    )

    assert payload == source_values
    assert byte_order == "little"


def test_gdalinfo_json_invalid_json_includes_command_context() -> None:
    def run(argv: object) -> RunResult:
        return RunResult(argv=tuple(str(item) for item in argv), returncode=0, stdout="{", stderr="stderr text")

    with pytest.raises(RuntimeError) as raised:
        gdalinfo_json(Path("input.grib2"), run=run)

    message = str(raised.value)
    assert "Failed to parse gdalinfo JSON for input.grib2" in message
    assert "stdout:" in message
    assert "stderr text" in message
