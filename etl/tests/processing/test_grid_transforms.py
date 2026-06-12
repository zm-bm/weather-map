from __future__ import annotations

import math
import struct

import pytest
from tests.fixtures.grids import pack_f32
from weather_etl.processing.grid_transforms import (
    regular_grid_downsample_2x_bytes,
    regular_grid_downsample_2x_meta,
)


def _grid(nx: int = 5, ny: int = 3) -> dict:
    return {
        "crs": "EPSG:4326",
        "nx": nx,
        "ny": ny,
        "lon0": 180.0,
        "lat0": 90.0,
        "dx": 0.125,
        "dy": -0.125,
        "origin": "cell_center",
        "layout": "row_major",
        "x_wrap": "repeat",
        "y_mode": "clamp",
    }


def _unpack_f32(data: bytes) -> tuple[float, ...]:
    return struct.unpack(f"<{len(data) // 4}f", data)


def test_regular_grid_downsample_2x_updates_odd_grid_metadata() -> None:
    result = regular_grid_downsample_2x_meta(_grid())

    assert result["nx"] == 3
    assert result["ny"] == 2
    assert result["lon0"] == 180.0
    assert result["lat0"] == 90.0
    assert result["dx"] == 0.25
    assert result["dy"] == -0.25
    assert result["x_wrap"] == "repeat"


def test_regular_grid_downsample_2x_retains_regional_boundary_modes() -> None:
    result = regular_grid_downsample_2x_meta({
        **_grid(),
        "x_wrap": "none",
        "y_mode": "none",
    })

    assert result["x_wrap"] == "none"
    assert result["y_mode"] == "none"


def test_regular_grid_downsample_2x_uses_prefilter_wrap_and_bounds() -> None:
    values = [float(value) for value in range(15)]
    result = _unpack_f32(
        regular_grid_downsample_2x_bytes(
            pack_f32(values, byte_order="little"),
            byte_order="little",
            grid=_grid(),
        )
    )

    expected = (
        35 / 12,
        44 / 12,
        53 / 12,
        115 / 12,
        124 / 12,
        133 / 12,
    )
    for actual, expected_value in zip(result, expected):
        assert actual == pytest.approx(expected_value, abs=1e-5)


def test_regular_grid_downsample_2x_ignores_nan_weights() -> None:
    values = [float(value) for value in range(15)]
    values[0] = math.nan
    result = _unpack_f32(
        regular_grid_downsample_2x_bytes(
            pack_f32(values, byte_order="little"),
            byte_order="little",
            grid=_grid(),
        )
    )

    assert result[0] == pytest.approx(35 / 8, abs=1e-5)


def test_regular_grid_downsample_2x_outputs_nan_when_no_valid_samples_exist() -> None:
    result = _unpack_f32(
        regular_grid_downsample_2x_bytes(
            pack_f32([math.nan] * 9, byte_order="little"),
            byte_order="little",
            grid=_grid(nx=3, ny=3),
        )
    )

    assert all(math.isnan(value) for value in result)
